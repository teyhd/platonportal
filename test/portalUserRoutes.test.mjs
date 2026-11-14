import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../platonportal.js', import.meta.url), 'utf8');
const accounts = [
  { id: 11, type: -1, name: 'External fixture' },
  { id: 12, type: 2, name: 'Internal fixture' },
  { id: 100, type: 5, name: 'Administrator fixture' },
  { id: 13, type: 2, name: 'Delegated administrator fixture', portalAdmin: true },
];

function routes() {
  const handlers = new Map();
  const calls = [];
  const find = (id, moderatorOnly) => accounts.find(account =>
    account.id === id && (!moderatorOnly || !([-1, 5].includes(account.type) || account.portalAdmin)));
  const app = Object.fromEntries(['get', 'post', 'put', 'delete'].map(method => [
    method, (path, handler) => handlers.set(`${method} ${path}`, handler),
  ]));
  const db = {
    EXTERNAL_ROLE_ID: -1, PORTAL_ADMIN_ROLE_ID: 5, PORTAL_SERVICE_ID: 1,
    async get_users({ moderatorOnly } = {}) {
      return accounts.filter(account => find(account.id, moderatorOnly));
    },
    async get_types() { return [-1, 2, 5, 7].map(id => ({ id, name: String(id) })); },
    async get_kafs() { return []; },
    async get_services_with_allowed_roles() { return []; },
    async get_all_roles() { return []; },
    async get_err_roles_users() { return []; },
    async get_managed_user_details(id, moderatorOnly) {
      const user = find(id, moderatorOnly);
      if (!user) return null;
      calls.push(['read profile and access', id]);
      return { user, rights: [], logins: [] };
    },
    async create_user() { calls.push(['create']); return 20; },
    async update_user(id, data, _pool, { moderatorOnly }) {
      if (!find(id, moderatorOnly)) return false;
      calls.push(['update', id, data.type]);
      return true;
    },
    async delete_user(id, { moderatorOnly }) {
      if (!find(id, moderatorOnly)) return false;
      calls.push(['delete', id]);
      return true;
    },
    async replace_user_rights(id, _pairs, _pool, { moderatorOnly }) {
      if (!find(id, moderatorOnly)) return null;
      calls.push(['change rights', id]);
      return { isExternal: id === 11 };
    },
    async upsert_user_logins(id, _rows, { moderatorOnly }) {
      if (!find(id, moderatorOnly)) return false;
      calls.push(['change logins', id]);
      return true;
    },
  };
  const helpers = source.slice(source.indexOf('function requirePortalManagementJson'), source.indexOf('function getHomeRoleMeta'));
  const handlersSource = source.slice(source.indexOf("app.get('/users'"), source.indexOf("app.get('/manual'"));
  runInNewContext(helpers + handlersSource, {
    app, db, PORTAL_ADMIN_ROLE_ID: 5,
    hasPortalManagementRole: session => [5, 7].includes(session?.role),
    hasPortalAdminRole: session => session?.role === 5,
    getSessionPortalRole: role => role,
    console,
  });
  return {
    calls,
    async request(method, path, role, { id = 11, body = {} } = {}) {
      const result = { status: 200 };
      const response = {
        locals: { isSignedIn: role !== 0 },
        status(code) { result.status = code; return this; },
        json(value) { result.body = value; return this; },
        render(_view, value) { result.body = value; return this; },
        redirect() { result.status = 302; },
      };
      await handlers.get(`${method} ${path}`)({ session: { role }, params: { id }, body }, response);
      return result;
    },
  };
}

const methods = [
    ['get', '/api/users/:id'],
    ['put', '/api/users/:id', { name: 'External fixture', type: 2 }],
    ['put', '/api/users/:id/rights', { pairs: [{ srv_id: 2, role_id: 2 }] }],
    ['put', '/api/users/:id/logins'],
    ['delete', '/api/users/:id'],
];

test('moderator cannot reach External or Portal Admin accounts through listings, search data or direct operations', async () => {
  const fixture = routes();
  const list = await fixture.request('get', '/users', 7);
  assert.deepEqual(Array.from(list.body.users, user => user.id), [12]);
  assert.deepEqual(Array.from(list.body.types, role => role.id), [2, 7]);
  for (const id of [11, 13, 100, 999]) {
    const results = await Promise.all(methods.map(([method, path, body]) => fixture.request(method, path, 7, { id, body })));
    assert.ok(results.every(result => result.status === 404), `unexpected status for fixture ${id}`);
  }
  assert.deepEqual(fixture.calls, []);
});

test('moderator cannot create/retype protected accounts or grant the Portal Admin role', async () => {
  const fixture = routes();
  for (const type of [-1, '5']) {
    const body = { name: 'Fixture', type };
    assert.equal((await fixture.request('post', '/api/users', 7, { body })).status, 403);
    assert.equal((await fixture.request('put', '/api/users/:id', 7, { id: 12, body })).status, 403);
  }
  assert.equal((await fixture.request('post', '/api/users', 7, { body: { name: 'Fixture', type: 4.9 } })).status, 400);
  const body = { pairs: [{ srv_id: '1', role_id: '5' }] };
  assert.equal((await fixture.request('put', '/api/users/:id/rights', 7, { id: 12, body })).status, 403);
  assert.deepEqual(fixture.calls, []);
});

test('administrator can still manage External accounts, and moderator can manage internal accounts', async () => {
  const fixture = routes();
  const list = await fixture.request('get', '/users', 5);
  assert.ok(list.body.users.some(user => user.id === 11));
  for (const [method, path, body] of methods) {
    const admin = await fixture.request(method, path, 5, { body });
    assert.equal(admin.status, 200);
    if (path.endsWith('/rights')) assert.equal(admin.body.external, true);
    assert.equal((await fixture.request(method, path, 7, { id: 12, body })).status, 200);
    for (const role of [0, 2]) assert.equal((await fixture.request(method, path, role, { body })).status, 403);
  }
});
