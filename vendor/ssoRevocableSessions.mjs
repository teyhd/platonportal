import crypto from 'crypto';
import jwt from 'jsonwebtoken';

const defaultRefreshTTLSeconds = 8 * 60 * 60;
const backchannelEvent = 'http://schemas.openid.net/event/backchannel-logout';

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

  async consume(token) {
    const tokenKey = redisKey(this.prefix, 'refresh', token);
    const raw = await this.redis.getDel(tokenKey);
    if (!raw) return null;
    try {
      const record = JSON.parse(raw);
      if (record?.sid) {
        await this.redis.sRem(redisKey(this.prefix, 'sid', record.sid), tokenKey);
      }
      if (!record?.exp || Number(record.exp) <= Math.floor(Date.now() / 1000)) return null;
      return record;
    } catch {
      return null;
    }
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
  return new Promise(resolve => {
    if (!req.session) return resolve();
    req.session.destroy(() => resolve());
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

  async function notifyBackchannel(snapshot, reason) {
    if (!snapshot.sid || !snapshot.sub || snapshot.clients.length === 0 || typeof fetchImpl !== 'function') return;
    await Promise.allSettled(snapshot.clients.map(async clientId => {
      const client = clients[clientId];
      if (!client?.backchannel_logout_uri) return;
      const secret = client.backchannel_secret || client.client_secret;
      if (!secret) return;
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

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), backchannelTimeoutMs);
      try {
        const response = await fetchImpl(client.backchannel_logout_uri, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ logout_token: logoutToken }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`status=${response.status}`);
        logger(`sso_backchannel_logout client=${clientId} reason=${reason} status=ok`);
      } catch (error) {
        logger(`sso_backchannel_logout client=${clientId} reason=${reason} status=failed error=${error?.message || error}`);
      } finally {
        clearTimeout(timer);
      }
    }));
  }

  async function revokeSnapshot(snapshot, reason = 'logout') {
    if (!snapshot?.sid) return;
    try {
      await tokenStore?.revokeSession(snapshot.sid);
    } catch (error) {
      logger(`sso_token_revoke sid_hash=${tokenDigest(snapshot.sid).slice(0, 12)} status=failed error=${error?.message || error}`);
    }
    await notifyBackchannel(snapshot, reason);
  }

  async function establish(req, user) {
    const previous = sessionSnapshot(req);
    const returnTo = req.session?.return_to || '';
    if (previous.sub) await revokeSnapshot(previous, 'account_switch');
    await regenerateSession(req);
    req.session.uid = user.id;
    req.session.name = user.name;
    req.session.role = user.role;
    req.session.right = user.right;
    req.session.logins = user.logins;
    req.session.sso_clients = [];
    if (returnTo) req.session.return_to = returnTo;
    await saveSession(req);
    return req.session;
  }

  async function logout(req, reason = 'logout') {
    await revokeSnapshot(sessionSnapshot(req), reason);
    await destroySession(req);
  }

  async function isActive(sid, expectedSub) {
    const sessionValue = await sessionStoreGet(sessionStore, sid);
    return Boolean(sessionValue && String(sessionValue.uid || '') === String(expectedSub || ''));
  }

  return { establish, logout, isActive, revokeSnapshot };
}

