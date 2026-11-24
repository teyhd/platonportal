import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { createImportantOrders } from '../vendor/important-orders.mjs';
import { createImportantService } from '../vendor/important.mjs';

test('orders use a server-signed actor and return only known tracking fields', async () => {
  const time = Date.parse('2026-11-24T09:00:00.000Z');
  const load = createImportantOrders({
    key: 'fixture',
    now: () => time,
    fetchImpl: async (url, options) => {
      assert.equal(url.pathname, '/internal/v1/mainportal/orders');
      assert.deepEqual(JSON.parse(options.body), { actorId: 42 });
      const timestamp = options.headers['X-Mainportal-Timestamp'];
      assert.equal(options.headers['X-Mainportal-Signature'], createHmac('sha256', 'fixture')
        .update(`${timestamp}\n${options.body}`).digest('hex'));
      return Response.json({ total: 6, items: [
        { id: 7, title: 'Кабель', status: 'Ожидает получения', quantity: 2, comment: 'private' },
        { id: 8, title: 'Переходник', status: 'Отменен', price: 17 },
        { id: 9, title: 'Датчик', status: 'Получен', receivedAt: '2026-11-17T09:00:00.000Z' },
        { id: 10, title: 'Коннектор', status: 'Получен', receivedAt: '2026-11-17T08:59:59.999Z' },
        { id: 11, title: 'Маркер', status: 'Получен' },
        { id: 12, title: 'Фильтр', status: 'Получен', receivedAt: '2026-11-24T09:00:00.001Z' },
      ] });
    },
  });
  assert.deepEqual(await load(42), {
    total: 2, href: 'https://buy.platoniks.ru/myorders', items: [
      { id: 7, title: 'Кабель', status: 'Ожидает получения', quantity: 2, stage: 4 },
      { id: 9, title: 'Датчик', status: 'Получен', stage: 5 },
    ],
  });
});

test('personal summary requests orders only for the actor with service rights', async () => {
  const calls = [];
  const service = createImportantService({
    env: { IMPORTANT_ENABLED: '1' },
    getRights: async id => id === 42 ? [{srv_id: 12,role_id: 1}] : [],
    loadOrders: async id => {
      calls.push(id);
      return { total: 1, items: [{id: 7,title: 'Кабель',status: 'Доставляем',stage: 3}] };
    },
  });
  const own = await service.summary({ uid: 42 }, { actorId: 99 });
  assert.equal(own.orders.items[0].id, 7);
  assert.equal(own.visible, true);
  assert.equal((await service.summary({ uid: 43 }, {})).orders, undefined);
  assert.equal((await service.summary({ uid: 42 }, {context:'school'})).orders, undefined);
  assert.deepEqual(calls, [42]);
});
