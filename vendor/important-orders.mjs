import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

const stages = new Map([
  ['На рассмотрении', 1],
  ['Закупаем', 2],
  ['Доставляем', 3],
  ['Ожидает получения', 4],
  ['Получен', 5],
]);
const ordersPage = 'https://buy.platoniks.ru/myorders';
const receiptWindowMs = 7 * 24 * 60 * 60 * 1000;

function configuredKey() {
  try {
    return readFileSync('/etc/platonportal/orders.key', 'utf8').trim();
  } catch {
    return '';
  }
}

export function createImportantOrders({
  key = process.env.MAINPORTAL_ORDERS_KEY || configuredKey(),
  upstream = process.env.MAINPORTAL_ORDERS_URL || 'http://127.0.0.1:3012',
  fetchImpl = fetch,
  now = Date.now,
} = {}) {
  return async actorId => {
    if (!key || !Number.isSafeInteger(actorId) || actorId <= 0) return null;
    const body = JSON.stringify({ actorId });
    const time = now();
    const timestamp = String(Math.floor(time / 1000));
    const signature = createHmac('sha256', key).update(`${timestamp}\n${body}`).digest('hex');
    try {
      const response = await fetchImpl(new URL('/internal/v1/mainportal/orders', upstream), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Mainportal-Timestamp': timestamp,
          'X-Mainportal-Signature': signature,
        },
        body,
        redirect: 'error',
        signal: AbortSignal.timeout(2500),
      });
      if (!response.ok) return null;
      const payload = await response.json();
      if (!Array.isArray(payload?.items)) return null;
      const items = payload.items.flatMap(item => {
        const stage = stages.get(item?.status);
        const title = typeof item?.title === 'string' ? item.title.trim() : '';
        const id = Number(item?.id);
        if (stage === undefined || !title || !Number.isSafeInteger(id) || id <= 0) return [];
        if (stage === 5) {
          const receivedAt = Date.parse(item.receivedAt);
          if (!Number.isFinite(receivedAt) || receivedAt > time || receivedAt < time - receiptWindowMs) return [];
        }
        const quantity = Number(item.quantity);
        return [{
          id, title, stage, status: item.status,
          ...(Number.isFinite(quantity) && quantity > 0 ? { quantity } : {}),
        }];
      });
      if (!items.length) return null;
      return { href: ordersPage, total: items.length, items };
    } catch {
      return null;
    }
  };
}
