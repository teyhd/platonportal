import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import { RedisStore } from 'connect-redis';
import cookieSignature from 'cookie-signature';
import express from 'express';
import session from 'express-session';
import { createClient } from 'redis';

import { accountSessionId, activityDays, createAccountSecurity, describeDevice } from '../vendor/accountSecurity.mjs';
import { makeAccountSecurityRouter, trackAccountSession } from '../vendor/accountSecurityRoutes.mjs';
import { RedisRevocableTokenStore, createSsoSessionLifecycle } from '../vendor/ssoRevocableSessions.mjs';
import { makeSsoRouter } from '../vendor/ssoRouter.mjs';

test('device descriptions distinguish operating systems, browsers and Telegram', () => {
  assert.deepEqual(describeDevice('Mozilla/5.0 (Windows NT 10.0) Chrome/128.0 Edg/128.0'), {
    device: 'Windows', deviceType: 'desktop', browser: 'Microsoft Edge',
  });
  assert.deepEqual(describeDevice('Mozilla/5.0 (Linux; Android 14) Chrome/128.0 Mobile Safari/537.36'), {
    device: 'Телефон Android', deviceType: 'mobile', browser: 'Chrome',
  });
  assert.deepEqual(describeDevice('Mozilla/5.0 (Linux; Android 14) SamsungBrowser/25.0'), {
    device: 'Планшет Android', deviceType: 'tablet', browser: 'Samsung Internet',
  });
  assert.deepEqual(describeDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Safari/605.1', 'telegram'), {
    device: 'iPhone', deviceType: 'mobile', browser: 'Telegram Mini App',
  });
  assert.deepEqual(describeDevice(), { device: 'Устройство не определено', deviceType: '', browser: '' });
  assert.notEqual(accountSessionId('portal', 'example'), accountSessionId('telegram', 'example'));
});

const redisUrl = process.env.ACCOUNT_SECURITY_TEST_REDIS_URL;

