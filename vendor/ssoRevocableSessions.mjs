import crypto from 'crypto';
import jwt from 'jsonwebtoken';

const defaultRefreshTTLSeconds = 8 * 60 * 60;
const backchannelEvent = 'http://schemas.openid.net/event/backchannel-logout';

const consumeRefreshToken = `
local raw = redis.call('GET', KEYS[1])
if not raw then return nil end
local ok, record = pcall(cjson.decode, raw)
if not ok or type(record) ~= 'table' then return nil end
if ARGV[1] ~= '' and record.client_id ~= ARGV[1] then return nil end
local expiresAt = tonumber(record.exp)
if not expiresAt or expiresAt <= tonumber(ARGV[2]) then return nil end
redis.call('DEL', KEYS[1])
return raw
`;

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function tokenDigest(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function redisKey(prefix, kind, value) {
  return `${prefix}${kind}:${tokenDigest(value)}`;
}

export class RedisRevocableTokenStore {
  constructor(redis, options = {}) {
    if (!redis) throw new Error('Redis client is required for revocable SSO tokens');
    this.redis = redis;
    this.prefix = options.prefix || 'sso:oauth:';
    this.ttlSeconds = positiveInt(options.ttlSeconds, defaultRefreshTTLSeconds);
  }

  async issue(record) {
    const token = crypto.randomBytes(32).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + this.ttlSeconds;
    const stored = {
      client_id: String(record.client_id || ''),
      sub: String(record.sub || ''),
      name: String(record.name || ''),
      sid: String(record.sid || ''),
      srv_name: String(record.srv_name || ''),
      audience: String(record.audience || ''),
      exp: expiresAt,
    };
    if (!stored.client_id || !stored.sub || !stored.sid) {
      throw new Error('Revocable token record is incomplete');
    }

    const tokenKey = redisKey(this.prefix, 'refresh', token);
    const sidKey = redisKey(this.prefix, 'sid', stored.sid);
    await this.redis
      .multi()
      .set(tokenKey, JSON.stringify(stored), { EX: this.ttlSeconds })
      .sAdd(sidKey, tokenKey)
      .expire(sidKey, this.ttlSeconds)
      .exec();
    return { token, expiresAt, record: stored };
  }

  async inspect(token) {
    const raw = await this.redis.get(redisKey(this.prefix, 'refresh', token));
    if (!raw) return null;
    try {
      const record = JSON.parse(raw);
      if (!record?.exp || Number(record.exp) <= Math.floor(Date.now() / 1000)) return null;
      return record;
    } catch {
      return null;
    }
  }

  async consume(token, expectedClientId = '') {
    const tokenKey = redisKey(this.prefix, 'refresh', token);
    const raw = await this.redis.eval(consumeRefreshToken, {
      keys: [tokenKey],
      arguments: [expectedClientId, String(Math.floor(Date.now() / 1000))],
    });
    if (!raw) return null;

    const record = JSON.parse(raw);
    await this.redis.sRem(redisKey(this.prefix, 'sid', record.sid), tokenKey);
    return record;
  }

  async revokeSession(sid) {
    const cleanSid = String(sid || '').trim();
    if (!cleanSid) return 0;
    const sidKey = redisKey(this.prefix, 'sid', cleanSid);
    const tokenKeys = await this.redis.sMembers(sidKey);
    if (tokenKeys.length > 0) await this.redis.del(tokenKeys);
    await this.redis.del(sidKey);
    return tokenKeys.length;
  }
}

function sessionStoreGet(store, sid) {
  return new Promise((resolve, reject) => {
    if (!store || !sid) return resolve(null);
    store.get(sid, (error, sessionValue) => {
      if (error) reject(error);
      else resolve(sessionValue || null);
    });
  });
}

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate(error => (error ? reject(error) : resolve()));
  });
}

function saveSession(req) {
  return new Promise((resolve, reject) => {
    req.session.save(error => (error ? reject(error) : resolve()));
  });
}

function destroySession(req) {
  return new Promise((resolve, reject) => {
    if (!req.session) return resolve();
    req.session.destroy(error => (error ? reject(error) : resolve()));
  });
}

function sessionSnapshot(req) {
  return {
    sid: String(req?.sessionID || ''),
    sub: String(req?.session?.uid || ''),
    clients: Array.isArray(req?.session?.sso_clients)
      ? [...new Set(req.session.sso_clients.map(String).filter(Boolean))]
      : [],
  };
}

