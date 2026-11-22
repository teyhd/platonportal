import { createHmac, timingSafeEqual } from 'node:crypto';
import express from 'express';
import { makeFamilyLinks, positiveUserId, previewServices, selectedFamilyChild } from './familyAccess.mjs';

const protectedRoles = new Set([5, 7]);
const noStore = res => res.set('Cache-Control', 'private, no-store');
const temporaryFailure = res => res.status(503).json({ message: 'Не удалось загрузить данные. Попробуйте ещё раз.' });

function listServices(rights) {
  const services = new Map();
  for (const right of rights) {
    const integration = previewServices.find(service => service.ids.includes(Number(right.srv_id)));
    const key = String(right.srv_id);
    if (!services.has(key)) services.set(key, {
      id: key, label: integration?.label ?? right.service, roles: [], integration: Boolean(integration), family: false,
    });
    if (integration?.path && Number(right.role_id) === 6) services.get(key).family = true;
    services.get(key).roles.push(right.role);
  }
  return [...services.values()];
}

export function createFamilyRoutes({ db, important, sessionSecret, audit }) {
  const formToken = req => createHmac('sha256', sessionSecret).update(`family:${req.sessionID}`).digest('base64url');
  const tokenMatches = (req, token) => typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token) &&
    timingSafeEqual(Buffer.from(token), Buffer.from(formToken(req)));

  async function homeContext(req, res) {
    const parentId = positiveUserId(req.session?.uid);
    if (!parentId) return null;
    const family = await db.getFamily(parentId);
    if (!family) return null;

    noStore(res);
    const preference = req.session.familyChild?.parentId === parentId ? req.session.familyChild.childId : null;
    const selected = selectedFamilyChild(family.children, preference);
    const services = makeFamilyLinks(selected?.id, family.rights);
    return {
      children: family.children,
      selected,
      multiple: family.children.length > 1,
      services,
      csrf: formToken(req),
    };
  }

  const router = express.Router();
  router.post('/family/child', express.urlencoded({ extended: false, limit: '1kb' }), async (req, res) => {
    noStore(res);
    const parentId = positiveUserId(req.session?.uid);
    if (!parentId) return res.redirect(303, '/auth');
    if (!tokenMatches(req, req.body?.csrf)) return res.sendStatus(403);
    const childId = positiveUserId(req.body?.childId);
    if (!childId) return res.sendStatus(400);
    try {
      const family = await db.getFamily(parentId);
      if (!family?.children.some(child => child.id === childId)) {
        req.session.familySelectionNotice = true;
        return res.redirect(303, '/#family');
      }
      req.session.familyChild = { parentId, childId };
      return res.redirect(303, '/#family');
    } catch {
      return res.status(503).render('accerr', { title: 'Мои дети', errorTitle: 'Не удалось переключить ребёнка', retryHref: '/#family' });
    }
  });

  async function requireAdmin(req, res, next) {
    noStore(res);
    const actorId = positiveUserId(req.session?.uid);
    const targetId = positiveUserId(req.params.id);
    if (!actorId) return res.sendStatus(401);
    if (!targetId) return res.sendStatus(400);
    try {
      if (!await db.isAdmin(actorId)) return res.status(403).json({ message: 'Действие доступно администратору портала.' });
      res.locals.familyActorId = actorId;
      res.locals.familyTargetId = targetId;
      return next();
    } catch {
      return temporaryFailure(res);
    }
  }

  router.get('/api/users/:id/family', requireAdmin, async (req, res) => {
    try {
      const family = await db.getFamily(res.locals.familyTargetId, { includeInactive: true });
      if (!family) return res.status(409).json({ message: 'У пользователя должна быть активная родительская роль.' });
      return res.json({ children: family.children });
    } catch {
      return temporaryFailure(res);
    }
  });

  router.post('/api/users/:id/family', requireAdmin, async (req, res) => {
    if (!req.is('application/json') || !tokenMatches(req, req.get('X-Portal-CSRF'))) return res.sendStatus(403);
    const targetId = res.locals.familyTargetId;
    const childId = positiveUserId(req.body?.childId);
    const action = req.body?.action;
    if (!childId || childId === targetId || !['add', 'remove'].includes(action)) return res.sendStatus(400);
    try {
      if (!await db.updateChild(targetId, childId, action)) {
        return res.status(409).json({ message: 'Проверьте роль родителя и статус ученика.' });
      }
      audit(`family ${action} actor=${res.locals.familyActorId} parent=${targetId} child=${childId}`);
      return res.json({ ok: true });
    } catch {
      return temporaryFailure(res);
    }
  });

  router.post('/api/users/:id/service-preview', requireAdmin, async (req, res) => {
    if (!req.is('application/json') || !tokenMatches(req, req.get('X-Portal-CSRF'))) return res.sendStatus(403);
    const { familyActorId: actorId, familyTargetId: targetId } = res.locals;
    const { serviceId, childId: rawChildId } = req.body ?? {};
    const childId = rawChildId == null ? null : positiveUserId(rawChildId);
    if (rawChildId != null && !childId) return res.sendStatus(400);
    try {
      const [target, family] = await Promise.all([db.getAccount(targetId), db.getFamily(targetId, { includeInactive: true })]);
      if (!target) return res.sendStatus(404);
      const services = target.active ? listServices(target.rights) : [];
      const children = target.active ? (family?.children ?? []).filter(child => child.active) : [];
      if (childId && !children.some(child => child.id === childId)) return res.sendStatus(403);
      audit(`service-preview actor=${actorId} subject=${targetId} service=${positiveUserId(serviceId) ?? 'list'} child=${childId ?? 'none'}`);
      if (serviceId == null) return res.json({ active: target.active, services, children });

      const service = services.find(item => item.id === String(positiveUserId(serviceId)));
      if (!service) return res.sendStatus(404);
      const integration = previewServices.find(item => item.ids.includes(Number(service.id)));
      if (!integration) return res.json({ state: 'permissions_only' });
      const actor = await db.getAccount(actorId);
      const actorCanRead = actor?.active && actor.rights.some(right =>
        Number(right.srv_id) === Number(service.id) && Number(right.role_id) === 5 && right.roleConfigured !== 0
      );
      const targetHasPrivilegedAccess = protectedRoles.has(Number(target.type)) || target.rights.some(right =>
        (Number(right.srv_id) === 1 || Number(right.srv_id) === Number(service.id)) && protectedRoles.has(Number(right.role_id))
      );
      if (!actorCanRead || targetHasPrivilegedAccess) return res.json({ state: 'permissions_only' });
      const hasParentRole = target.rights.some(right => Number(right.srv_id) === Number(service.id) && Number(right.role_id) === 6);
      const selected = hasParentRole ? selectedFamilyChild(children, childId) : null;
      if (integration.path && hasParentRole && !selected) return res.json({ state: 'no_child' });
      const snapshot = await important.previewSource(targetId, integration.key, selected?.id ?? null);
      return res.json(snapshot);
    } catch {
      return temporaryFailure(res);
    }
  });

  return { formToken, homeContext, router };
}
