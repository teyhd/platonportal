import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';
import { createBookpcBlock } from '../vendor/bookpc.mjs';

test('assigned laptops are filtered by portal role while an owner can still return an existing rental', async () => {
  const app = express();
  app.use((req, _res, next) => {
    req.session = { uid: Number(req.get('X-Fixture-Actor')) };
    next();
  });

  const origin = 'https://portal.example';
  const actions = [];
  createBookpcBlock({
    secret: '0'.repeat(64),
    origin,
    issuesToken: null,
    getAssignments: async () => new Map([[19, { label: 'Сотрудник' }], [25, { label: 'Психолог', room: '4', showInImportant: true }]]),
    getAssignmentAccess: async id => ({ 5: 'admin', 7: 'moderator' })[id],
    fetchImpl: async (url, options) => {
      if (options.method === 'POST') {
        actions.push(url.split('/').at(-1));
        return Response.json({ ok: true });
      }
      const own = options.headers['X-Portal-User-Id'] === '2';
      return Response.json({ devices: [
        { id: 12, state: 'free' },
        { id: 19, state: 'occupied', own, rental: own ? { id: 11, pin: '1234' } : { renter: 'Сотрудник' } },
      ] });
    },
  }).register(app);

  const server = app.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const api = 'http://127.0.0.1:' + server.address().port + '/api/bookpc';
    const request = async (id, action = '') => fetch(api + action, {
      headers: { 'X-Fixture-Actor': String(id), Origin: origin, 'Content-Type': 'application/json' },
      ...action && {
        method: 'POST', body: JSON.stringify({
          requestId: '00000000-0000-0000-0000-000000000001', computer_id: 19, rental_id: 11,
        }),
      },
    });

    const owner = await (await request(2)).json();
    assert.deepEqual(owner.devices.map(device => device.id), [12]);
    assert.deepEqual(owner.ownRentals.map(device => device.rental.pin), ['1234']);
    const moderator = await (await request(7)).json();
    assert.deepEqual(moderator.devices[1], { id: 19, state: 'occupied', assignment: {} });
    assert.deepEqual(moderator.devices[2], { id: 25, state: 'unknown', assignment: {} });
    assert.deepEqual(moderator.ownRentals, []);
    const admin = await (await request(5)).json();
    assert.deepEqual(admin.devices[1].assignment, { label: 'Сотрудник' });
    assert.deepEqual(admin.devices[2].assignment, { label: 'Психолог', room: '4', showInImportant: true });
    assert.equal((await request(5, '/rent')).status, 409);
    assert.equal((await request(2, '/return')).status, 200);
    assert.deepEqual(actions, ['return']);
  } finally {
    server.close();
    await once(server, 'close');
  }
});