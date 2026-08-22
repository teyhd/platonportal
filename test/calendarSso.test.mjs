import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import session from 'express-session';
import jwt from 'jsonwebtoken';

import {
  CALENDAR_SSO_CLIENT_ID,
  CALENDAR_SSO_POST_LOGOUT_REDIRECT_URI,
  CALENDAR_SSO_REDIRECT_URI,
  getCalendarSsoClient,
} from '../vendor/calendarSso.mjs';
import { ensureCalendarSsoRightForUser, migrateCalendarSso } from '../vendor/db.mjs';
import {
  createScopedAccessToken,
  getAuthorizationAudience,
  makeSsoRouter,
} from '../vendor/ssoRouter.mjs';

function makePool({ existingService = false, roleIds = [1, 2, 3, 4, 5, 6] } = {}) {
  const calls = [];
  let committed = false;
  let rolledBack = false;
  let released = false;

  const connection = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.startsWith('SELECT GET_LOCK')) return [[{ acquired: 1 }]];
      if (sql.includes('FROM role_name') && sql.includes('FOR UPDATE')) {
        return [roleIds.map(id => ({ id }))];
      }
      if (sql.startsWith('SELECT id, types FROM srvs')) {
        return [existingService ? [{ id: 17, types: 0 }] : []];
      }
      if (sql.startsWith('INSERT INTO srvs (types, name)')) {
        return [{ insertId: 17, affectedRows: 1 }];
      }
      if (sql.startsWith('INSERT INTO srvs_roles')) return [{ affectedRows: existingService ? 0 : 6 }];
      if (sql.startsWith('INSERT INTO rights')) return [{ affectedRows: existingService ? 0 : 2 }];
      if (sql.startsWith('SELECT role_id')) return [[1, 2, 3, 4, 5, 6].map(role_id => ({ role_id }))];
      if (sql.startsWith('SELECT COUNT(*) AS count')) return [[{ count: 0 }]];
      if (sql.startsWith('SELECT RELEASE_LOCK')) {
        released = true;
        return [[{ released: 1 }]];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    async beginTransaction() {},
    async commit() { committed = true; },
    async rollback() { rolledBack = true; },
    release() {},
  };

  return {
    pool: { async getConnection() { return connection; } },
    calls,
    get committed() { return committed; },
    get rolledBack() { return rolledBack; },
    get released() { return released; },
  };
}

test('Calendar client uses the required endpoints and environment-only secret', () => {
  const client = getCalendarSsoClient({ CALENDAR_SSO_CLIENT_SECRET: 'test-secret' });

  assert.equal(CALENDAR_SSO_CLIENT_ID, 'calendar');
  assert.equal(client.client_secret, 'test-secret');
  assert.equal(client.redirect_uri, CALENDAR_SSO_REDIRECT_URI);
  assert.deepEqual(client.post_logout_redirect_uris, [CALENDAR_SSO_POST_LOGOUT_REDIRECT_URI]);
  assert.equal(client.srv_name, 'calendar');
  assert.equal(client.service_scoped_access_token, true);
  assert.throws(() => getCalendarSsoClient({}), /CALENDAR_SSO_CLIENT_SECRET/);
});

test('Calendar migration creates and verifies the service, roles, and rights', async () => {
  const fixture = makePool();

  const result = await migrateCalendarSso(fixture.pool);

  assert.deepEqual(result, {
    serviceId: 17,
    serviceCreated: true,
    serviceRolesAdded: 6,
    rightsAdded: 2,
  });
  assert.equal(fixture.committed, true);
  assert.equal(fixture.rolledBack, false);
  assert.equal(fixture.released, true);
  const rightsInsert = fixture.calls.find(call => call.sql.startsWith('INSERT INTO rights'));
  assert.ok(rightsInsert);
  assert.match(rightsInsert.sql, /existing\.role_id = u\.type/);

  const rightsVerification = fixture.calls.find(call => call.sql.startsWith('SELECT COUNT\(\*\) AS count'));
  assert.ok(rightsVerification);
  assert.match(rightsVerification.sql, /existing\.role_id = u\.type/);
});

test('Calendar migration is idempotent and rolls back if role prerequisites are missing', async () => {
  const idempotentFixture = makePool({ existingService: true });
  const result = await migrateCalendarSso(idempotentFixture.pool);

  assert.equal(result.serviceCreated, false);
  assert.equal(result.serviceRolesAdded, 0);
  assert.equal(result.rightsAdded, 0);
  assert.equal(idempotentFixture.calls.some(call => call.sql.startsWith('INSERT INTO srvs (types, name)')), false);

  const invalidFixture = makePool({ roleIds: [1, 2, 3, 4, 5] });
  await assert.rejects(() => migrateCalendarSso(invalidFixture.pool), /role IDs 1 through 6/);
  assert.equal(invalidFixture.rolledBack, true);
  assert.equal(invalidFixture.released, true);
});

