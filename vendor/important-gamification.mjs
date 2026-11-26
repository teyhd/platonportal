import { createHmac } from 'node:crypto';

export const importantGamificationPath = '/api/important/gamification';
const pointsBasePath = '/internal/integrations/mainportal/v1';
const positiveId = value => Number.isSafeInteger(value) && value > 0;
const error = (status, code) => Object.assign(new Error(code), { status, code });

function validateMark(value) {
  const { scopeId, studentId, criterionId, periodId, version, score } = value ?? {};
  if (![scopeId, studentId, criterionId, periodId].every(positiveId) ||
      !Number.isSafeInteger(version) || version < 0 || !Number.isInteger(score) || score < 1 || score > 5) {
    throw error(422, 'invalid_grade');
  }
  return { scopeId, mutations: [{ studentId, criterionId, periodIds: [periodId], version, value: score, source: 'manual' }] };
}

export function createImportantGamification({ getRoles, env = process.env, fetchImpl = fetch, now = Date.now } = {}) {
  const key = env.POINTS_MAINPORTAL_KEY;
  const enabled = typeof key === 'string' && key.length >= 32;
  const origin = env.POINTS_MAINPORTAL_ORIGIN || 'https://platoniks.ru';
  const source = env.POINTS_MAINPORTAL_URL || 'http://127.0.0.1:18148';
  const cache = new Map();

  async function actor(session) {
    const id = Number(session?.uid);
    if (!positiveId(id)) throw error(401, 'authentication_required');
    if (!enabled) throw error(404, 'grading_disabled');
    const roles = [...new Set((await getRoles(id)).map(Number).filter(positiveId))].sort((a, b) => a - b);
    if (!roles.length) {
      cache.delete(id);
      throw error(403, 'forbidden');
    }
    return { id, roles };
  }

  async function request(user, route, payload, idempotencyKey = '') {
    const path = pointsBasePath + route;
    const method = payload ? 'POST' : 'GET';
    const body = payload ? JSON.stringify(payload) : '';
    const timestamp = String(now());
    const actorHeader = Buffer.from(JSON.stringify(user)).toString('base64url');
    const signature = createHmac('sha256', key).update([method,path,timestamp,actorHeader,idempotencyKey,''].join('\n')).update(body).digest('hex');
    const headers = { Accept:'application/json', 'X-Portal-Timestamp':timestamp, 'X-Portal-Actor':actorHeader, 'X-Portal-Signature':signature };
    if (payload) Object.assign(headers, { 'Content-Type':'application/json', 'Idempotency-Key':idempotencyKey });

    let response, data;
    try {
      response = await fetchImpl(new URL(path, source), { method, headers, ...(payload ? { body } : {}),
        signal:AbortSignal.timeout(payload ? 8_000 : 3_500), redirect:'error' });
      data = await response.json();
    } catch {
      throw error(503, 'grading_unavailable');
    }
    if (!response.ok) {
      if ([403,409,422].includes(response.status)) throw error(response.status, data?.error?.code || 'grading_unavailable');
      throw error(503, 'grading_unavailable');
    }
    return data;
  }

  async function pending(session) {
    const user = await actor(session);
    const roles = user.roles.join(',');
    const previous = cache.get(user.id);
    if (previous?.roles === roles && previous.until > now()) return previous.promise;
    if (cache.size >= 150) cache.delete(cache.keys().next().value);
    const entry = { roles, until:now() + 5_000 };
    entry.promise = request(user, '/grading').then(data => {
      if (!Array.isArray(data?.tasks)) throw error(503, 'grading_unavailable');
      return { count:data.tasks.length, tasks:data.tasks };
    }).catch(failure => {
      if (cache.get(user.id) === entry) cache.delete(user.id);
      throw failure;
    });
    cache.set(user.id, entry);
    return entry.promise;
  }

  return {
    origin,
    pending,
    async count(session) {
      if (!enabled) return null;
      try {
        return (await pending(session)).count;
      } catch (failure) {
        return [401,403,404].includes(failure.status) ? null : undefined;
      }
    },
    async confirm(session, value, idempotencyKey) {
      const user = await actor(session);
      const payload = validateMark(value);
      if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(idempotencyKey ?? '')) throw error(400, 'invalid_operation');
      cache.delete(user.id);
      try {
        const result = await request(user, '/confirm', payload, idempotencyKey);
        const cell = result?.cells?.[0];
        const mark = payload.mutations[0];
        if (cell?.studentId !== mark.studentId || cell.criterionId !== mark.criterionId ||
            !Number.isSafeInteger(cell.version) || cell.version <= mark.version) throw error(503, 'grading_unavailable');
        return { version:cell.version };
      } finally {
        cache.delete(user.id);
      }
    },
  };
}

export function registerImportantGamification(app, service) {
  const handler = action => async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    res.set('Vary', 'Cookie');
    try {
      res.json(await action(req));
    } catch (failure) {
      const status = [400,401,403,404,409,422,503].includes(failure.status) ? failure.status : 503;
      res.status(status).json({ error:status === 503 ? 'grading_unavailable' : failure.code });
    }
  };
  app.get(importantGamificationPath, handler(req => {
    if (req.rolePreview) throw error(403, 'forbidden');
    return service.pending(req.session);
  }));
  app.post(importantGamificationPath, handler(req => {
    if (req.rolePreview || req.get('Origin') !== service.origin || !req.is('application/json')) throw error(403, 'forbidden');
    return service.confirm(req.session, req.body, req.get('Idempotency-Key'));
  }));
}
