import assert from 'node:assert/strict';
import test from 'node:test';

import { auth_user } from '../vendor/db.mjs';

test('auth_user authenticates only active accounts', async () => {
  let query;
  const pool = {
    async query(sql, params) {
      query = { sql, params };
      return [[{ id: 42, name: 'Тестовый пользователь', role: 1 }]];
    },
  };

  const user = await auth_user('1234', pool);

  assert.deepEqual(user, { id: 42, name: 'Тестовый пользователь', role: 1 });
  assert.deepEqual(query.params, ['1234']);
  assert.match(query.sql, /status\s*=\s*1/i);
  assert.match(query.sql, /lifecycle_state\s*=\s*'active'/i);
});

test('auth_user returns undefined when no active account matches the PIN', async () => {
  const pool = { query: async () => [[]] };

  assert.equal(await auth_user('0000', pool), undefined);
});