test('Calendar user-right reconciliation adds only the matching active primary role', async () => {
  const calls = [];
  const pool = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      return [{ affectedRows: 1 }];
    },
  };

  const added = await ensureCalendarSsoRightForUser(42, pool);

  assert.equal(added, 1);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /u\.lifecycle_state = 'active'/);
  assert.match(calls[0].sql, /u\.type IN \(\?, \?, \?, \?, \?, \?\)/);
  assert.match(calls[0].sql, /existing\.role_id = u\.type/);
  assert.deepEqual(calls[0].params, ['calendar', 42, 1, 2, 3, 4, 5, 6]);
});

test('legacy clients preserve the requested audience and rights object contract', () => {
  const legacyRights = [
    { srv_id: 2, role_id: 4 },
    { srv_id: 11, role_id: 2 },
  ];
  const audience = getAuthorizationAudience({ srv_name: 'bookpc' }, '2');
  const token = createScopedAccessToken({
    issuer: 'https://sso.example.test',
    jwtSecret: 'test-signing-key',
    subject: 42,
    name: 'Test User',
    rights: legacyRights,
    logins: [],
    audience,
    now: 1_700_000_000,
  });
  const decoded = jwt.verify(token, 'test-signing-key', {
    algorithms: ['HS256'],
    ignoreExpiration: true,
  });

  assert.equal(decoded.aud, '2');
  assert.deepEqual(decoded.right, legacyRights);
});

test('legacy OAuth flow retains audience and rights required by existing clients', async () => {
  const jwtSecret = 'legacy-test-signing-key';
  const legacyRights = [{ srv_id: 2, role_id: 4 }];
  const app = express();

  app.use(session({
    secret: 'legacy-test-session-key',
    resave: false,
    saveUninitialized: false,
  }));
  app.get('/seed', (req, res) => {
    req.session.uid = 42;
    req.session.name = 'Test User';
    req.session.right = legacyRights;
    req.session.logins = [];
    res.sendStatus(204);
  });
  app.use('/sso', makeSsoRouter({
    issuer: 'https://sso.example.test',
    jwtSecret,
    clients: {
      bookpc: {
        client_secret: 'legacy-test-client-secret',
        redirect_uri: 'https://legacy.example.test/cb',
        srv_name: 'bookpc',
      },
    },
  }));

  const server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const seed = await fetch(`${baseUrl}/seed`);
    const cookie = seed.headers.get('set-cookie')?.split(';', 1)[0];
    assert.ok(cookie);

    const authorize = await fetch(
      `${baseUrl}/sso/authorize?client_id=bookpc&redirect_uri=${encodeURIComponent('https://legacy.example.test/cb')}&audience=2`,
      { headers: { cookie }, redirect: 'manual' }
    );
    assert.equal(authorize.status, 302);
    const code = new URL(authorize.headers.get('location')).searchParams.get('code');
    assert.ok(code);

    const token = await fetch(`${baseUrl}/sso/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: 'bookpc',
        client_secret: 'legacy-test-client-secret',
        redirect_uri: 'https://legacy.example.test/cb',
      }),
    });
    assert.equal(token.status, 200);
    const { access_token } = await token.json();
    const decoded = jwt.verify(access_token, jwtSecret, { algorithms: ['HS256'] });

    assert.equal(decoded.aud, '2');
    assert.deepEqual(decoded.right, legacyRights);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('Calendar access tokens use HS256, configured audience, and service-only roles', () => {
  const token = createScopedAccessToken({
    issuer: 'https://sso.example.test',
    jwtSecret: 'test-signing-key',
    subject: 42,
    name: 'Test User',
    rights: [3],
    logins: [],
    audience: getAuthorizationAudience({
      srv_name: 'calendar',
      service_scoped_access_token: true,
    }, '15'),
    now: 1_700_000_000,
  });
  const decoded = jwt.verify(token, 'test-signing-key', {
    algorithms: ['HS256'],
    ignoreExpiration: true,
  });

  assert.equal(jwt.decode(token, { complete: true }).header.alg, 'HS256');
  assert.equal(decoded.aud, 'calendar');
  assert.deepEqual(decoded.right, [3]);
});