export function createSsoSessionLifecycle(options = {}) {
  const clients = options.clients || {};
  const issuer = String(options.issuer || '');
  const tokenStore = options.tokenStore || null;
  const sessionStore = options.sessionStore || null;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const logger = options.logger || (() => {});
  const backchannelTimeoutMs = positiveInt(options.backchannelTimeoutMs, 1500);

  const accountSecurity = options.accountSecurity;
  const sessionKind = options.sessionKind || 'portal';

  async function notifyBackchannel(snapshot, reason) {
    if (!snapshot.sid || !snapshot.sub) return [];
    const failures = await Promise.all((snapshot.clients || []).map(async clientId => {
      const client = clients[clientId];
      if (!client?.backchannel_logout_uri) return null;

      const secret = client.backchannel_secret || client.client_secret;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), backchannelTimeoutMs);
      let status = 'failed';
      try {
        if (!secret || typeof fetchImpl !== 'function') {
          status = 'not_configured';
        } else {
          const now = Math.floor(Date.now() / 1000);
          const logoutToken = jwt.sign({
            iss: issuer,
            aud: clientId,
            iat: now,
            exp: now + 60,
            jti: crypto.randomUUID(),
            sid: snapshot.sid,
            sub: snapshot.sub,
            reason,
            events: { [backchannelEvent]: {} },
          }, secret, { algorithm: 'HS256' });

          const response = await fetchImpl(client.backchannel_logout_uri, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ logout_token: logoutToken }),
            signal: controller.signal,
            redirect: 'error',
          });
          void response.body?.cancel().catch(() => {});
          status = response.ok ? 'ok' : `http_${Number(response.status)}`;
        }
      } catch {
        if (controller.signal.aborted) status = 'timeout';
      } finally {
        clearTimeout(timer);
      }
      logger(`sso_backchannel_logout client=${clientId} reason=${reason} status=${status}`);
      return status === 'ok' ? null : clientId;
    }));
    return failures.filter(Boolean);
  }

  async function revokeSnapshot(snapshot, reason = 'logout') {
    let tokenRevocationFailed = false;
    if (!snapshot?.sid) return { tokenRevocationFailed, failedClients: [] };
    try {
      await tokenStore?.revokeSession(snapshot.sid);
    } catch {
      tokenRevocationFailed = true;
      logger(`sso_token_revoke sid_hash=${tokenDigest(snapshot.sid).slice(0, 12)} status=failed`);
    }
    const failedClients = await notifyBackchannel(snapshot, reason);
    return { tokenRevocationFailed, failedClients };
  }

  function snapshotClients(record, existing = []) {
    return [...new Set([...existing, ...Object.keys(record?.services || {}), ...(record?.previousClients || [])])];
  }

  async function endSession(snapshot, reason) {
    const record = snapshot.sub
      ? await accountSecurity?.endSession(sessionKind, snapshot.sid, snapshot.sub, reason)
      : null;
    return {
      snapshot: { ...snapshot, clients: snapshotClients(record, snapshot.clients) },
      related: (record?.related || []).filter(item => item.kind === 'portal' && item.sid).map(item => ({
        sid: item.sid, sub: snapshot.sub, clients: snapshotClients(item),
      })),
    };
  }

  async function revokeEndedSession(ended, reason) {
    const revokeRelated = options.revokeRelated || revokeSnapshot;
    const results = await Promise.all([
      revokeSnapshot(ended.snapshot, reason),
      ...ended.related.map(snapshot => revokeRelated(snapshot, reason)),
    ]);
    return {
      tokenRevocationFailed: results.some(result => result?.tokenRevocationFailed),
      failedClients: [...new Set(results.flatMap(result => result?.failedClients || []))],
    };
  }

  async function establish(req, user) {
    const previous = sessionSnapshot(req);
    const returnTo = req.session?.return_to || '';
    const ended = await endSession(previous, 'account_switch');
    await regenerateSession(req);
    if (previous.sub) await revokeEndedSession(ended, 'account_switch');
    req.session.uid = user.id;
    req.session.name = user.name;
    req.session.role = user.role;
    req.session.right = user.right;
    req.session.logins = user.logins;
    req.session.sso_clients = [];
    if (user.telegram) req.session.telegram = user.telegram;
    if (returnTo) req.session.return_to = returnTo;
    await saveSession(req);
    try {
      const method = sessionKind === 'telegram' ? 'telegram' : 'pin';
      const recorded = await accountSecurity?.noteLogin(sessionKind, req.sessionID, user.id, req, method);
      if (recorded === false || recorded === 0) throw new Error('Could not record the authenticated session');
    } catch (error) {
      try {
        await destroySession(req);
      } catch {
        logger('sso_session_login_rollback status=failed');
      }
      throw error;
    }
    return req.session;
  }

  async function logout(req, reason = 'logout') {
    const ended = await endSession(sessionSnapshot(req), reason);
    await destroySession(req);
    return revokeEndedSession(ended, reason);
  }

  async function isActive(sid, expectedSub) {
    if (!sid || !expectedSub) return false;
    const sessionValue = await sessionStoreGet(sessionStore, sid);
    const expiresAt = Date.parse(sessionValue?.cookie?.expires);
    return Boolean(sessionValue && String(sessionValue.uid || '') === String(expectedSub)
      && (!Number.isFinite(expiresAt) || expiresAt > Date.now())
      && !await accountSecurity?.isRevoked(sessionKind, sid));
  }

  return { establish, logout, isActive, revokeSnapshot };
}

