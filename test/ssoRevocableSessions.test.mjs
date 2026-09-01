import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import express from 'express';
import session from 'express-session';
import jwt from 'jsonwebtoken';

import { makeSsoRouter, resolveSsoIssuer } from '../vendor/ssoRouter.mjs';
import { createSsoSessionLifecycle } from '../vendor/ssoRevocableSessions.mjs';

test('public SSO issuer takes precedence over the internal portal address', () => {
  const previousIssuer = process.env.SSO_ISSUER;
  const previousAddress = process.env.SSOADR;
  process.env.SSO_ISSUER = 'https://platoniks.ru/sso';
  process.env.SSOADR = 'http://localhost:777';

  try {
    assert.equal(resolveSsoIssuer(), 'https://platoniks.ru/sso');
  } finally {
    if (previousIssuer === undefined) delete process.env.SSO_ISSUER;
    else process.env.SSO_ISSUER = previousIssuer;
    if (previousAddress === undefined) delete process.env.SSOADR;
    else process.env.SSOADR = previousAddress;
  }
});

class MemoryTokenStore {
  constructor() {
    this.tokens = new Map();
  }

  async issue(record) {
    const token = crypto.randomBytes(24).toString('base64url');
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    this.tokens.set(token, {
      ...record,
      sub: String(record.sub || ''),
      sid: String(record.sid || ''),
      exp: expiresAt,
    });
    return { token, expiresAt };
  }

  async inspect(token) {
    const record = this.tokens.get(token) || null;
    if (!record || Number(record.exp) <= Math.floor(Date.now() / 1000)) return null;
    return record;
  }

  async consume(token) {
    const record = this.tokens.get(token) || null;
    this.tokens.delete(token);
    return record;
  }

  async revokeSession(sid) {
    let count = 0;
    for (const [token, record] of this.tokens) {
      if (record.sid !== sid) continue;
      this.tokens.delete(token);
      count += 1;
    }
    return count;
  }
}

async function closeFixture(fixture) {
  const closing = new Promise(resolve => fixture.server.close(resolve));
  fixture.server.closeAllConnections?.();
  await closing;
}

function cookieFrom(response) {
  return response.headers.get('set-cookie')?.split(';', 1)[0] || '';
}

async function startFixture(options = {}) {
  const clientSecret = 'rasp-client-secret';
  const jwtSecret = 'sso-jwt-secret';
  const issuer = 'https://sso.example.test/sso';
  const clients = {
    rasp: {
      client_secret: clientSecret,
      redirect_uri: 'https://rasp.example.test/api/cb',
      post_logout_redirect_uris: ['https://rasp.example.test'],
      backchannel_logout_uri: 'https://rasp.example.test/api/auth/backchannel-logout',
      revocable_sessions: true,
      srv_name: 'rasp',
      legacy_audience: 8,
    },
  };
  const tokenStore = new MemoryTokenStore();
  const sessionStore = new session.MemoryStore();
  const backchannel = [];
  const lifecycle = createSsoSessionLifecycle({
    clients,
    issuer,
    tokenStore,
    sessionStore,
    fetchImpl: async (url, init) => {
      backchannel.push({ url, body: String(init.body) });
      if (options.backchannelFails) throw new Error('network unavailable');
      return { ok: true, status: 200 };
    },
  });
  const app = express();
  app.use(session({
    name: 'sso.sid',
    secret: 'test-session-secret',
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
  }));
  app.get('/seed', (req, res) => {
    req.session.uid = 41;
    req.session.name = 'User A';
    req.session.right = [{ srv_id: 8, role_id: 5 }];
    req.session.logins = [];
    res.sendStatus(204);
  });
  app.post('/switch', express.urlencoded({ extended: false }), async (req, res) => {
    await lifecycle.establish(req, {
      id: 42,
      name: 'User B',
      role: 2,
      right: [{ srv_id: 8, role_id: 2 }],
      logins: [],
    });
    res.sendStatus(204);
  });
  app.use('/sso', makeSsoRouter({
    issuer,
    jwtSecret,
    clients,
    tokenStore,
    lifecycle,
    getServiceRoles: async userID => (Number(userID) === 41 ? [5] : [2]),
  }));
  const server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const baseURL = `http://127.0.0.1:${server.address().port}`;
  return { baseURL, backchannel, clientSecret, issuer, jwtSecret, server, tokenStore };
}

async function authorizeAndExchange(fixture, cookie) {
  const callback = 'https://rasp.example.test/api/cb';
  const authorize = await fetch(
    `${fixture.baseURL}/sso/authorize?client_id=rasp&redirect_uri=${encodeURIComponent(callback)}&audience=rasp`,
    { headers: { cookie }, redirect: 'manual' },
  );
  assert.equal(authorize.status, 302);
  const code = new URL(authorize.headers.get('location')).searchParams.get('code');
  const token = await fetch(`${fixture.baseURL}/sso/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: 'rasp',
      client_secret: fixture.clientSecret,
      redirect_uri: callback,
    }),
  });
  assert.equal(token.status, 200);
  return token.json();
}

async function introspect(fixture, token) {
  const response = await fetch(`${fixture.baseURL}/sso/introspect`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`rasp:${fixture.clientSecret}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ token }),
  });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  return response.json();
}

