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

function roomNameKey(name) {
  const label = name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
  const numbered = /^(?:кабинет )?(\d+)(?: \([^()]+\))?$/.exec(label);
  return numbered ? numbered[1].replace(/^0+(?=\d)/, '') : label;
}

function indexRoomIssues(data) {
  if (data?.schema !== 1 || !Array.isArray(data.rooms)) throw new Error('Invalid room issues');
  const issues = new Map();
  for (const { roomName, count, title } of data.rooms) {
    if (typeof roomName !== 'string' || !roomName.trim() || !Number.isSafeInteger(count) || count < 0 ||
        (count > 0 && (typeof title !== 'string' || !title.trim()))) {
      throw new Error('Invalid room issue');
    }
    const key = roomNameKey(roomName);
    if (issues.has(key) || !count) {
      issues.set(key, null);
      continue;
    }
    const cleanTitle = title.trim().replace(/\s+/g, ' ');
    const characters = Array.from(cleanTitle);
    issues.set(key, { count, title: characters.length > 140 ? characters.slice(0, 139).join('') + '…' : cleanTitle });
  }
  return issues;
}

export function createRoomOccupancy({
  env = process.env, fetchImpl = fetch, now = Date.now, canReadIssues = () => false,
} = {}) {
  const token = env.MAINPORTAL_SCHEDULE_TOKEN;
  const issueToken = env.MAINPORTAL_ROOM_ISSUES_TOKEN;
  let cache;
  let issueCache;

  function loadIssues() {
    if (issueCache && now() < issueCache.expiresAt) return issueCache.promise;
    const current = { expiresAt: Infinity };
    current.promise = Promise.resolve().then(async () => {
      const url = new URL('/internal/integrations/mainportal/v1/room-issues',
        env.MAINPORTAL_ROOM_ISSUES_URL || 'http://127.0.0.1:18181');
      const response = await fetchImpl(url, {
        headers: { Accept: 'application/json', Authorization: `Bearer ${issueToken}` },
        redirect: 'error',
        signal: AbortSignal.timeout(2500),
      });
      if (!response.ok) throw new Error('Room issues unavailable');
      return indexRoomIssues(await response.json());
    }).then(issues => {
      current.expiresAt = now() + 15_000;
      return issues;
    }, () => {
      current.expiresAt = now() + 5000;
      return null;
    });
    issueCache = current;
    return current.promise;
  }

  async function issuesFor(uid) {
    if (!issueToken) return undefined;
    try {
      return await canReadIssues(Number(uid)) ? await loadIssues() : undefined;
    } catch {
      return null;
    }
  }

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
          const [snapshot, issues] = await Promise.all([load(), issuesFor(req.session.uid)]);
          const result = { ...snapshot, serverTime: new Date(now()).toISOString() };
          if (issues === null) result.issueStatus = 'unavailable';
          if (issues) {
            const roomKeys = snapshot.rooms.map(room => roomNameKey(room.name));
            const unique = new Set(), ambiguous = new Set();
            for (const key of roomKeys) {
              if (unique.has(key)) ambiguous.add(key);
              unique.add(key);
            }
            result.rooms = snapshot.rooms.map((room, index) => {
              const key = roomKeys[index];
              const issue = !ambiguous.has(key) && issues.get(key);
              return issue ? { ...room, issue } : room;
            });
          }
          return res.json(result);
        } catch {
          return res.status(503).json({ error: 'room_occupancy_unavailable' });
        }
      });
    },
  };
}
