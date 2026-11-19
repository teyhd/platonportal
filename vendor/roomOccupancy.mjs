const route = '/api/room-occupancy';
const schoolDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow', dateStyle: 'short' });

export function canViewRoomOccupancy(session) {
  const uid = Number(session?.uid);
  return Number.isSafeInteger(uid) && uid > 0;
}

function roomSnapshot(data, date) {
  if (data?.schema !== 1 || data.date !== date || !['published', 'unpublished'].includes(data.state) ||
      !Array.isArray(data.rooms) || !Number.isFinite(Date.parse(data.generatedAt)) ||
      !Number.isFinite(Date.parse(data.dayEnd))) {
    throw new Error('Invalid room snapshot');
  }

  const dayEnd = Date.parse(data.dayEnd);
  const dayStart = dayEnd - 86_400_000;
  const rooms = data.rooms.map(({ id, name, floor, intervals }) => {
    if (!Number.isSafeInteger(id) || id <= 0 || typeof name !== 'string' || !Array.isArray(intervals)) {
      throw new Error('Invalid room');
    }
    return {
      id,
      name,
      floor: typeof floor === 'string' && floor.length <= 40 ? floor.trim() || null : null,
      intervals: intervals.map(({ start, end }) => {
        const from = Date.parse(start);
        const until = Date.parse(end);
        if (!(dayStart <= from && from < until && until <= dayEnd)) throw new Error('Invalid room interval');
        return { start, end };
      }),
    };
  });

  return { schema: 1, date, generatedAt: data.generatedAt, dayEnd: data.dayEnd, state: data.state, rooms };
}

export function createRoomOccupancy({ env = process.env, fetchImpl = fetch, now = Date.now } = {}) {
  const token = env.MAINPORTAL_SCHEDULE_TOKEN;
  let cache;

  function load() {
    const date = schoolDate.format(now());
    if (cache?.date === date && (cache.pending || now() < cache.expiresAt)) return cache.promise;

    const request = { date, pending: true, expiresAt: 0 };
    request.promise = Promise.resolve().then(async () => {
      const url = new URL('/internal/integrations/mainportal/v1/room-occupancy',
        env.MAINPORTAL_SCHEDULE_URL || 'http://127.0.0.1:3011');
      const response = await fetchImpl(url, {
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
        redirect: 'error',
        signal: AbortSignal.timeout(4000),
      });
      if (!response.ok) throw new Error('Room source unavailable');
      const snapshot = roomSnapshot(await response.json(), date);
      request.expiresAt = now() + 15_000;
      return snapshot;
    }).finally(() => { request.pending = false; });
    cache = request;
    return request.promise;
  }

  return {
    visibleFor: session => Boolean(token) && canViewRoomOccupancy(session),
    register(app) {
      app.get(route, async (req, res) => {
        res.set('Cache-Control', 'private, no-store');
        if (!canViewRoomOccupancy(req.session)) return res.status(401).json({ error: 'authentication_required' });
        if (!token) return res.status(503).json({ error: 'room_occupancy_unavailable' });
        try {
          const snapshot = await load();
          return res.json({ ...snapshot, serverTime: new Date(now()).toISOString() });
        } catch {
          return res.status(503).json({ error: 'room_occupancy_unavailable' });
        }
      });
    },
  };
}
