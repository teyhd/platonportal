import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const adapters = {
  schedule: {
    origin: 'https://rasp.platoniks.ru', port: 3011, key: 'MAINPORTAL_SCHEDULE_TOKEN',
    base: 'MAINPORTAL_SCHEDULE_URL', childPath: '/audit/schedule/personal', childParam: 'child_id',
  },
  diary: {
    origin: 'https://diary.platoniks.ru', port: 3003, key: 'MAINPORTAL_DIARY_KEY',
    base: 'MAINPORTAL_DIARY_URL', childPath: '/audit/children/overview?viewer=parent', childParam: 'studentId',
  },
  calendar: {
    origin: 'https://event.platoniks.ru', port: 3031, key: 'MAINPORTAL_CALENDAR_KEY',
    base: 'MAINPORTAL_CALENDAR_URL', childAtExchange: true,
  },
  progress: {
    origin: 'https://rep.platoniks.ru', port: 89, key: 'MAINPORTAL_PROGRESS_KEY',
    base: 'MAINPORTAL_PROGRESS_URL', childAtExchange: true,
  },
  attendance: {
    origin: 'https://stud.platoniks.ru', port: 789, key: 'ATTENDANCE_MAINPORTAL_SERVICE_KEY',
    base: 'MAINPORTAL_ATTENDANCE_URL',
  },
  portal: {
    origin: 'https://platoniks.ru', port: 777, key: 'SESSION_SECRET', directory: 1,
  },
  bookpc: {
    origin: 'https://pc.platoniks.ru', port: 81, key: 'BOOKPC_SSO_CLIENT_SECRET', directory: 2,
  },
  buy: {
    origin: 'https://buy.platoniks.ru', port: 3012, key: 'BUY_SSO_CLIENT_SECRET', directory: 12,
  },
  vote: {
    origin: 'https://vote.platoniks.ru', port: 3020, key: 'VOTE_SSO_CLIENT_SECRET', directory: 14,
  },
};

const hash = value => createHash('sha256').update(value).digest();

export function createNativeServicePreview({ env = process.env, fetchImpl = fetch } = {}) {
  const adapterFor = service => Object.hasOwn(adapters, service) ? adapters[service] : null;
  const keyFor = (adapter, service) => {
    const base = env[adapter?.key];
    if (!base || !adapter?.directory) return base;
    return createHmac('sha256', base).update('mainportal:role-preview:v1:' + service).digest('hex');
  };
  return {
    supports: service => Boolean(keyFor(adapterFor(service), service)),
    directoryService(service, authorization) {
      const adapter = adapterFor(service);
      const key = keyFor(adapter, service);
      if (!adapter?.directory || !key || !timingSafeEqual(hash(authorization), hash('Bearer ' + key))) return null;
      return adapter.directory;
    },
    async launch(service, { actorId, targetId, childId }) {
      const adapter = adapterFor(service);
      const token = keyFor(adapter, service);
      if (!token) return null;
      const endpoint = new URL('/internal/integrations/mainportal/v1/role-preview',
        env[adapter.base] || 'http://127.0.0.1:' + adapter.port);
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actor_id: actorId,
          subject_id: targetId,
          ...(adapter.childAtExchange && childId ? { child_id: childId } : {}),
        }),
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      });
      if (response.status === 403) return null;
      if (!response.ok) throw new Error('Native preview unavailable');
      const { code } = await response.json();
      if (typeof code !== 'string' || !/^[a-f0-9]{64}$/.test(code)) throw new Error('Invalid native preview code');
      const destination = new URL(childId && adapter.childPath ? adapter.childPath : '/audit/', adapter.origin);
      if (childId && adapter.childParam) destination.searchParams.set(adapter.childParam, childId);
      destination.hash = 'code=' + code;
      return destination.href;
    },
  };
}
