import crypto from 'crypto';
import express from 'express';

import { TelegramMiniAppValidationError } from './telegramMiniApp.mjs';

function noStore(res) {
  res.set('Cache-Control', 'no-store, private, max-age=0');
}

function csrfToken() {
  return crypto.randomBytes(24).toString('base64url');
}

function clearTelegramCookie(res, cookieName) {
  res.clearCookie(cookieName, { path: '/tg', sameSite: 'none', secure: true });
}

function sessionIdentity(req) {
  const telegram = req.session?.telegram;
  if (!telegram?.telegramUserId || !telegram?.botUserId || !req.session?.uid) return null;
  return telegram;
}

function publicUser(identity) {
  return {
    id: String(identity.portalUserId),
    name: identity.name,
    role: identity.role,
  };
}

function publicSession(req, identity) {
  return {
    ok: true,
    user: publicUser(identity),
    csrfToken: req.session.telegram.csrfToken,
    telegramUserId: String(req.session.telegram.telegramUserId),
    authDate: req.session.telegram.authDate,
  };
}

export function makeTelegramMiniAppRouter({
  enabled,
  botId,
  botDatabase,
  authMaxAgeSeconds,
  cookieName = 'tma.sid',
  verifyInitData,
  resolveIdentity,
  getUserRights,
  lifecycle,
  accountSecurity,
  getPortalData,
  launchService,
  logger = () => {},
} = {}) {
  const router = express.Router();

  router.use((req, res, next) => {
    noStore(res);
    next();
  });

  if (!enabled) {
    router.use((_req, res) => res.status(404).json({ ok: false, code: 'not_found' }));
    return router;
  }

  async function resolveActiveIdentity(req, res) {
    const session = sessionIdentity(req);
    if (!session) {
      res.status(401).json({ ok: false, code: 'unauthorized' });
      return null;
    }

    const identity = await resolveIdentity(session.telegramUserId, botDatabase);
    if (!identity || identity.status !== 'active' ||
        String(identity.portalUserId) !== String(req.session.uid) ||
        String(identity.botUserId) !== String(session.botUserId)) {
      await lifecycle.logout(req, 'telegram_link_changed');
      clearTelegramCookie(res, cookieName);
      res.status(401).json({ ok: false, code: 'link_unavailable' });
      return null;
    }

    if (lifecycle.isActive && !await lifecycle.isActive(req.sessionID, identity.portalUserId)) {
      clearTelegramCookie(res, cookieName);
      res.status(401).json({ ok: false, code: 'unauthorized' });
      return null;
    }

    return identity;
  }

  router.post('/api/auth', async (req, res, next) => {
    try {
      const validated = verifyInitData(req.body?.initData, { botId, maxAgeSeconds: authMaxAgeSeconds });
      const identity = await resolveIdentity(validated.telegramUserId, botDatabase);
      if (!identity || identity.status !== 'active') {
        return res.status(403).json({ ok: false, code: 'link_unavailable' });
      }

      const current = sessionIdentity(req);
      const sameSession = current?.telegramUserId === validated.telegramUserId &&
        current.botUserId === String(identity.botUserId) && String(req.session.uid) === String(identity.portalUserId) &&
        (!lifecycle.isActive || await lifecycle.isActive(req.sessionID, identity.portalUserId));
      if (sameSession && current.authDate === validated.authDate) return res.json(publicSession(req, identity));

      const right = sameSession ? null : await getUserRights(identity.portalUserId);
      if (accountSecurity) {
        // These fields are verified with Telegram's signature before the proof is claimed.
        const proof = [botId, validated.telegramUserId, validated.authDate].join(':');
        const remainingProofSeconds = Math.max(1, validated.authDate + authMaxAgeSeconds - Math.floor(Date.now() / 1000) + 1);
        if (!await accountSecurity.claimTelegramProof(proof, remainingProofSeconds)) {
          if (sameSession && (!lifecycle.isActive || await lifecycle.isActive(req.sessionID, identity.portalUserId))) {
            return res.json(publicSession(req, identity));
          }
          return res.status(401).json({ ok: false, code: 'telegram_proof_used' });
        }
      }

      if (sameSession) {
        if (lifecycle.isActive && !await lifecycle.isActive(req.sessionID, identity.portalUserId)) {
          return res.status(401).json({ ok: false, code: 'unauthorized' });
        }
        current.authDate = Math.max(current.authDate, validated.authDate);
        return res.json(publicSession(req, identity));
      }

      const telegram = {
        telegramUserId: validated.telegramUserId,
        botUserId: String(identity.botUserId),
        authDate: validated.authDate,
        csrfToken: csrfToken(),
      };
      await lifecycle.establish(req, {
        id: identity.portalUserId,
        name: identity.name,
        role: identity.role,
        right,
        logins: [],
        telegram,
      });
      req.session.telegram ??= telegram;

      return res.json(publicSession(req, identity));
    } catch (error) {
      if (error instanceof TelegramMiniAppValidationError) {
        return res.status(401).json({ ok: false, code: 'invalid_telegram_auth' });
      }
      logger(`telegram_mini_app_auth_failed code=${error?.code || error?.name || 'unknown'}`);
      return next(error);
    }
  });

  router.get('/api/session', async (req, res, next) => {
    try {
      const identity = await resolveActiveIdentity(req, res);
      if (!identity) return;
      return res.json(publicSession(req, identity));
    } catch (error) {
      return next(error);
    }
  });

  router.get('/api/portal', async (req, res, next) => {
    try {
      const identity = await resolveActiveIdentity(req, res);
      if (!identity) return;
      const portal = await getPortalData(identity);
      return res.json({ ok: true, user: publicUser(identity), portal });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/launch/:serviceId', async (req, res, next) => {
    try {
      const identity = await resolveActiveIdentity(req, res);
      if (!identity) return;
      if (typeof launchService !== 'function') {
        return res.status(404).json({ ok: false, code: 'service_unavailable' });
      }
      return await launchService(identity, req.params.serviceId, res, req);
    } catch (error) {
      return next(error);
    }
  });

  router.post('/api/logout', async (req, res, next) => {
    try {
      const session = sessionIdentity(req);
      const token = String(req.get('x-tma-csrf') || '');
      if (!session) return res.status(401).json({ ok: false, code: 'unauthorized' });
      if (!token || token !== session.csrfToken) return res.status(403).json({ ok: false, code: 'forbidden' });
      await lifecycle.logout(req, 'telegram_logout');
      clearTelegramCookie(res, cookieName);
      return res.json({ ok: true });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}
