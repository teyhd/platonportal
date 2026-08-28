import assert from 'node:assert/strict';
import test from 'node:test';

import { fill_missing_user_birth_dates } from '../vendor/db.mjs';

function makePool(users) {
  const calls = [];
  let committed = false;
  let rolledBack = false;
  let released = false;

  const connection = {
    async beginTransaction() {},
    async commit() { committed = true; },
    async rollback() { rolledBack = true; },
    release() { released = true; },
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.startsWith('SELECT id, DATE_FORMAT(birth_date')) return [users];
      if (sql.startsWith('UPDATE users SET birth_date')) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected query: ${sql}`);
    },
  };

  return {
    pool: { async getConnection() { return connection; } },
    calls,
    get committed() { return committed; },
    get rolledBack() { return rolledBack; },
    get released() { return released; },
  };
}

test('fills only empty birth dates in one transaction', async () => {
  const fixture = makePool([
    { id: 11, birth_date: null },
    { id: 12, birth_date: '2000-01-02' },
  ]);

  const result = await fill_missing_user_birth_dates([
    { id: 11, birthDate: '1990-03-04' },
    { id: 12, birth_date: '2001-05-06' },
  ], fixture.pool);

  assert.deepEqual(result, { updated: 1, alreadyPresent: 1 });
  assert.equal(fixture.committed, true);
  assert.equal(fixture.rolledBack, false);
  assert.equal(fixture.released, true);

  const update = fixture.calls.find(call => call.sql.startsWith('UPDATE users SET birth_date'));
  assert.deepEqual(update.params, ['1990-03-04', 11]);
});

test('rolls back if any requested user is absent', async () => {
  const fixture = makePool([{ id: 11, birth_date: null }]);

  await assert.rejects(
    fill_missing_user_birth_dates([
      { id: 11, birthDate: '1990-03-04' },
      { id: 12, birthDate: '1991-05-06' },
    ], fixture.pool),
    /were not found/
  );

  assert.equal(fixture.committed, false);
  assert.equal(fixture.rolledBack, true);
  assert.equal(fixture.released, true);
});

test('rejects invalid and conflicting date input before changing data', async () => {
  await assert.rejects(
    fill_missing_user_birth_dates([{ id: 11, birthDate: '1990-02-30' }], { getConnection() { throw new Error('must not connect'); } }),
    /valid user id and ISO date/
  );

  await assert.rejects(
    fill_missing_user_birth_dates([
      { id: 11, birthDate: '1990-03-04' },
      { id: 11, birthDate: '1991-05-06' },
    ], { getConnection() { throw new Error('must not connect'); } }),
    /conflicting/
  );
});
