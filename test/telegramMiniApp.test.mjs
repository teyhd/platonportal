import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import express from 'express';
import session from 'express-session';

import { resolveTelegramMiniAppIdentity } from '../vendor/db.mjs';
import {
  getTelegramMiniAppConfig,
  TelegramMiniAppValidationError,
  verifyTelegramMiniAppInitData,
} from '../vendor/telegramMiniApp.mjs';
import { makeTelegramMiniAppRouter } from '../vendor/telegramMiniAppRouter.mjs';

function makeInitData({ botId, privateKey, userId = '123456789', authDate = 1_700_000_000 } = {}) {
  const values = new URLSearchParams({
    auth_date: String(authDate),
    query_id: 'AAH-test-query',
    user: JSON.stringify({ id: Number(userId), first_name: 'Тест', username: 'test_user' }),
  });
  const dataCheckString = [...values.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const signature = crypto.sign(null, Buffer.from(`${botId}:WebAppData\n${dataCheckString}`), privateKey).toString('base64url');
  values.set('hash', 'legacy-hash-is-not-used-for-third-party-verification');
  values.set('signature', signature);
  return values.toString();
}

test('Telegram Mini App initData is verified with Telegram Ed25519 signature and freshness', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const initData = makeInitData({ botId: '12345', privateKey, authDate: 1_700_000_000 });

  const verified = verifyTelegramMiniAppInitData(initData, {
    botId: '12345',
    publicKey,
    now: 1_700_000_120,
    maxAgeSeconds: 300,
  });

  assert.equal(verified.telegramUserId, '123456789');
  assert.equal(verified.user.firstName, 'Тест');
  assert.throws(
    () => verifyTelegramMiniAppInitData(`${initData}&x=1`, { botId: '12345', publicKey, now: 1_700_000_120 }),
    error => error instanceof TelegramMiniAppValidationError && error.code === 'invalid_signature'
  );
  assert.throws(
    () => verifyTelegramMiniAppInitData(initData, { botId: '12345', publicKey, now: 1_700_000_500, maxAgeSeconds: 300 }),
    error => error instanceof TelegramMiniAppValidationError && error.code === 'expired_init_data'
  );
});

test('Telegram Mini App configuration is opt-in and validates required values', () => {
  assert.deepEqual(getTelegramMiniAppConfig({}), { enabled: false });
  assert.throws(
    () => getTelegramMiniAppConfig({ TELEGRAM_MINI_APP_ENABLED: 'true' }),
    /TELEGRAM_MINI_APP_BOT_ID/
  );
  assert.deepEqual(getTelegramMiniAppConfig({
    TELEGRAM_MINI_APP_ENABLED: 'true',
    TELEGRAM_MINI_APP_BOT_ID: '12345',
    TELEGRAM_MINI_APP_BOT_DATABASE: 'photobattle',
  }), {
    enabled: true,
    botId: '12345',
    botDatabase: 'photobattle',
    authMaxAgeSeconds: 300,
    sessionTtlSeconds: 1800,
  });
});

test('Telegram identity resolver accepts only a single approved, active and consistent link', async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (calls.length === 1) return [[{ id: 17, role: 1, truename: '42' }]];
      return [[{ id: 42, name: 'Пользователь', type: 3, status: 1, lifecycle_state: 'active', tg_id: 17 }]];
    },
  };

  const identity = await resolveTelegramMiniAppIdentity('123456789', 'photobattle', pool);

  assert.deepEqual(identity, {
    status: 'active',
    telegramUserId: '123456789',
    botUserId: 17,
    portalUserId: 42,
    name: 'Пользователь',
    role: 3,
  });
  assert.match(calls[0].sql, /FROM `photobattle`\.users/);
  assert.deepEqual(calls[0].params, ['123456789']);
});

test('Telegram identity resolver rejects duplicate bot records and reverse-link conflicts', async () => {
  const duplicatePool = { query: async () => [[{ id: 17 }, { id: 18 }]] };
  assert.deepEqual(await resolveTelegramMiniAppIdentity('123', 'photobattle', duplicatePool), { status: 'ambiguous' });

  let callCount = 0;
  const conflictPool = {
    async query() {
      callCount += 1;
      if (callCount === 1) return [[{ id: 17, role: 1, truename: '42' }]];
      return [[{ id: 42, name: 'Пользователь', type: 3, status: 1, lifecycle_state: 'active', tg_id: 99 }]];
    },
  };
  assert.deepEqual(await resolveTelegramMiniAppIdentity('123', 'photobattle', conflictPool), { status: 'ambiguous' });
  await assert.rejects(
    () => resolveTelegramMiniAppIdentity('123', 'photobattle;drop', { query: async () => [[]] }),
    /database name is invalid/
  );
});

function createSessionLifecycle() {
  return {
    async establish(req, user) {
      await new Promise((resolve, reject) => req.session.regenerate(error => (error ? reject(error) : resolve())));
      Object.assign(req.session, { uid: user.id, name: user.name, role: user.role, right: user.right, logins: user.logins });
    },
    async logout(req) {
      await new Promise(resolve => req.session.destroy(resolve));
    },
  };
}

test('Telegram router creates an isolated session only after verified auth and rechecks the link', async () => {
  const app = express();
  app.use(express.json());
  app.use('/tg', session({ name: 'tma.sid', secret: 'test-secret', resave: false, saveUninitialized: false }));
  let isActive = true;
  app.use('/tg', makeTelegramMiniAppRouter({
    enabled: true,
    botId: '12345',
    botDatabase: 'photobattle',
    authMaxAgeSeconds: 300,
    verifyInitData: () => ({ telegramUserId: '123456789', authDate: 1_700_000_000 }),
    resolveIdentity: async () => isActive
      ? { status: 'active', portalUserId: 42, botUserId: 17, name: 'Тестовый пользователь', role: 3 }
      : { status: 'not_linked' },
    getUserRights: async () => [{ srv_id: 1, role_id: 3 }],
    lifecycle: createSessionLifecycle(),
    getPortalData: async () => ({ title: 'Ваши сервисы', subtitle: 'Доступно', services: [] }),
    launchService: async (_identity, serviceId, res) => {
      if (serviceId !== '7') return res.status(404).json({ ok: false, code: 'service_unavailable' });
      return res.redirect(302, '/sso/authorize?client_id=calendar');
    },
  }));
  const server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const unauthenticated = await fetch(`${baseUrl}/tg/api/portal`);
    assert.equal(unauthenticated.status, 401);

    const auth = await fetch(`${baseUrl}/tg/api/auth`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ initData: 'verified-by-fixture' }),
    });
    assert.equal(auth.status, 200);
    const authData = await auth.json();
    const cookie = auth.headers.get('set-cookie')?.split(';', 1)[0];
    assert.ok(cookie?.startsWith('tma.sid='));
    assert.ok(authData.csrfToken);

    const portal = await fetch(`${baseUrl}/tg/api/portal`, { headers: { cookie } });
    assert.equal(portal.status, 200);
    assert.equal((await portal.json()).user.name, 'Тестовый пользователь');

    const launch = await fetch(`${baseUrl}/tg/launch/7`, { headers: { cookie }, redirect: 'manual' });
    assert.equal(launch.status, 302);
    assert.equal(launch.headers.get('location'), '/sso/authorize?client_id=calendar');

    isActive = false;
    const revoked = await fetch(`${baseUrl}/tg/api/session`, { headers: { cookie } });
    assert.equal(revoked.status, 401);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
