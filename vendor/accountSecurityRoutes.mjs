import crypto from 'node:crypto';
import express from 'express';
import { accountSessionId, activityDays } from './accountSecurity.mjs';

const serviceLabels = {
  bookpc: 'Аренда ПК',
  rasp: 'Расписание',
  buy: 'Покупки',
  report: 'Прогресс',
  diary: 'Электронный дневник',
  atten: 'Посещаемость',
  vote: 'Голосование',
  chess: 'Шахматы',
  zayavki: 'Техподдержка',
  calendar: 'Календарь',
};

const eventTitles = {
  pin: 'Вход по PIN',
  telegram: 'Вход через Telegram',
  'telegram-browser': 'Переход из Telegram в браузер',
  service: 'Вход в сервис',
  logout: 'Выход из аккаунта',
  telegram_logout: 'Выход из Telegram',
  telegram_link_changed: 'Сессия Telegram завершена',
  account_switch: 'Смена аккаунта',
  remote_logout: 'Сессия завершена удалённо',
  remote_logout_others: 'Сессия завершена через «Выйти на других устройствах»',
};

const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Moscow',
});

function formatDate(timestamp) {
  return Number.isFinite(timestamp) && timestamp > 0 ? dateFormatter.format(timestamp) : '';
}

function nameOfService(id, clients) {
  return serviceLabels[id] || serviceLabels[clients[id]?.srv_name] || clients[id]?.srv_name || 'Сервис';
}

function deviceView(records, currentId, clients) {
  const current = records.find(record => record.id === currentId);
  const representative = current || records.find(record => record.kind === 'telegram') || records[0];
  const services = new Map();
  const observedSignIns = new Set();
  const now = Date.now();
  for (const record of records) {
    for (const [id, grant] of Object.entries(record.services || {})) {
      if (grant.exchangedAt || grant.lastSeenAt) observedSignIns.add(id);
      if (!clients[id]?.revocable_sessions || !grant.confirmedAt || grant.confirmedExpiresAt <= now) continue;
      if (!services.has(id) || services.get(id).confirmedAt < grant.confirmedAt) {
        services.set(id, {
          ...grant,
          expiresAt: Math.min(grant.confirmedExpiresAt, record.expiresAt || Infinity),
        });
      }
    }
  }

  return {
    id: representative.id,
    current: Boolean(current),
    device: representative.device || 'Устройство не определено',
    deviceType: representative.deviceType,
    browser: representative.browser || (representative.kind === 'telegram' ? 'Telegram Mini App' : ''),
    ip: representative.ip,
    related: records.length > 1 ? 'Telegram и связанный браузер' : '',
    createdAt: formatDate(representative.createdAt),
    lastSeenAt: formatDate(Math.max(...records.map(record => record.lastSeenAt || 0))),
    expiresAt: formatDate(representative.expiresAt),
    services: [...services].map(([id, grant]) => ({
      id,
      name: nameOfService(id, clients),
      lastSeenAt: formatDate(grant.confirmedAt),
      expiresAt: formatDate(grant.expiresAt),
      status: 'Подтверждена',
    })),
    unconfirmedServices: [...observedSignIns].filter(id => !services.has(id)).map(id => nameOfService(id, clients)).join(', '),
  };
}

function groupDevices(records, currentId, clients) {
  records.sort((a, b) => (b.lastSeenAt || 0) - (a.lastSeenAt || 0));
  const groups = new Map();
  for (const record of records) {
    if (!groups.has(record.groupId)) groups.set(record.groupId, []);
    groups.get(record.groupId).push(record);
  }
  return [...groups.values()].map(group => deviceView(group, currentId, clients))
    .sort((a, b) => Number(b.current) - Number(a.current));
}

