import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ensurePrimaryServiceRightsForUser,
  get_err_roles_users,
  repairPrimaryServiceRightsForRoles,
} from '../vendor/db.mjs';

test('primary service rights follow the configured role-to-service mapping', async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return [{ affectedRows: 4 }];
    },
  };

  const added = await ensurePrimaryServiceRightsForUser(42, pool);

  assert.equal(added, 4);
  assert.match(calls[0].sql, /JOIN \(\s*SELECT DISTINCT srvs_id, role_id\s*FROM srvs_roles/);
  assert.match(calls[0].sql, /existing\.role_id = u\.type/);
  assert.match(calls[0].sql, /service\.id < \?/);
  assert.deepEqual(calls[0].params, [42, -1, 10]);
});

test('bulk repair adds only missing primary service roles in one transaction', async () => {
  const calls = [];
  let committed = false;
  let released = false;
  const connection = {
    async beginTransaction() {},
    async commit() { committed = true; },
    async rollback() { assert.fail('repair should not roll back'); },
    release() { released = true; },
    async query(sql, params) {
      calls.push({ sql, params });
      return [{ affectedRows: 12 }];
    },
  };

  const added = await repairPrimaryServiceRightsForRoles([1, 2, 6, 2], {
    async getConnection() { return connection; },
  });

  assert.equal(added, 12);
  assert.equal(committed, true);
  assert.equal(released, true);
  assert.match(calls[0].sql, /u\.type IN \(\?, \?, \?\)/);
  assert.deepEqual(calls[0].params, [1, 2, 6, 10]);
});

test('access issues require the user primary role only where the service permits it', async () => {
  const calls = [];
  const pool = {
    async query(sql) {
      calls.push(sql);
      return [[]];
    },
  };

  await get_err_roles_users(pool);

  assert.match(calls[0], /allowed\.role_id = u\.type/);
  assert.match(calls[0], /r\.role_id = u\.type/);
  assert.match(calls[0], /u\.lifecycle_state = 'active'/);
});
