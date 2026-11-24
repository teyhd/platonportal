import { createHmac, timingSafeEqual } from 'node:crypto';
import express from 'express';
import { createNativeServicePreview } from './nativeServicePreview.mjs';
import { makeFamilyLinks, nativeProfileServices, positiveUserId, previewServices, selectedFamilyChild } from './familyAccess.mjs';

const protectedRoles = new Set([5, 7]);
const nativeServices = [...previewServices, ...nativeProfileServices];
const forService = (right, serviceId) => Number(right.srv_id) === serviceId;
const isServiceAdmin = (account, serviceId) => Boolean(account?.active && account.rights.some(right =>
  forService(right, serviceId) && Number(right.role_id) === 5 && right.roleConfigured !== 0
));
const canPreviewTarget = (account, serviceId) => Boolean(account?.active && Number(account.type) !== -1 &&
  !protectedRoles.has(Number(account.type)) && !account.rights.some(right =>
    (forService(right, 1) || forService(right, serviceId)) && protectedRoles.has(Number(right.role_id))
  )
);
const targetServiceRoles = (account, serviceId) => [...new Set(account.rights
  .filter(right => forService(right, serviceId) && Number(right.roleConfigured) === 1)
  .map(right => Number(right.role_id))
  .filter(Number.isInteger))];
const noStore = res => res.set('Cache-Control', 'private, no-store');
const temporaryFailure = res => res.status(503).json({ message: 'Не удалось загрузить данные. Попробуйте ещё раз.' });

function listServices(rights) {
  const services = new Map();
  for (const right of rights) {
    const integration = previewServices.find(service => service.ids.includes(Number(right.srv_id)));
    const key = String(right.srv_id);
    if (!services.has(key)) services.set(key, {
      id: key, label: nativeServices.find(service => service.ids.includes(Number(right.srv_id)))?.label ?? right.service,
      roles: [], integration: Boolean(integration), family: false,
    });
    if (integration?.path && Number(right.role_id) === 6) services.get(key).family = true;
    services.get(key).roles.push(right.role);
  }
  return [...services.values()];
}