test('Redis backs device sessions, service grants and account history', {
  skip: !redisUrl && 'Set ACCOUNT_SECURITY_TEST_REDIS_URL to an isolated empty Redis database',
}, async t => {
  const redis = createClient({ url: redisUrl, socket: { connectTimeout: 2000, reconnectStrategy: false } });
  redis.on('error', () => {});
  await redis.connect();
  const cleanup = new Set();
  let server;
  const tokenPrefix = 'test:account-security:' + crypto.randomUUID() + ':';
  t.after(async () => {
    try {
      if (server) await new Promise(resolve => {
        server.close(resolve);
        server.closeAllConnections();
      });
      for await (const key of redis.scanIterator({ MATCH: tokenPrefix + '*' })) cleanup.add(key);
      if (cleanup.size) await redis.del([...cleanup]);
    } finally {
      await redis.disconnect();
    }
  });
  assert.equal(await redis.dbSize(), 0, 'Account security tests require an isolated empty Redis database');

  const security = createAccountSecurity(redis);
  const metadataPrefix = 'sso:security:v1:';
  const portalPrefix = 'sso:session:';
  const telegramPrefix = 'tma:session:';
  const user = crypto.randomInt(100_000, 1_000_000);
  const otherUser = user + 1;
  const historyKey = metadataPrefix + 'activity:' + user;
  cleanup.add(historyKey);
  cleanup.add(metadataPrefix + 'index:' + user);
  cleanup.add(metadataPrefix + 'activity:' + otherUser);
  cleanup.add(metadataPrefix + 'index:' + otherUser);

  const request = {
    ip: '::ffff:203.0.113.17',
    get: name => name === 'user-agent' ? 'Mozilla/5.0 (Windows NT 10.0) Chrome/128.0' : undefined,
  };

  async function seed(kind, uid, { expired = false } = {}) {
    const sid = crypto.randomUUID();
    const id = accountSessionId(kind, sid);
    const key = (kind === 'portal' ? portalPrefix : telegramPrefix) + sid;
    const cookieAge = 3600_000;
    const value = {
      uid,
      name: 'Пользователь',
      right: [],
      logins: [],
      cookie: {
        expires: new Date(Date.now() + (expired ? -1000 : cookieAge)).toISOString(),
        originalMaxAge: cookieAge,
        httpOnly: true,
        path: '/',
        sameSite: 'lax',
      },
    };
    cleanup.add(key);
    cleanup.add(metadataPrefix + 'session:' + id);
    cleanup.add(metadataPrefix + 'revoked:' + id);
    await redis.set(key, JSON.stringify(value), { EX: 3600 });
    return { id, sid, key, value };
  }

  const portalStore = new RedisStore({ client: redis, prefix: portalPrefix, ttl: 3600 });
  const tokenStore = new RedisRevocableTokenStore(redis, { prefix: tokenPrefix, ttlSeconds: 600 });
  const clients = {
    rasp: {
      client_secret: 'fixture-rasp-secret', redirect_uri: 'https://rasp.example.test/cb',
      srv_name: 'rasp', legacy_audience: 8, revocable_sessions: true,
    },
    bookpc: {
      client_secret: 'fixture-bookpc-secret', redirect_uri: 'https://pc.example.test/cb',
      srv_name: 'bookpc', legacy_audience: 2,
    },
    calendar: { srv_name: 'calendar', revocable_sessions: true },
  };
  const issuer = 'https://sso.example.test/sso';
  const lifecycle = createSsoSessionLifecycle({ accountSecurity: security, tokenStore, sessionStore: portalStore, clients, issuer });
  const sessionSecret = 'account-security-test-session';
  const app = express();
  app.use(session({
    name: 'sso.sid', store: portalStore, secret: sessionSecret, resave: false, saveUninitialized: false,
    genid() {
      const sid = crypto.randomUUID();
      cleanup.add(portalPrefix + sid);
      return sid;
    },
  }));
  app.use(trackAccountSession(security, () => 'portal'));
  app.get('/fixture/principal', (req, res) => res.json({ uid: req.session.uid ?? null }));
  app.use((_req, res, next) => {
    res.render = (_view, data) => res.json(data);
    next();
  });
  app.use('/security', makeAccountSecurityRouter({ security, clients, secret: sessionSecret, lifecycle }));
  app.use('/sso', makeSsoRouter({
    issuer, jwtSecret: 'account-security-test-jwt', clients, tokenStore, lifecycle, accountSecurity: security,
    getServiceRoles: async () => [3],
  }));
  server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const base = 'http://127.0.0.1:' + server.address().port;
  const cookieOf = record => 'sso.sid=' + encodeURIComponent('s:' + cookieSignature.sign(record.sid, sessionSecret));
  const get = (path, record) => fetch(base + path, { headers: { cookie: cookieOf(record) }, redirect: 'manual' });

  const old = await seed('portal', user);
  await seed('portal', user, { expired: true });
  const current = await seed('portal', user);
  const foreign = await seed('portal', otherUser);

  await t.test('backfill finds existing signed-in sessions without inventing history', async () => {
    await security.backfill();
    assert.deepEqual(new Set((await security.listSessions(user)).map(record => record.id)), new Set([old.id, current.id]));
    assert.equal((await security.listSessions(user)).find(record => record.id === old.id).createdAt, undefined);
    assert.deepEqual(await security.activity(user, 1, 12), { events: [], more: false });
    await security.observe('portal', current.sid, user, request);
    assert.equal((await security.listSessions(user)).find(record => record.id === current.id).ip, '203.0.113.17');
  });

  await t.test('protects current and foreign devices and revokes the linked Telegram browser together', async () => {
    const telegram = await seed('telegram', user);
    const handoff = await seed('portal', user);
    await security.noteLogin('telegram', telegram.sid, user, request, 'telegram');
    await security.noteLogin('portal', handoff.sid, user, request, 'telegram-browser', telegram.sid);

    assert.equal((await security.listSessions(user)).find(record => record.id === handoff.id).groupId, telegram.id);
    assert.deepEqual(await security.endDevices(user, current.id, current.id), []);
    assert.deepEqual(await security.endDevices(user, current.id, foreign.id), []);
    assert.deepEqual(await security.endDevices(otherUser, current.id, foreign.id), []);
    assert.deepEqual(await security.endDevices(user, handoff.id, telegram.id), []);

    const removed = await security.endDevices(user, current.id, handoff.id);
    assert.deepEqual(new Set(removed.map(record => record.id)), new Set([telegram.id, handoff.id]));
    assert.equal(await redis.get(telegram.key), null);
    assert.equal(await redis.get(handoff.key), null);
    assert.ok(await redis.get(foreign.key));

    await redis.set(handoff.key, JSON.stringify(handoff.value), { EX: 60 });
    assert.equal(await lifecycle.isActive(handoff.sid, user), false);
    const stale = await get('/fixture/principal', handoff);
    assert.equal((await stale.json()).uid, null);
    assert.equal(await redis.get(handoff.key), null);

    const others = await security.endDevices(user, current.id);
    assert.ok(others.some(record => record.id === old.id));
    assert.equal(await redis.get(old.key), null);
    assert.ok(await redis.get(current.key));
  });

  await t.test('records service access after exchange and displays only currently revocable grants as active', async () => {
    async function startAuthorization(clientId) {
      const redirectUri = clients[clientId].redirect_uri;
      const authorize = await get('/sso/authorize?' + new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri }), current);
      assert.equal(authorize.status, 302);
      const code = new URL(authorize.headers.get('location')).searchParams.get('code');
      assert.ok(code);
      return new URLSearchParams({
        grant_type: 'authorization_code', code, client_id: clientId,
        client_secret: clients[clientId].client_secret, redirect_uri: redirectUri,
      });
    }
    const exchange = body => fetch(base + '/sso/token', { method: 'POST', body });

    const authorizationGrant = await startAuthorization('rasp');
    assert.ok(!(await security.activity(user, 1, 30)).events.some(event => event.type === 'service'));

    const onlineGrant = await exchange(authorizationGrant);
    assert.equal(onlineGrant.status, 200);
    const { refresh_token: refreshToken } = await onlineGrant.json();
    const refresh = await exchange(new URLSearchParams({
      grant_type: 'refresh_token', refresh_token: refreshToken, client_id: 'rasp',
      client_secret: clients.rasp.client_secret,
    }));
    assert.equal(refresh.status, 200);
    assert.notEqual((await refresh.json()).refresh_token, refreshToken);
    assert.equal((await exchange(await startAuthorization('bookpc'))).status, 200);
    await security.noteService({
      sid: current.sid, uid: user, clientId: 'calendar', kind: 'exchange', expiresAt: Math.floor(Date.now() / 1000) - 10,
    });

    const page = await get('/security', current);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('cache-control'), 'no-store, private');
    const { activity, sessions } = await page.json();
    assert.ok(sessions.find(record => record.current).services.some(service => service.id === 'rasp'));
    assert.ok(!sessions.find(record => record.current).services.some(service => ['calendar', 'bookpc'].includes(service.id)));
    assert.ok(activity.some(event => event.detail.includes('Аренда ПК')));
    assert.equal(activity.filter(event => event.detail.includes('Расписание')).length, 1);
  });

  await t.test('history is paginated and pruned to 30 days', async () => {
    assert.equal(activityDays, 30);
    const day = 86400_000;
    const now = Date.now();
    await redis.zAdd(historyKey, [29, 31].map(days => {
      const event = { id: 'fixture-' + days, type: 'pin', at: now - days * day };
      return { score: event.at, value: JSON.stringify(event) };
    }));

    assert.equal((await security.activity(user, 1, 1)).more, true);
    const history = await security.activity(user, 1, 30);
    assert.ok(history.events.some(event => event.id === 'fixture-29'));
    assert.ok(!history.events.some(event => event.id === 'fixture-31'));
    assert.ok(!history.events.some(event => event.id === foreign.id));
    const ttl = await redis.ttl(historyKey);
    assert.ok(ttl > 0 && ttl <= 30 * 86400);
  });
});