test('revocable rasp token is bound to the upstream session and rotates once', async () => {
  const fixture = await startFixture();
  try {
    const seed = await fetch(`${fixture.baseURL}/seed`);
    const cookie = cookieFrom(seed);
    const tokens = await authorizeAndExchange(fixture, cookie);
    const accessClaims = jwt.verify(tokens.access_token, fixture.jwtSecret, {
      algorithms: ['HS256'],
      issuer: fixture.issuer,
      audience: '8',
    });
    assert.ok(accessClaims.sid);

    const active = await introspect(fixture, tokens.refresh_token);
    assert.equal(active.active, true);
    assert.equal(active.sub, '41');
    assert.deepEqual(active.right, [5]);

    const rotate = await fetch(`${fixture.baseURL}/sso/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
        client_id: 'rasp',
        client_secret: fixture.clientSecret,
      }),
    });
    assert.equal(rotate.status, 200);
    const rotated = await rotate.json();
    assert.notEqual(rotated.refresh_token, tokens.refresh_token);
    assert.equal((await introspect(fixture, tokens.refresh_token)).active, false);

    const replay = await fetch(`${fixture.baseURL}/sso/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
        client_id: 'rasp',
        client_secret: fixture.clientSecret,
      }),
    });
    assert.equal(replay.status, 400);
  } finally {
    await closeFixture(fixture);
  }
});

test('portal logout revokes rasp token and sends a signed backchannel logout', async () => {
  const fixture = await startFixture();
  try {
    const seed = await fetch(`${fixture.baseURL}/seed`);
    const cookie = cookieFrom(seed);
    const tokens = await authorizeAndExchange(fixture, cookie);
    const logout = await fetch(
      `${fixture.baseURL}/sso/logout?client_id=rasp&post_logout_redirect_uri=${encodeURIComponent('https://rasp.example.test')}`,
      { headers: { cookie }, redirect: 'manual' },
    );
    assert.equal(logout.status, 302);
    assert.equal((await introspect(fixture, tokens.refresh_token)).active, false);
    assert.equal(fixture.backchannel.length, 1);
    const logoutToken = new URLSearchParams(fixture.backchannel[0].body).get('logout_token');
    const claims = jwt.verify(logoutToken, fixture.clientSecret, {
      algorithms: ['HS256'],
      issuer: fixture.issuer,
      audience: 'rasp',
    });
    assert.equal(claims.sub, '41');
    assert.ok(claims.sid);
  } finally {
    await closeFixture(fixture);
  }
});

test('account switch regenerates the portal session and revokes the old identity', async () => {
  const fixture = await startFixture();
  try {
    const seed = await fetch(`${fixture.baseURL}/seed`);
    const cookie = cookieFrom(seed);
    const tokens = await authorizeAndExchange(fixture, cookie);
    const oldSid = jwt.decode(tokens.access_token).sid;
    const switched = await fetch(`${fixture.baseURL}/switch`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    });
    assert.equal(switched.status, 204);
    assert.notEqual(cookieFrom(switched), cookie);
    assert.equal((await introspect(fixture, tokens.refresh_token)).active, false);
    assert.equal(fixture.backchannel.length, 1);
    const claims = jwt.verify(
      new URLSearchParams(fixture.backchannel[0].body).get('logout_token'),
      fixture.clientSecret,
      { algorithms: ['HS256'], issuer: fixture.issuer, audience: 'rasp' },
    );
    assert.equal(claims.sid, oldSid);
    assert.equal(claims.reason, 'account_switch');
  } finally {
    await closeFixture(fixture);
  }
});

test('introspection rejects invalid clients, unknown, expired, and cross-client tokens', async () => {
  const fixture = await startFixture();
  try {
    const seed = await fetch(`${fixture.baseURL}/seed`);
    const cookie = cookieFrom(seed);
    const tokens = await authorizeAndExchange(fixture, cookie);
    const badClient = await fetch(`${fixture.baseURL}/sso/introspect`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from('rasp:wrong-secret').toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ token: tokens.refresh_token }),
    });
    assert.equal(badClient.status, 401);
    assert.deepEqual(await badClient.json(), { active: false });
    assert.equal((await introspect(fixture, 'not-a-token')).active, false);

    const stored = fixture.tokenStore.tokens.get(tokens.refresh_token);
    stored.client_id = 'another-client';
    assert.equal((await introspect(fixture, tokens.refresh_token)).active, false);
    stored.client_id = 'rasp';
    stored.exp = Math.floor(Date.now() / 1000) - 1;
    assert.equal((await introspect(fixture, tokens.refresh_token)).active, false);
  } finally {
    await closeFixture(fixture);
  }
});

test('logout succeeds even when the registered client backchannel is unavailable', async () => {
  const fixture = await startFixture({ backchannelFails: true });
  try {
    const seed = await fetch(`${fixture.baseURL}/seed`);
    const cookie = cookieFrom(seed);
    const tokens = await authorizeAndExchange(fixture, cookie);
    const logout = await fetch(
      `${fixture.baseURL}/sso/logout?client_id=rasp&post_logout_redirect_uri=${encodeURIComponent('https://rasp.example.test')}`,
      { headers: { cookie }, redirect: 'manual' },
    );
    assert.equal(logout.status, 302);
    assert.equal((await introspect(fixture, tokens.refresh_token)).active, false);
    assert.equal(fixture.backchannel.length, 1);
  } finally {
    await closeFixture(fixture);
  }
});

test('logout does not notify clients that were never authorized in the session', async () => {
  const fixture = await startFixture();
  try {
    const seed = await fetch(`${fixture.baseURL}/seed`);
    const logout = await fetch(
      `${fixture.baseURL}/sso/logout?client_id=rasp&post_logout_redirect_uri=${encodeURIComponent('https://rasp.example.test')}`,
      { headers: { cookie: cookieFrom(seed) }, redirect: 'manual' },
    );
    assert.equal(logout.status, 302);
    assert.equal(fixture.backchannel.length, 0);
  } finally {
    await closeFixture(fixture);
  }
});