export function createFamilyRoutes({ db, important, sessionSecret, audit, nativePreview = createNativeServicePreview() }) {
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
  router.post('/internal/integrations/mainportal/v1/role-preview/authorize', express.json({ limit: '1kb' }), async (req, res) => {
    noStore(res);
    const { service, actor_id, subject_id } = req.body ?? {};
    const serviceId = nativePreview.directoryService(service, req.get('Authorization') || '');
    if (!serviceId) return res.sendStatus(401);
    const actorId = positiveUserId(actor_id);
    const targetId = positiveUserId(subject_id);
    if (!actorId || !targetId) return res.sendStatus(403);
    try {
      const [portalAdmin, actor, target] = await Promise.all([
        db.isAdmin(actorId), db.getAccount(actorId), db.getAccount(targetId),
      ]);
      if (!portalAdmin || !isServiceAdmin(actor, serviceId) || !canPreviewTarget(target, serviceId)) return res.sendStatus(403);
      const roles = targetServiceRoles(target, serviceId);
      if (!roles.length) return res.sendStatus(403);
      const grants = serviceId === 1 ? target.rights.map(right => ({
        srv_id: Number(right.srv_id), role_id: Number(right.role_id),
      })) : undefined;
      return res.json({ id: target.id, name: target.name, type: Number(target.type), roles, grants });
    } catch {
      return temporaryFailure(res);
    }
  });
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

  function requireAdminToken(req, res, next) {
    if (!req.is('application/json') || !tokenMatches(req, req.get('X-Portal-CSRF'))) return res.sendStatus(403);
    return next();
  }

  const ineligibleParent = res => res.status(409).json({
    code: 'ineligible_parent', message: 'У пользователя должна быть активная родительская роль.',
  });

  router.get('/api/users/:id/family', requireAdmin, async (req, res) => {
    try {
      const family = await db.getFamily(res.locals.familyTargetId, { includeInactive: true });
      if (!family) return ineligibleParent(res);
      return res.json({ children: family.children, revision: family.revision });
    } catch {
      return temporaryFailure(res);
    }
  });

  router.post('/api/users/:id/family/candidates', requireAdmin, requireAdminToken, async (req, res) => {
    const query = req.body?.q;
    if (typeof query !== 'string' || query.length > 160) return res.sendStatus(400);
    try {
      const candidates = await db.findCandidates(res.locals.familyTargetId, query);
      if (!candidates) return ineligibleParent(res);
      return res.json({ candidates });
    } catch {
      return temporaryFailure(res);
    }
  });

  router.put('/api/users/:id/family', requireAdmin, requireAdminToken, async (req, res) => {
    const { childIds, revision } = req.body ?? {};
    const { familyActorId: actorId, familyTargetId: parentId } = res.locals;
    if (!Array.isArray(childIds) || typeof revision !== 'string' || !/^[a-zA-Z0-9_-]{43}$/.test(revision)) return res.sendStatus(400);
    const ids = childIds.map(positiveUserId);
    if (ids.includes(null) || ids.includes(parentId) || new Set(ids).size !== ids.length) return res.sendStatus(400);
    try {
      const result = await db.replaceChildren(parentId, ids, revision);
      if (!result) return ineligibleParent(res);
      if (result.code === 'family_conflict') return res.status(409).json({
        code: result.code, message: 'Состав семьи уже изменился. Загрузите актуальный список.',
      });
      if (result.code === 'invalid_child') return res.status(422).json({
        code: result.code, message: 'Один из добавляемых учеников больше недоступен. Проверьте список.',
      });
      if (result.added.length || result.removed.length) {
        audit(`family replace actor=${actorId} parent=${parentId} added=${result.added.join(',')} removed=${result.removed.join(',')}`);
      }
      return res.json({ children: result.children, revision: result.revision });
    } catch {
      return res.status(503).json({ message: 'Не удалось подтвердить сохранение. Попробуйте ещё раз.' });
    }
  });

  router.post('/api/users/:id/family', requireAdmin, requireAdminToken, async (req, res) => {
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

  async function servicePreview(req, res, page = false) {
    const { familyActorId: actorId, familyTargetId: targetId } = res.locals;
    const { serviceId, childId: submittedChildId } = req.body ?? {};
    const rawChildId = page && submittedChildId === '' ? null : submittedChildId;
    const childId = rawChildId == null ? null : positiveUserId(rawChildId);
    if (page && !positiveUserId(serviceId)) return res.sendStatus(400);
    if (rawChildId != null && !childId) return res.sendStatus(400);
    try {
      const [target, family, actor] = await Promise.all([
        db.getAccount(targetId), db.getFamily(targetId, { includeInactive: true }), db.getAccount(actorId),
      ]);
      if (!target) return res.sendStatus(404);
      const services = target.active ? listServices(target.rights) : [];
      const children = target.active ? (family?.children ?? []).filter(child => child.active) : [];
      if (childId && !children.some(child => child.id === childId)) return res.sendStatus(403);
      audit(`service-preview actor=${actorId} subject=${targetId} service=${positiveUserId(serviceId) ?? 'list'} child=${childId ?? 'none'}`);
      for (const service of services) {
        const id = Number(service.id);
        const allowed = isServiceAdmin(actor, id) && canPreviewTarget(target, id);
        const integration = nativeServices.find(item => item.ids.includes(id));
        service.previewAvailable = service.integration && allowed;
        service.nativePreviewAvailable = Boolean(allowed && nativePreview.supports(integration?.key) &&
          targetServiceRoles(target, id).length);
      }
      if (serviceId == null) return res.json({ active: target.active, services, children });

      const service = services.find(item => item.id === String(positiveUserId(serviceId)));
      if (!service) return res.sendStatus(404);
      const integration = nativeServices.find(item => item.ids.includes(Number(service.id)));
      const selected = service.family ? selectedFamilyChild(children, childId) : null;
      if (!page) {
        if (!service.previewAvailable) return res.json({ state: 'permissions_only' });
        if (service.family && !selected) return res.json({ state: 'no_child' });
        return res.json(await important.previewSource(targetId, integration.key, selected?.id ?? null));
      }
      if (!service.nativePreviewAvailable) {
        return res.status(403).send('Для выбранного сервиса или роли недоступен просмотр интерфейса.');
      }
      const destination = await nativePreview.launch(integration.key, { actorId, targetId, childId: selected?.id ?? null });
      if (!destination) return res.status(403).send('Просмотр интерфейса недоступен для этой роли.');
      return res.redirect(303, destination);
    } catch {
      if (page) return res.status(503).send('Не удалось открыть просмотр сервиса. Попробуйте ещё раз из портала.');
      return temporaryFailure(res);
    }
  }

  router.post('/api/users/:id/service-preview', requireAdmin, requireAdminToken, (req, res) => servicePreview(req, res));
  router.post('/users/:id/service-preview', requireAdmin, express.urlencoded({ extended: false, limit: '1kb' }),
    (req, res) => {
      res.set({
        'Content-Security-Policy': "default-src 'none'; style-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        'Referrer-Policy': 'no-referrer',
        'X-Robots-Tag': 'noindex',
      });
      if (!req.is('application/x-www-form-urlencoded') || !tokenMatches(req, req.body?.csrf)) return res.sendStatus(403);
      return servicePreview(req, res, true);
    });

  return { formToken, homeContext, router };
}
