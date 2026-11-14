import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EXTERNAL_ROLE_ID,
  clear_external_user_rights,
  replace_user_rights,
  get_managed_user_details,
  upsert_user_logins,
  delete_user,
  update_user,
} from '../vendor/db.mjs';

function makePool({ type = EXTERNAL_ROLE_ID, updateAffectedRows = 1, hidden = false } = {}) {
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
      if (sql.startsWith('UPDATE users')) return [{ affectedRows: updateAffectedRows }];
      if (sql.startsWith('SELECT type FROM users')) return [[{ type }]];
      if (sql.startsWith('SELECT u.id FROM users')) return [hidden ? [] : [{ id: 42 }]];
      if (sql.startsWith('DELETE FROM rights')) return [{ affectedRows: 3 }];
      if (sql.startsWith('INSERT INTO rights')) return [{ affectedRows: 1 }];
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

test('saving an External profile clears its service roles atomically', async () => {
  const fixture = makePool();
  const result = await update_user(42, {
    name: 'External user',
    nickname: '', msgnickname: '', msgnickname_normalized: '', kaf: null,
    type: EXTERNAL_ROLE_ID, status: 1, pin: '', tg_id: null,
    allow_discovery_outside_harmony: 0, avatar_url_custom: '', display_name_custom: '',
    birth_date: undefined, email: undefined,
  }, fixture.pool);

  assert.equal(result, true);
  assert.equal(fixture.committed, true);
  assert.equal(fixture.rolledBack, false);
  assert.equal(fixture.released, true);
  assert.equal(fixture.calls.some(call => call.sql.startsWith('DELETE FROM rights')), true);
  assert.equal(fixture.calls.some(call => call.sql.startsWith('INSERT INTO rights')), false);
});

test('profile updates keep legacy display_name_custom when the field is omitted', async () => {
  const fixture = makePool();
  const result = await update_user(42, {
    name: 'External user',
    nickname: 'Отображаемое имя', msgnickname: '', msgnickname_normalized: '', kaf: null,
    type: EXTERNAL_ROLE_ID, status: 1, pin: '', tg_id: null,
    allow_discovery_outside_harmony: 0, avatar_url_custom: '', display_name_custom: undefined,
    birth_date: undefined, email: undefined,
  }, fixture.pool);

  assert.equal(result, true);
  const update = fixture.calls.find(call => call.sql.startsWith('UPDATE users'));
  assert.match(update.sql, /display_name_custom = CASE WHEN \? THEN \? ELSE display_name_custom END/);
  assert.equal(update.params[11], 0);
  assert.equal(update.params[12], null);
});

test('saving roles for an External user removes rights instead of inserting them', async () => {
  const fixture = makePool();
  const result = await replace_user_rights(42, [{ srv_id: 1, role_id: 2 }], fixture.pool);

  assert.deepEqual(result, { isExternal: true });
  assert.equal(fixture.committed, true);
  assert.equal(fixture.calls.some(call => call.sql.startsWith('DELETE FROM rights')), true);
  assert.equal(fixture.calls.some(call => call.sql.startsWith('INSERT INTO rights')), false);
});

test('bulk cleanup targets only External accounts', async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return [{ affectedRows: 55 }];
    },
  };

  const removed = await clear_external_user_rights(pool);

  assert.equal(removed, 55);
  assert.match(calls[0].sql, /JOIN users u ON u\.id = r\.usr_id/);
  assert.deepEqual(calls[0].params, [EXTERNAL_ROLE_ID]);
});

test('protected targets are rejected inside the DB transaction before any profile, credential or access operation', async () => {
  const checks = [
    pool => get_managed_user_details(42, true, pool),
    pool => update_user(42, { name: 'Fixture', type: 2 }, pool, { moderatorOnly: true }),
    pool => replace_user_rights(42, [{ srv_id: 2, role_id: 2 }], pool, { moderatorOnly: true }),
    pool => upsert_user_logins(42, [{ srv_id: 2, login: 'fixture' }], { moderatorOnly: true }, pool),
    pool => delete_user(42, { moderatorOnly: true }, pool),
  ];
  for (const check of checks) {
    const fixture = makePool({ hidden: true });
    assert.ok(!await check(fixture.pool));
    assert.equal(fixture.calls.length, 2);
    assert.match(fixture.calls[0].sql, /FOR UPDATE$/);
    assert.match(fixture.calls[1].sql, /u\.type <> -1/);
    assert.match(fixture.calls[1].sql, /u\.type <> 5/);
    assert.match(fixture.calls[1].sql, /u\.id <> 100/);
    assert.match(fixture.calls[1].sql, /admin_right\.srv_id = 1\s+AND admin_right\.role_id = 5/);
    assert.ok(fixture.rolledBack && fixture.released && !fixture.committed);
  }
});
