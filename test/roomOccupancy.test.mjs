import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRoomOccupancy } from '../vendor/roomOccupancy.mjs';

const now = Date.parse('2026-11-19T12:00:00+03:00');
const published = {
  schema: 1, date: '2026-11-19', generatedAt: '2026-11-19T11:59:55+03:00',
  dayEnd: '2026-11-20T00:00:00+03:00', state: 'published',
  rooms: [{ id: 2, name: '14', floor: '2 этаж', intervals: [], studentName: 'Private' }],
};

function routeFor(fetchImpl, clock = () => now, options = {}) {
  const service = createRoomOccupancy({
    env: { MAINPORTAL_SCHEDULE_TOKEN: 'test-token', ...options.env },
    now: clock, fetchImpl, canReadIssues: options.canReadIssues,
  });
  let route;
  service.register({ get(path, handler) {
    assert.equal(path, '/api/room-occupancy');
    route = handler;
  } });
  return {
    service,
    async request(uid) {
      const result = { status: 200, headers: {} };
      await route({ session: { uid } }, {
        set(key, value) { result.headers[key] = value; return this; },
        status(code) { result.status = code; return this; },
        json(data) { result.body = data; return this; },
      });
      return result;
    },
  };
}

test('guest requests never reach the schedule integration', async () => {
  let requested = false;
  const { service, request } = routeFor(() => { requested = true; });
  assert.equal(service.visibleFor({}), false);
  assert.equal((await request()).status, 401);
  assert.equal(requested, false);
});

test('shares occupancy between signed-in sessions without forwarding identity or personal fields', async () => {
  let requested = 0;
  const { service, request } = routeFor((url, options) => {
    requested += 1;
    assert.equal(url.pathname, '/internal/integrations/mainportal/v1/room-occupancy');
    assert.equal(url.search, '');
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    return Response.json(published);
  });
  assert.equal(service.visibleFor({ uid: 100 }), true);
  const [first, second] = await Promise.all([request(100), request(101)]);
  assert.equal(requested, 1);
  assert.equal(first.status, 200);
  assert.equal(first.headers['Cache-Control'], 'private, no-store');
  assert.deepEqual(first.body, second.body);
  assert.deepEqual(first.body.rooms, [{ id: 2, name: '14', floor: '2 этаж', intervals: [] }]);
  assert.equal(first.body.serverTime, '2026-11-19T09:00:00.000Z');
});

test('rejects previous-day data after local midnight', async () => {
  let time = Date.parse('2026-11-19T23:59:58+03:00');
  const { request } = routeFor(() => Response.json(published), () => time);
  assert.equal((await request(100)).status, 200);
  time += 3000;
  assert.equal((await request(100)).status, 503);
});

test('rejects invalid occupied intervals instead of showing the room as free', async () => {
  const { request } = routeFor(() => Response.json({
    ...published,
    rooms: [{ id: 8, name: '8', intervals: [{ start: 'invalid', end: published.dayEnd }] }],
  }));
  assert.equal((await request(100)).status, 503);
});

test('only members of Заявки see matching current incidents and floors come from the schedule', async () => {
  let issueCalls = 0;
  const { request } = routeFor((url, options) => {
    if (url.pathname.endsWith('/room-occupancy')) return Response.json({
      ...published,
      rooms: [...published.rooms,
        { id: 9, name: '14 ложа', floor: null, intervals: [] },
        { id: 10, name: '5', floor: '1 этаж', intervals: [] }],
    });
    issueCalls++;
    assert.equal(options.headers.Authorization, 'Bearer issues-test-token');
    return Response.json({ schema: 1, rooms: [
      { roomName: 'Кабинет 14 (Робототехника)', floor: '3 этаж', count: 2, title: 'Нет сигнала\n проекции', author: 'Private' },
      { roomName: 'Кабинет 5', count: 1, title: 'Сбой' },
      { roomName: '5', count: 0 },
    ] });
  }, undefined, { env: { MAINPORTAL_ROOM_ISSUES_TOKEN: 'issues-test-token' }, canReadIssues: uid => uid === 100 });

  assert.equal((await request(101)).body.rooms[0].issue, undefined);
  assert.equal(issueCalls, 0);
  const [first, second] = await Promise.all([request(100), request(100)]);
  assert.equal(issueCalls, 1);
  assert.deepEqual(first.body.rooms, second.body.rooms);
  const [room, named, ambiguous] = first.body.rooms;
  assert.deepEqual(room.issue, { count: 2, title: 'Нет сигнала проекции' });
  assert.equal(room.floor, '2 этаж');
  assert.equal(named.issue, undefined);
  assert.equal(ambiguous.issue, undefined);
  assert.equal((await request(101)).body.rooms[0].issue, undefined);
});

test('an outage in Заявки still returns occupancy', async () => {
  const { request } = routeFor(url => url.pathname.endsWith('/room-issues')
    ? new Response(null, { status: 503 }) : Response.json(published), undefined, {
    env: { MAINPORTAL_ROOM_ISSUES_TOKEN: 'issues-test-token' },
    canReadIssues: () => true,
  });
  const result = await request(100);
  assert.equal(result.status, 200);
  assert.equal(result.body.issueStatus, 'unavailable');
  assert.deepEqual(result.body.rooms, [{ id: 2, name: '14', floor: '2 этаж', intervals: [] }]);
});
