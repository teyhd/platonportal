import crypto from 'node:crypto';
import { isIP } from 'node:net';

const prefix = 'sso:security:v1:';
export const activityDays = 30;
const historySeconds = activityDays * 86400;
const historySize = 300;
const touchInterval = 5 * 60 * 1000;
export const accountSessionPrefixes = {
  portal: 'sso:session:',
  telegram: 'tma:session:',
};

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function accountSessionId(kind, sid) {
  return digest(`${kind}:${sid}`);
}

function sessionKey(kind, sid) {
  return `${accountSessionPrefixes[kind]}${sid}`;
}

function metadataKey(id) {
  return `${prefix}session:${id}`;
}

function revokedKey(id) {
  return `${prefix}revoked:${id}`;
}

function indexKey(uid) {
  return `${prefix}index:${uid}`;
}

function historyKey(uid) {
  return `${prefix}activity:${uid}`;
}

function readMetadata(raw) {
  return raw ? JSON.parse(raw) : null;
}

export function describeDevice(userAgent = '', kind = 'portal') {
  const ua = String(userAgent).slice(0, 512);
  let device = 'Устройство не определено';
  let deviceType = '';
  if (/iPad/i.test(ua)) [device, deviceType] = ['iPad', 'tablet'];
  else if (/iPhone|iPod/i.test(ua)) [device, deviceType] = ['iPhone', 'mobile'];
  else if (/Android/i.test(ua)) {
    deviceType = /Mobile/i.test(ua) ? 'mobile' : 'tablet';
    device = deviceType === 'tablet' ? 'Планшет Android' : 'Телефон Android';
  } else if (/Windows/i.test(ua)) [device, deviceType] = ['Windows', 'desktop'];
  else if (/Macintosh|Mac OS/i.test(ua)) [device, deviceType] = ['Mac', 'desktop'];
  else if (/CrOS/i.test(ua)) [device, deviceType] = ['ChromeOS', 'desktop'];
  else if (/Linux/i.test(ua)) [device, deviceType] = ['Linux', 'desktop'];

  let browser = '';
  if (kind === 'telegram') browser = 'Telegram Mini App';
  else if (/Edg[eiA]?\//i.test(ua)) browser = 'Microsoft Edge';
  else if (/OPR\/|Opera/i.test(ua)) browser = 'Opera';
  else if (/YaBrowser\//i.test(ua)) browser = 'Яндекс Браузер';
  else if (/SamsungBrowser\//i.test(ua)) browser = 'Samsung Internet';
  else if (/FxiOS\/|Firefox\//i.test(ua)) browser = 'Firefox';
  else if (/; wv\)|Telegram/i.test(ua)) browser = 'Встроенный браузер';
  else if (/CriOS\/|Chrome\//i.test(ua)) browser = 'Chrome';
  else if (/Safari\//i.test(ua)) browser = 'Safari';
  else if (ua) browser = 'Браузер не определён';
  return { device, deviceType, browser };
}

function requestDevice(req, kind) {
  const ip = String(req?.ip || '').replace(/^::ffff:/i, '');
  return req ? { ...describeDevice(req.get('user-agent'), kind), ip: isIP(ip) ? ip : '' } : {};
}

// The Express session keys are authoritative. The index stores only display metadata.
// Lua keeps ownership checks, session removal and audit events in one Redis operation.
const lua = `
local p, now, uid = ARGV[1], tonumber(ARGV[2]), ARGV[3]
local historySeconds, historySize = tonumber(ARGV[4]), tonumber(ARGV[5])
local function load(key)
  local raw = redis.call('GET', key)
  if raw then return cjson.decode(raw) end
end
local function owned(key)
  local value = load(key)
  return value and tostring(value.uid) == uid
end
local index = p .. 'index:' .. uid
local function save(record)
  local ttl = redis.call('PTTL', record.key)
  if ttl <= 0 then return false end
  redis.call('SET', p .. 'session:' .. record.id, cjson.encode(record), 'PX', ttl + 600000)
  redis.call('ZADD', index, now + ttl + 600000, record.id)
  redis.call('ZREMRANGEBYSCORE', index, '-inf', now)
  local remaining = redis.call('PTTL', index)
  if remaining < ttl + 600000 then redis.call('PEXPIRE', index, ttl + 600000) end
  return true
end
local function addEvent(event)
  local history = p .. 'activity:' .. uid
  redis.call('ZADD', history, now, cjson.encode(event))
  redis.call('ZREMRANGEBYSCORE', history, '-inf', now - historySeconds * 1000)
  redis.call('ZREMRANGEBYRANK', history, 0, -historySize - 1)
  redis.call('EXPIRE', history, historySeconds)
end
`;

const noteSessionScript = `${lua}
local incoming = cjson.decode(ARGV[6])
if redis.call('EXISTS', p .. 'revoked:' .. incoming.id) == 1 then return 0 end
if redis.call('EXISTS', p .. 'revoked:' .. incoming.groupId) == 1 then return 0 end
if incoming.parentKey and not owned(incoming.parentKey) then return 0 end
if not owned(incoming.key) then return 0 end
local record = load(p .. 'session:' .. incoming.id)
if record then
  local repair = not record.sid or record.groupId ~= incoming.groupId
  if repair then
    record.sid = incoming.sid
    record.groupId = incoming.groupId
    record.parentKey = incoming.parentKey
  end
  local update = incoming.lastSeenAt and (not record.lastSeenAt or now - record.lastSeenAt >= tonumber(ARGV[7]))
  if not repair and not update then return 1 end
  if update then
    record.lastSeenAt = incoming.lastSeenAt
    record.device = incoming.device
    record.browser = incoming.browser
    record.deviceType = incoming.deviceType
    record.ip = incoming.ip
  end
else
  record = incoming
end
if not save(record) then return 0 end
if incoming.createdAt then
  addEvent({type = incoming.method, device = incoming.device, browser = incoming.browser, ip = incoming.ip, at = now, id = incoming.id})
end
return 1
`;

const noteServiceScript = `${lua}
local id, key, clientId, kind = ARGV[6], ARGV[7], ARGV[8], ARGV[9]
if redis.call('EXISTS', p .. 'revoked:' .. id) == 1 or not owned(key) then return 0 end
local record = load(p .. 'session:' .. id)
if not record or not record.sid then return 0 end
if redis.call('EXISTS', p .. 'revoked:' .. record.groupId) == 1 then return 0 end
if record.parentKey and not owned(record.parentKey) then return 0 end
if kind == 'refresh' then return 1 end
local expiresAt = tonumber(ARGV[10])
record.services = record.services or {}
local grant = record.services[clientId] or {}
if kind == 'introspection' then
  if grant.confirmedAt and now - grant.confirmedAt < tonumber(ARGV[11]) and expiresAt <= grant.confirmedExpiresAt then return 1 end
  grant.confirmedAt = now
  grant.confirmedExpiresAt = math.max(expiresAt, grant.confirmedExpiresAt or 0)
elseif kind == 'exchange' then
  grant.exchangedAt = now
end
record.services[clientId] = grant
if not save(record) then return 0 end
if kind == 'exchange' then
  addEvent({type = 'service', clientId = clientId, device = record.device, ip = record.ip, at = now, id = ARGV[12]})
end
return 1
`;

const endSessionsScript = `${lua}
local currentId, selectedId, reason, mode = ARGV[6], ARGV[7], ARGV[8], ARGV[9]
local keep = load(p .. 'session:' .. currentId)
local selected = load(p .. 'session:' .. selectedId)
local removed = {}

local function revoke(record)
  if not owned(record.key) then return end
  local value = load(record.key)
  local ttl = math.max(redis.call('PTTL', record.key), tonumber(value.cookie and value.cookie.originalMaxAge) or 0, 600000) + 600000
  redis.call('SET', p .. 'revoked:' .. record.id, '1', 'PX', ttl)
  redis.call('DEL', record.key, p .. 'session:' .. record.id)
  redis.call('ZREM', index, record.id)
  if type(value.sso_clients) == 'table' and #value.sso_clients > 0 then
    record.previousClients = value.sso_clients
  end
  table.insert(removed, record)
  addEvent({type = reason, device = record.device, browser = record.browser, ip = record.ip, at = now, id = record.id})
end

if mode == 'logout' then
  if not selected then
    selected = { id = selectedId, key = ARGV[10], kind = ARGV[11], groupId = selectedId }
  end
  revoke(selected)
  if selected.kind == 'telegram' and #removed > 0 then
    local ids = redis.call('ZRANGEBYSCORE', index, now, '+inf')
    for _, id in ipairs(ids) do
      local record = load(p .. 'session:' .. id)
      if record and record.groupId == selectedId then revoke(record) end
    end
  end
elseif keep and owned(keep.key) and not (selected and selected.groupId == keep.groupId) then
  local ids = redis.call('ZRANGEBYSCORE', index, now, '+inf')
  for _, id in ipairs(ids) do
    local record = load(p .. 'session:' .. id)
    if record and record.groupId ~= keep.groupId and (mode == 'others' or (selected and selected.groupId == record.groupId)) then
      revoke(record)
    end
  end
end
return cjson.encode(removed)
`;

export function createAccountSecurity(redis) {
  const run = (script, uid, ...args) => redis.eval(script, {
    keys: [],
    arguments: [prefix, Date.now(), uid, historySeconds, historySize, ...args].map(String),
  });

  function noteSession(kind, sid, uid, req, method, parentSid) {
    const id = accountSessionId(kind, sid);
    const now = Date.now();
    return run(noteSessionScript, uid, JSON.stringify({
      id, kind, sid, key: sessionKey(kind, sid),
      groupId: parentSid ? accountSessionId('telegram', parentSid) : id,
      parentKey: parentSid ? sessionKey('telegram', parentSid) : undefined,
      ...requestDevice(req, kind),
      method,
      createdAt: method ? now : undefined,
      lastSeenAt: req ? now : undefined,
    }), touchInterval);
  }

  async function end(kind, sid, uid, reason) {
    const id = accountSessionId(kind, sid);
    const removed = JSON.parse(await run(endSessionsScript, uid, '', id, reason, 'logout', sessionKey(kind, sid), kind));
    return removed[0] ? { ...removed[0], related: removed.slice(1) } : null;
  }

  async function listSessions(uid) {
    const index = indexKey(uid);
    const now = Date.now();
    const ids = await redis.zRangeByScore(index, now, '+inf');
    if (!ids.length) return [];
    const metadata = (await redis.mGet(ids.map(metadataKey))).map(readMetadata).filter(Boolean);
    if (!metadata.length) return [];
    const keys = [...new Set(metadata.flatMap(record => [record.key, record.parentKey].filter(Boolean)))];
    const sessions = new Map((await redis.mGet(keys)).map((raw, i) => [keys[i], readMetadata(raw)]));
    return metadata.flatMap(record => {
      const session = sessions.get(record.key);
      if (String(session?.uid || '') !== String(uid)) return [];
      if (record.parentKey && String(sessions.get(record.parentKey)?.uid || '') !== String(uid)) return [];
      const expiresAt = Date.parse(session.cookie?.expires);
      if (Number.isFinite(expiresAt) && expiresAt <= now) return [];
      return [{ ...record, expiresAt }];
    });
  }

  async function activity(uid, page, pageSize) {
    const key = historyKey(uid);
    await redis.zRemRangeByScore(key, '-inf', Date.now() - historySeconds * 1000);
    const start = (page - 1) * pageSize;
    const rows = await redis.sendCommand(['ZREVRANGE', key, String(start), String(start + pageSize)]);
    return { events: rows.slice(0, pageSize).map(readMetadata), more: rows.length > pageSize };
  }

  async function backfill() {
    for (const [kind, storePrefix] of Object.entries(accountSessionPrefixes)) {
      let keys = [];
      const indexBatch = async () => {
        if (!keys.length) return;
        const values = await redis.mGet(keys);
        await Promise.all(values.map((raw, i) => {
          const value = readMetadata(raw);
          const uid = value?.uid;
          if (!Number.isSafeInteger(Number(uid)) || Number(uid) <= 0) return;
          return noteSession(kind, keys[i].slice(storePrefix.length), uid, undefined, undefined, value.securityParentSid);
        }));
        keys = [];
      };
      // Existing sessions have no reliable creation date or device information.
      for await (const key of redis.scanIterator({ MATCH: `${storePrefix}*`, COUNT: 150 })) {
        keys.push(key);
        if (keys.length === 100) await indexBatch();
      }
      await indexBatch();
    }
  }

  return {
    noteLogin: noteSession,
    observe: noteSession,
    endSession: end,
    isRevoked: (kind, sid) => redis.exists(revokedKey(accountSessionId(kind, sid))),
    async noteService({ sid, uid, clientId, expiresAt, kind }) {
      return Boolean(await run(noteServiceScript, uid, accountSessionId('portal', sid), sessionKey('portal', sid),
        clientId, kind, (expiresAt || 0) * 1000, touchInterval, crypto.randomUUID()));
    },
    async endDevices(uid, currentId, selectedId) {
      const reason = selectedId ? 'remote_logout' : 'remote_logout_others';
      const removed = JSON.parse(await run(endSessionsScript, uid, currentId, selectedId || '', reason, selectedId ? 'device' : 'others'));
      return Array.isArray(removed) ? removed : [];
    },
    async claimTelegramProof(proof, maxAgeSeconds) {
      return await redis.set(`${prefix}telegram-proof:${digest(proof)}`, '1', { NX: true, EX: maxAgeSeconds + 30 }) === 'OK';
    },
    listSessions,
    activity,
    backfill,
  };
}