export function trackAccountSession(security, selectKind) {
  return async (req, res, next) => {
    const uid = Number(req.session?.uid);
    if (!Number.isSafeInteger(uid) || uid <= 0) return next();
    try {
      const kind = selectKind(req);
      const active = await security.observe(kind, req.sessionID, uid, req, undefined, req.session.securityParentSid);
      if (Number(active) === 1) return next();
      await new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
      if (kind === 'telegram') res.clearCookie('tma.sid', { path: '/tg', sameSite: 'none', secure: true });
      else res.clearCookie('sso.sid', { path: '/' });
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

export function makeAccountSecurityRouter({ security, clients, secret, lifecycle, logger = () => {} }) {
  const router = express.Router();
  const pageSize = 12;
  const services = Object.entries(clients).map(([id, client]) => ({
    name: nameOfService(id, clients),
    mode: client.revocable_sessions ? 'Онлайн-отзыв' : 'Только история входов',
  }));
  const currentId = req => accountSessionId('portal', req.sessionID);
  const csrf = req => crypto.createHmac('sha256', secret).update(`account-security:${req.sessionID}`).digest('hex');

  router.use((req, res, next) => {
    res.set({
      'Cache-Control': 'no-store, private',
      'Content-Security-Policy': "frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer',
    });
    if (Number.isSafeInteger(Number(req.session?.uid)) && Number(req.session.uid) > 0) return next();
    if (req.method === 'GET') req.session.return_to = '/security';
    return res.redirect(303, '/auth');
  });
  router.use(express.urlencoded({ extended: false, limit: '2kb', parameterLimit: 4 }));

  async function render(req, res, flash = {}) {
    const page = Math.min(25, Math.max(1, Number.parseInt(req.query.activityPage, 10) || 1));
    const uid = req.session.uid;
    const [records, history] = await Promise.all([
      security.listSessions(uid),
      security.activity(uid, page, pageSize),
    ]);
    const sessions = groupDevices(records, currentId(req), clients);
    const activity = history.events.map(event => ({
      title: eventTitles[event.type] || 'Изменение сессии',
      detail: [event.clientId && nameOfService(event.clientId, clients), event.device, event.browser, event.ip].filter(Boolean).join(' · '),
      at: formatDate(event.at),
      dateTime: new Date(event.at).toISOString(),
    }));
    return res.render('security', {
      title: 'Безопасность',
      auth: req.session.rolen,
      isSignedIn: true,
      securityActive: true,
      csrfToken: csrf(req),
      sessions,
      hasOtherSessions: sessions.some(session => !session.current),
      activity,
      activityDays,
      activityPage: page,
      activityPrevious: page > 1 ? page - 1 : null,
      activityNext: history.more && page < 25 ? page + 1 : null,
      trackedServices: services,
      ...flash,
    });
  }

  const asyncRoute = handler => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);
  router.get('/', asyncRoute(async (req, res) => {
    const flash = req.session.securityFlash;
    delete req.session.securityFlash;
    await render(req, res, flash);
  }));

  const revoke = asyncRoute(async (req, res) => {
    const token = req.body?._csrf;
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token) ||
        !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(csrf(req)))) {
      return render(req, res.status(403), { error: 'Обновите страницу и повторите действие.' });
    }

    const selected = req.params.id;
    if (selected && !/^[a-f0-9]{64}$/.test(selected)) return res.sendStatus(404);
    const removed = await security.endDevices(req.session.uid, currentId(req), selected);
    const notice = removed.length
      ? (selected ? 'Сессии на выбранном устройстве завершены.' : 'Сессии на других устройствах завершены.')
      : 'Активных сессий для завершения нет.';
    const results = await Promise.all(removed.filter(record => record.kind === 'portal').map(record => lifecycle.revokeSnapshot({
      sid: record.sid,
      sub: req.session.uid,
      clients: [...new Set([...Object.keys(record.services || {}), ...(record.previousClients || [])])],
    }, 'remote_logout')));
    req.session.securityFlash = { notice };
    if (results.some(result => result?.tokenRevocationFailed || result?.failedClients?.length)) {
      req.session.securityFlash.error = 'Некоторые сервисы ещё не подтвердили выход. Доступ будет проверен при следующем обращении.';
    }
    return res.redirect(303, '/security');
  });

  router.post('/sessions/revoke-others', revoke);
  router.post('/sessions/:id/revoke', revoke);
  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    logger(`account_security_failed code=${error?.code || error?.name || 'unknown'}`);
    return res.status(error?.status === 413 ? 413 : 503).render('security', {
      title: 'Безопасность', isSignedIn: true, securityActive: true,
      trackedServices: services,
      unavailable: true,
      error: 'Не удалось обновить данные безопасности. Попробуйте ещё раз.',
    });
  });
  return router;
}
