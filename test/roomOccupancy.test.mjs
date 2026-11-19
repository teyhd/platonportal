import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRoomOccupancy } from '../vendor/roomOccupancy.mjs';

const now = Date.parse('2026-11-19T12:00:00+03:00');
const published = {
  schema: 1, date: '2026-11-19', generatedAt: '2026-11-19T11:59:55+03:00',
  dayEnd: '2026-11-20T00:00:00+03:00', state: 'published',
  rooms: [{ id: 2, name: '14', floor: '2 этаж', intervals: [], studentName: 'Private' }],
};

function routeFor(fetchImpl, clock = () => now) {
  const service = createRoomOccupancy({ env: { MAINPORTAL_SCHEDULE_TOKEN: 'test-token' }, now: clock, fetchImpl });
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
