import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { randomUUID } from 'node:crypto';
import { readRoomAccess } from '../vendor/vcall.mjs';

// Exercise the real handlers while isolating the main app's DB, auth and conference SDK.
const appSource = await readFile(new URL('../platonportal.js', import.meta.url), 'utf8');
const routesSource = appSource.slice(appSource.indexOf('function getVcallUser'), appSource.indexOf("app.get('/getanalyt'"));
const host = { uid: 42, name: 'Test Host', right: 2 };

function room(overrides = {}) {
  return {
    room_info: {
      room_id: 'testhost', room_title: 'Test room', joined_participants: 4,
      metadata: JSON.stringify({ extra_data: JSON.stringify({ pub: true, need_auth: true, portal_owner: host.uid, ...overrides }) }),
    },
    participants_info: [{ metadata: 'not shared' }],
  };
}

function setup({ active = room(), listed = [room()], actions = ['#lesson', '#room'], fail = false } = {}) {
  const routes = new Map();
  const calls = { created: [], joined: [], lookups: [] };
  runInNewContext(routesSource, {
    app: {
      get: (path, handler) => routes.set(`GET ${path}`, handler),
      post: (path, handler) => routes.set(`POST ${path}`, handler),
    },
    db: { get_cards: async () => actions.map(cont => ({ type: 0, cont })) },
    hlp: { translit: name => name.toLowerCase().replace(/\s/g, '') },
    getSessionPortalRole: right => right,
    getPortalCatalogRole: role => role,
    vcall: {
      readRoomAccess,
      async get_active_room(id) {
        calls.lookups.push(id);
        if (fail) throw new Error('upstream unavailable');
        return active;
      },
      async create_room(id, name, access) {
        calls.created.push({ id, name, ...access });
        return { status: true, room_info: room(access).room_info };
      },
      async get_link(...args) {
        calls.joined.push(args);
        return { link: 'https://meet.example.test/' };
      },
      async rooms_info() {
        if (fail) throw new Error('upstream unavailable');
        return { rooms: listed };
      },
    },
    crypto: { randomUUID }, URLSearchParams,
  });

  return {
    calls,
    async request(method, path, { session = {}, query = {}, body } = {}) {
      const result = { status: 200 };
      const res = {
        set() {},
        status(status) { result.status = status; return this; },
        json(payload) { result.payload = JSON.parse(JSON.stringify(payload)); },
        redirect(location) { result.status = 302; result.location = location; },
        render(view, data) { result.view = view; result.data = data; },
      };
      await routes.get(`${method} ${path}`)({ method, session, query, body }, res);
      return result;
    },
  };
}

test('private invite resumes after PIN login and public invite does not create a portal identity', async () => {
  const protectedRoom = setup();
  const guest = {};
  const invite = { roomid: 'testhost' };
  const auth = await protectedRoom.request('GET', '/jointo', { query: invite, session: guest });
  assert.equal(auth.location, '/auth');
  assert.deepEqual(guest, { return_to: '/jointo?roomid=testhost' });
  assert.equal(protectedRoom.calls.joined.length, 0);

  const publicRoom = setup({ active: room({ need_auth: false }) });
  const anonymousSession = {};
  const entry = await publicRoom.request('GET', '/jointo', { query: invite, session: anonymousSession });
  assert.equal(entry.location, 'https://meet.example.test/');
  assert.deepEqual(anonymousSession, {});
  assert.match(publicRoom.calls.joined[0][2], /^guest-/);
  assert.equal(publicRoom.calls.joined[0][3], false);

  const hostSession = {};
  const hostEntry = await publicRoom.request('GET', '/jointo', { query: { ...invite, host: '1' }, session: hostSession });
  assert.equal(hostEntry.location, '/auth');
  assert.deepEqual(hostSession, { return_to: '/jointo?roomid=testhost&host=1' });
});

test('room ownership applies to authenticated account IDs, with action access checked for hosts', async () => {
  const invite = { roomid: 'testhost' };
  const service = setup();
  await service.request('GET', '/jointo', { session: { ...host, uid: 43 }, query: invite });
  await service.request('GET', '/jointo', { session: host, query: invite });
  assert.deepEqual(service.calls.joined.map(call => call[3]), [false, true]);

  const blocked = setup({ actions: ['#room'] });
  await blocked.request('GET', '/jointo', { session: host, query: invite });
  assert.equal(blocked.calls.joined[0][3], false);
  assert.equal((await blocked.request('POST', '/getvlinks', { session: host })).status, 403);
});

test('GET lesson status does not create rooms and POST persists explicit boolean settings', async () => {
  const service = setup({ active: null });
  const options = { session: host };
  assert.deepEqual((await service.request('GET', '/getvlinks', options)).payload, { active: false });
  assert.equal((await service.request('POST', '/getvlinks', { ...options, body: { pub: 'false', need_auth: 'true' } })).status, 400);
  assert.equal(service.calls.created.length, 0);
  const created = await service.request('POST', '/getvlinks', { ...options, body: { pub: false, need_auth: true } });
  assert.deepEqual(created.payload, { active: true, roomid: '/jointo?roomid=testhost', joinPath: '/jointo?roomid=testhost&host=1', acc: { pub: false, need_auth: true } });
  assert.deepEqual({ ...service.calls.created[0] }, { id: 'testhost', name: host.name, pub: false, need_auth: true, portal_owner: host.uid });
});

test('invalid or inactive invites never mint a token or create a room', async () => {
  const service = setup({ active: null });
  const invalid = await service.request('GET', '/jointo', { query: { roomid: ['testhost', 'other'] } });
  assert.equal(invalid.status, 400);
  assert.equal(service.calls.lookups.length, 0);
  const closed = await service.request('GET', '/jointo', { query: { roomid: 'testhost' } });
  assert.equal(closed.status, 404);
  assert.equal(closed.data.retryHref, '/jointo?roomid=testhost');
  assert.equal(service.calls.joined.length + service.calls.created.length, 0);
  const failed = await setup({ fail: true }).request('GET', '/jointo', { query: { roomid: 'testhost' } });
  assert.equal(failed.status, 502);
});

test('room list only returns public metadata and requires the list action', async () => {
  const service = setup({ listed: [room(), room({ pub: false }), room({ portal_owner: null }), null] });
  const result = await service.request('GET', '/rooms', { session: host });
  assert.deepEqual(result.payload, {
    status: true,
    rooms: [{ room_info: { room_id: 'testhost', room_title: 'Test room', joined_participants: 4 } }],
    acc: { testhost: { pub: true, need_auth: true } },
  });
  assert.equal((await service.request('GET', '/rooms')).status, 401);
  assert.equal((await setup({ actions: ['#lesson'] }).request('GET', '/rooms', { session: host })).status, 403);
  assert.equal((await setup({ fail: true }).request('GET', '/rooms', { session: host })).status, 502);
});

test('room policy rejects missing data and treats legacy rooms as unlisted with PIN access', () => {
  assert.equal(readRoomAccess({}), null);
  assert.equal(readRoomAccess({ metadata: '{' }), null);
  assert.equal(readRoomAccess(room({ need_auth: 'maybe' }).room_info), null);
  assert.deepEqual(readRoomAccess(room({ pub: 'true', need_auth: 'false', portal_owner: null }).room_info), { pub: false, need_auth: true, owner: null });
});
