import assert from 'node:assert/strict';
import test from 'node:test';
import jwt from 'jsonwebtoken';

import {
  CALENDAR_SSO_CLIENT_ID,
  CALENDAR_SSO_POST_LOGOUT_REDIRECT_URI,
  CALENDAR_SSO_REDIRECT_URI,
  getCalendarSsoClient,
} from '../vendor/calendarSso.mjs';
import { migrateCalendarSso } from '../vendor/db.mjs';
import { createScopedAccessToken, getClientServiceName } from '../vendor/ssoRouter.mjs';

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
  assert.ok(fixture.calls.some(call => call.sql.startsWith('INSERT INTO rights')));
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

test('scoped access tokens use HS256, configured audience, and service-only roles', () => {
  const token = createScopedAccessToken({
    issuer: 'https://sso.example.test',
    jwtSecret: 'test-signing-key',
    subject: 42,
    name: 'Test User',
    roles: [3],
    logins: [],
    audience: getClientServiceName({ srv_name: 'calendar' }),
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
