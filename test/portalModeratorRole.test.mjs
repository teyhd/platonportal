import assert from 'node:assert/strict';
import test from 'node:test';

import { get_err_roles_users, getNonExternalUserClause, migratePortalModeratorRole } from '../vendor/db.mjs';

test('moderator filtering hides only the External role', () => {
  assert.equal(getNonExternalUserClause(), 'WHERE (u.type <> -1 OR u.type IS NULL)');
  assert.equal(getNonExternalUserClause('AND'), 'AND (u.type <> -1 OR u.type IS NULL)');
});

test('access issues always exclude External accounts', async () => {
  const calls = [];
  const pool = {
    async query(sql) {
      calls.push(sql);
      return [[]];
    },
  };

  await get_err_roles_users(pool);

  assert.match(calls[0], /AND \(u\.type <> -1 OR u\.type IS NULL\)/);
  assert.match(calls[0], /allowed\.role_id = u\.type/);
  assert.match(calls[0], /r\.role_id = u\.type/);
});

function makePool({ moderatorExists = false } = {}) {
  const calls = [];
  let committed = false;
  let rolledBack = false;
  let released = false;

  const connection = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.startsWith('SELECT GET_LOCK')) return [[{ acquired: 1 }]];
      if (sql.startsWith('SELECT id, name FROM role_name')) {
        return [[
          { id: 5, name: 'Админ' },
          ...(moderatorExists ? [{ id: 7, name: 'Модератор' }] : []),
        ]];
      }
      if (sql.startsWith('INSERT INTO role_name')) return [{ affectedRows: 1 }];
      if (sql.startsWith('SELECT srvs_id FROM srvs_roles')) return [[{ srvs_id: 1 }, { srvs_id: 4 }]];
      if (sql.startsWith('SELECT id FROM users')) return [[{ id: 100 }]];
      if (sql.startsWith('INSERT INTO srvs_roles')) return [{ affectedRows: moderatorExists ? 0 : 2 }];
      if (sql.startsWith('UPDATE rights r')) return [{ affectedRows: 60 }];
      if (sql.startsWith('UPDATE users SET type = ? WHERE type')) return [{ affectedRows: 10 }];
      if (sql.startsWith('UPDATE users SET type = ? WHERE id')) return [{ affectedRows: 1 }];
      if (sql.startsWith('INSERT INTO rights')) return [{ affectedRows: 0 }];
      if (sql.startsWith('SELECT COUNT(*) AS count FROM rights WHERE usr_id')) return [[{ count: 1 }]];
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

test('portal moderator migration copies admin access and preserves user 100 as admin', async () => {
  const fixture = makePool();

  const result = await migratePortalModeratorRole(fixture.pool);

  assert.deepEqual(result, {
    moderatorRoleCreated: true,
    serviceRolesAdded: 2,
    userTypesChanged: 10,
    serviceRightsChanged: 60,
  });
  assert.equal(fixture.committed, true);
  assert.equal(fixture.rolledBack, false);
  assert.equal(fixture.released, true);

  const rightsMigration = fixture.calls.find(call => call.sql.startsWith('UPDATE rights r'));
  assert.deepEqual(rightsMigration.params, [7, 5, 5, 100]);
  const userTypeMigration = fixture.calls.find(call => call.sql.startsWith('UPDATE users SET type = ? WHERE type'));
  assert.deepEqual(userTypeMigration.params, [7, 5, 100]);
  assert.equal(fixture.calls.some(call => call.sql.startsWith('INSERT INTO rights')), true);
});

test('portal moderator migration is idempotent when the role already exists', async () => {
  const fixture = makePool({ moderatorExists: true });

  const result = await migratePortalModeratorRole(fixture.pool);

  assert.equal(result.moderatorRoleCreated, false);
  assert.equal(result.serviceRolesAdded, 0);
  assert.equal(fixture.calls.some(call => call.sql.startsWith('INSERT INTO role_name')), false);
  assert.equal(fixture.committed, true);
});
