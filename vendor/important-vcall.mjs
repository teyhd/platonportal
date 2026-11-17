import { createHash } from 'node:crypto';

export const lessonRoomPrefix = 'portal-lesson-';

function lessonRoomIdentity(lesson) {
  const teachers = [...new Set((lesson.teacherIds ?? []).map(Number).filter(id => Number.isSafeInteger(id) && id > 0))];
  if (teachers.length !== 1 || !lesson.key || !lesson.start || !lesson.end) return null;
  const owner = teachers[0];
  const occurrence = createHash('sha256').update(JSON.stringify([lesson.key, lesson.start, lesson.end, owner])).digest('hex');
  return { owner, occurrence, id: lessonRoomPrefix + occurrence };
}

function verifiedRoom(room, identity, vcall) {
  const access = vcall.readRoomAccess(room?.room_info);
  return access?.owner === identity.owner && access.occurrence === identity.occurrence && !access.pub && access.need_auth;
}

function limited(task, timeout = 2200) {
  let timer;
  const limit = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Room status timed out')), timeout);
    timer.unref?.();
  });
  return Promise.race([task, limit]).finally(() => clearTimeout(timer));
}

export function createImportantVcall(vcall) {
  const inFlight = new Map();
  function activeRoom(identity) {
    return limited(vcall.get_active_room(identity.id));
  }
  return {
    async status(lesson) {
      const identity = lessonRoomIdentity(lesson);
      if (!identity) return 'unavailable';
      const room = await activeRoom(identity);
      return !room ? 'closed' : verifiedRoom(room, identity, vcall) ? 'active' : 'unavailable';
    },
    async open(lesson, user) {
      const identity = lessonRoomIdentity(lesson);
      if (!identity || identity.owner !== user.uid) return false;
      if (inFlight.has(identity.id)) return inFlight.get(identity.id);
      const pending = (async () => {
        const existing = await activeRoom(identity);
        if (existing) return verifiedRoom(existing, identity, vcall);
        await limited(vcall.create_room(identity.id, user.name, {
          pub: false, need_auth: true, portal_owner: user.uid, portal_occurrence: identity.occurrence,
        }), 5000);
        return verifiedRoom(await activeRoom(identity), identity, vcall);
      })().finally(() => inFlight.delete(identity.id));
      inFlight.set(identity.id, pending);
      return pending;
    },
    async join(lesson, user, kind) {
      const identity = lessonRoomIdentity(lesson);
      if (!identity || (kind === 'host' && identity.owner !== user.uid)) return null;
      if (!verifiedRoom(await activeRoom(identity), identity, vcall)) return null;
      const { link } = await limited(vcall.get_link(identity.id, user.name, `id0000${user.uid}`,
        kind === 'host', { pub:false, need_auth:true }), 5000);
      return link;
    },
  };
}

const reject = (res, status, message) => res.status(status).send(message);

export function registerImportantVcallRoutes(app, { importantService, lessonRooms, getUser }) {
  const route = '/api/important/vcall';
  app.post(`${route}/start`, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const user = getUser(req.session);
    if (!user) return reject(res, 401, 'Войдите в портал');
    if (!req.is('application/json') || req.get('origin') !== `${req.protocol}://${req.get('host')}`) {
      return reject(res, 403, 'Откройте комнату из портала');
    }
    try {
      const { lesson, kind } = await importantService.vcallLesson(req.session, req.body?.lessonKey);
      if (kind !== 'host') return reject(res, 403, 'Комнату открывает педагог урока');
      if (!await lessonRooms.open(lesson, user)) return reject(res, 409, 'Не удалось подтвердить комнату урока');
      const query = new URLSearchParams({ lessonKey: lesson.key });
      return res.json({ href: `${route}/join?${query}` });
    } catch (error) {
      return reject(res, error.status ?? 502, 'V.CALL: не удалось открыть комнату урока');
    }
  });
  app.get(`${route}/join`, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const user = getUser(req.session);
    if (!user) return reject(res, 401, 'Войдите в портал');
    try {
      const { lesson, kind } = await importantService.vcallLesson(req.session, req.query.lessonKey);
      const href = await lessonRooms.join(lesson, user, kind);
      if (!href) return reject(res, 404, 'Комната этого урока пока закрыта');
      return res.redirect(href);
    } catch (error) {
      return reject(res, error.status ?? 502, 'V.CALL: не удалось подтвердить доступ к комнате урока');
    }
  });
}
