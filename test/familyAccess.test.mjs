import { createHmac } from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { contextualizeFamilyCard, makeFamilyLinks, positiveUserId, selectedFamilyChild } from '../vendor/familyAccess.mjs';
import { createImportantService } from '../vendor/important.mjs';
import { createFamilyRoutes } from '../vendor/familyRoutes.mjs';
import { createNativeServicePreview } from '../vendor/nativeServicePreview.mjs';

const children = [{ id: 101, name: 'Первый ребёнок', active: true }, { id: 102, name: 'Второй ребёнок', active: true }];
const parentGrants = [8, 11, 15, 3].map(srv_id => ({ srv_id, role_id: 6, service: 'test', role: 'Родитель', roleConfigured: 1 }));

test('child preference and service links are scoped to membership and service roles', () => {
  assert.equal(positiveUserId(['1']), null);
  assert.equal(positiveUserId('1e2'), null);
  assert.equal(selectedFamilyChild(children, 777).id, 101);
  assert.equal(selectedFamilyChild(children, '102').id, 102);
  const links = makeFamilyLinks(102, [...parentGrants, { srv_id: 13, role_id: 6 }]);
  assert.deepEqual(links.map(link => new URL(link.href).searchParams.get(link.parameter)), ['102', '102', '102', '102']);
  assert.equal(makeFamilyLinks(102, [{ srv_id: 3, role_id: 2 }]).length, 0);
  const mapped = contextualizeFamilyCard({ cont: 'https://rasp.platoniks.ru/' }, links);
  assert.equal(mapped.cont, 'https://rasp.platoniks.ru/schedule/personal?child_id=102');
  const unrelated = { cont: 'https://unrelated.platoniks.ru/' };
  assert.equal(contextualizeFamilyCard(unrelated, links), unrelated);
  const staff = { cont: 'https://rasp.platoniks.ru/admin/schedule' };
  assert.equal(contextualizeFamilyCard(staff, links), staff);
});

test('family selection, protected editing and scoped preview keep the real portal identity', async t => {
  const accounts = new Map([
    [900, { id: 900, type: 5, active: true, rights: [8, 11, 15, 3].map(srv_id => ({ srv_id, role_id: 5 })) }],
    [901, { id: 901, type: 7, active: true, rights: [{ srv_id: 8, role_id: 5 }] }],
    [600, { id: 600, name: 'Тестовый родитель <имя>', type: 6, active: true, rights: parentGrants }],
    [601, { id: 601, type: 6, active: true, rights: parentGrants }],
    [500, { id: 500, type: 2, active: true, rights: [{ srv_id: 8, role_id: 5, service: 'rasp', role: 'Админ' }] }],
  ]);
  const sessions = new Map();
  const reads = [];
  const writes = [];
  const searches = [];
  const replacements = [];
  const revision = 'r'.repeat(43);
  const snapshots = [];
  const launches = [];
  const db = {
    getFamily: async id => id === 600 ? { children, rights: parentGrants, revision } : null,
    isAdmin: async id => id === 900,
    getAccount: async id => accounts.get(id),
    updateChild: async (...args) => (writes.push(args), true),
    findCandidates: async (parentId, q) => {
      searches.push([parentId, q]);
      return parentId === 600 ? [{ id: 110, name: 'Тестовый Ученик', className: '7А' }] : null;
    },
    replaceChildren: async (parentId, ids, original) => {
      replacements.push([parentId, ids, original]);
      if (parentId !== 600) return null;
      if (original !== revision) return { code: 'family_conflict' };
      if (ids.includes(999)) return { code: 'invalid_child' };
      return { children: [children[0]], revision: 's'.repeat(43), added: [], removed: [102] };
    },
  };
  const routes = createFamilyRoutes({
    db, sessionSecret: 'synthetic',
    important: { previewSource: async (...args) => (snapshots.push(args), { state: 'ready', entries: [] }) },
    audit: entry => reads.push(entry),
    nativePreview: createNativeServicePreview({
      env: {
        MAINPORTAL_SCHEDULE_TOKEN: 'fixture-service-key',
        MAINPORTAL_DIARY_KEY: 'fixture-service-key',
        MAINPORTAL_CALENDAR_KEY: 'fixture-service-key',
        MAINPORTAL_PROGRESS_KEY: 'fixture-service-key',
        ATTENDANCE_MAINPORTAL_SERVICE_KEY: 'fixture-service-key',
      },
      fetchImpl: async (url, request) => {
        assert.equal(url.pathname, '/internal/integrations/mainportal/v1/role-preview');
        assert.equal(request.method, 'POST');
        assert.equal(request.headers.Authorization, 'Bearer fixture-service-key');
        launches.push(JSON.parse(request.body));
        return Response.json({ code: 'a'.repeat(64) });
      },
    }),
  });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const uid = Number(req.get('x-test-user'));
    if (!sessions.has(uid)) sessions.set(uid, { uid });
    req.session = sessions.get(uid);
    req.sessionID = String(uid);
    next();
  });
  app.use(routes.router);
  app.get('/', async (req, res) => res.json(await routes.homeContext(req, res)));
  const server = await new Promise(resolve => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  t.after(() => server.close());
  const call = (uid, path, opts = {}) => fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    ...opts,
    redirect: 'manual',
    headers: { 'x-test-user': String(uid), ...opts.headers },
  });
  const post = (uid, path, body, csrf = routes.formToken({ sessionID: String(uid) })) => call(uid, path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Portal-CSRF': csrf }, body: JSON.stringify(body),
  });
  const choose = (childId, csrf) => call(600, '/family/child', {
    method: 'POST', body: new URLSearchParams({ childId, csrf }),
  });

  const home = await call(600, '/');
  assert.equal(home.headers.get('cache-control'), 'private, no-store');
  const { csrf, selected } = await home.json();
  assert.equal(selected.id, 101);
  assert.equal((await choose(102, 'incorrect')).status, 403);
  assert.equal((await choose(102, csrf)).status, 303);
  assert.equal((await choose(999, csrf)).status, 303);
  assert.equal((await (await call(600, '/')).json()).selected.id, 102);

  const preview = '/api/users/600/service-preview';
  assert.equal((await post(901, preview, {})).status, 403);
  assert.equal((await post(0, preview, {})).status, 401);
  assert.equal((await post(900, preview, {}, 'invalid')).status, 403);
  const serviceList = await (await post(900, preview, {})).json();
  assert.equal(serviceList.services.find(service => service.id === '8').previewAvailable, true);
  assert.equal(serviceList.services.find(service => service.id === '8').nativePreviewAvailable, true);
  assert.equal(serviceList.services.find(service => service.id === '11').nativePreviewAvailable, true);
  assert.equal(serviceList.services.find(service => service.id === '3').previewAvailable, true);
  assert.deepEqual(serviceList.children.map(child => child.id), [101, 102]);
  assert.equal((await post(900, preview, { serviceId: 8, childId: 404 })).status, 403);
  assert.equal((await post(900, preview, { serviceId: 13 })).status, 404);
  assert.equal((await (await post(900, preview, { serviceId: 3 })).json()).state, 'ready');
  assert.equal((await (await post(900, '/api/users/500/service-preview', { serviceId: 8 })).json()).state, 'permissions_only');
  assert.equal((await post(900, preview, { serviceId: 8, childId: 102 })).status, 200);
  assert.deepEqual(snapshots, [[600, 'progress', 101], [600, 'schedule', 102]]);
  assert.equal((await (await post(900, '/api/users/601/service-preview', { serviceId: 8 })).json()).state, 'no_child');
  const openTab = (uid, body, csrf = routes.formToken({ sessionID: String(uid) }), target = 600) => call(
    uid, `/users/${target}/service-preview`, {
      method: 'POST', body: new URLSearchParams({ csrf, ...body }),
    }
  );
  assert.equal((await openTab(0, { serviceId: 8 })).status, 401);
  assert.equal((await openTab(901, { serviceId: 8 })).status, 403);
  assert.equal((await openTab(900, { serviceId: 8 }, 'bad-token')).status, 403);
  assert.equal((await openTab(900, { serviceId: 8, childId: 999 })).status, 403);
  assert.equal((await openTab(900, { serviceId: 13 })).status, 404);
  assert.equal((await openTab(900, {})).status, 400);
  const page = await openTab(900, { serviceId: 8, childId: 102 });
  assert.equal(page.status, 303);
  assert.equal(page.headers.get('cache-control'), 'private, no-store');
  assert.equal(page.headers.get('set-cookie'), null);
  const location = new URL(page.headers.get('location'));
  assert.equal(location.origin, 'https://rasp.platoniks.ru');
  assert.equal(location.pathname, '/audit/schedule/personal');
  assert.equal(location.searchParams.get('child_id'), '102');
  assert.equal(location.hash, '#code=' + 'a'.repeat(64));
  assert.deepEqual(launches, [{ actor_id: 900, subject_id: 600 }]);
  const diary = await openTab(900, { serviceId: 11, childId: 102 });
  assert.equal(diary.status, 303);
  const diaryURL = new URL(diary.headers.get('location'));
  assert.equal(diaryURL.origin, 'https://diary.platoniks.ru');
  assert.equal(diaryURL.pathname, '/audit/children/overview');
  assert.equal(diaryURL.searchParams.get('viewer'), 'parent');
  assert.equal(diaryURL.searchParams.get('studentId'), '102');
  for (const [serviceId, origin] of [[15, 'https://event.platoniks.ru'], [3, 'https://rep.platoniks.ru']]) {
    const tab = await openTab(900, { serviceId, childId: 102 });
    assert.equal(tab.status, 303);
    assert.equal(new URL(tab.headers.get('location')).origin, origin);
    assert.deepEqual(launches.at(-1), { actor_id: 900, subject_id: 600, child_id: 102 });
  }
  assert.equal((await openTab(900, { serviceId: 8 }, undefined, 500)).status, 403);
  assert.deepEqual(snapshots, [[600, 'progress', 101], [600, 'schedule', 102]]);
  assert.deepEqual(sessions.get(900), { uid: 900 });
  assert(reads.some(entry => /actor=900 subject=600 service=8 child=102/.test(entry)));
  assert.equal((await post(901, '/api/users/600/family', { childId: 102, action: 'remove' })).status, 403);
  assert.equal((await post(900, '/api/users/600/family', { childId: 600, action: 'add' })).status, 400);
  assert.equal((await post(900, '/api/users/600/family', { childId: 102, action: 'remove' })).status, 200);
  assert.deepEqual(writes, [[600, 102, 'remove']]);

  const family = '/api/users/600/family';
  const candidates = family + '/candidates';
  const put = (uid, body, csrf = routes.formToken({ sessionID: String(uid) })) => call(uid, family, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Portal-CSRF': csrf }, body: JSON.stringify(body),
  });
  assert.equal((await call(901, family)).status, 403);
  assert.deepEqual(await (await call(900, family)).json(), { children, revision });
  assert.equal((await post(0, candidates, { q: 'Уче' })).status, 401);
  assert.equal((await post(901, candidates, { q: 'Уче' })).status, 403);
  assert.equal((await post(900, candidates, { q: 'Уче' }, 'invalid')).status, 403);
  assert.equal((await post(900, candidates, { q: ['Уче'] })).status, 400);
  const hits = await post(900, candidates, { q: 'Уче' });
  assert.equal(hits.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await hits.json(), { candidates: [{ id: 110, name: 'Тестовый Ученик', className: '7А' }] });
  assert.deepEqual(searches, [[600, 'Уче']]);
  assert.equal((await put(901, { childIds: [], revision })).status, 403);
  assert.equal((await put(900, { childIds: [], revision }, 'invalid')).status, 403);
  assert.equal((await put(900, { childIds: [] })).status, 400);
  for (const invalid of [[101, '101'], [[101]], [600], [0], ['1e2'], '101']) {
    assert.equal((await put(900, { childIds: invalid, revision })).status, 400);
  }
  const conflict = await put(900, { childIds: [101], revision: 'x'.repeat(43) });
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).code, 'family_conflict');
  const unavailable = await put(900, { childIds: [999], revision });
  assert.equal(unavailable.status, 422);
  assert.equal((await unavailable.json()).code, 'invalid_child');
  const saved = await put(900, { childIds: ['101'], revision });
  assert.deepEqual(await saved.json(), { children: [children[0]], revision: 's'.repeat(43) });
  assert.deepEqual(replacements, [[600, [101], 'x'.repeat(43)], [600, [999], revision], [600, [101], revision]]);
  assert(reads.some(entry => /family replace actor=900 parent=600 added= removed=102/.test(entry)));
});

test('Important rechecks revoked links and scopes an independent service without a Schedule parent grant', async () => {
  let linked = children;
  const calls = [];
  const date = '2026-11-22';
  const service = createImportantService({
    now: () => new Date(date + 'T12:00:00.000Z'),
    env: {
      IMPORTANT_ENABLED: '1', IMPORTANT_EXPANDED_ENABLED: '1',
      MAINPORTAL_SCHEDULE_TOKEN: 'fixture', MAINPORTAL_CALENDAR_KEY: 'fixture',
      MAINPORTAL_CALENDAR_URL: 'http://calendar.test',
    },
    getRights: async () => [{ srv_id: 15, role_id: 6 }],
    getFamilyScope: async () => ({ children: linked }),
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body ?? 'null');
      calls.push([url.hostname, url.searchParams.get('child_id'), body?.childId]);
      if (url.hostname === '127.0.0.1') return new Response(null, { status: 403 });
      return Response.json({ schema: 1, date, items: [{ key: 'event', title: 'Событие ребёнка', audience: 'child' }] });
    },
  });
  const session = { uid: 600, familyChild: { parentId: 600, childId: 102 } };
  const view = await service.summary(session, {});
  assert.equal(view.visible, true);
  assert.equal(view.selectedChildId, 102);
  assert(calls.some(([host, id]) => host === '127.0.0.1' && id === null));
  assert(calls.some(([host, , id]) => host === 'calendar.test' && id === 102));
  linked = [children[0]];
  await assert.rejects(service.summary(session, { childId: '102' }), { status: 403 });
  await assert.rejects(service.details(session, { childId: '102', key: 'event' }), { status: 403 });
});

test('native-only previews verify service credentials and live grants independently of the portal session', async t => {
  const serviceId = 2;
  const actor = { id: 1, type: 5, active: true, rights: [{ srv_id: serviceId, role_id: 5, roleConfigured: 1 }] };
  const target = { id: 2, name: 'Иванов Иван Иванович', type: 2, active: true, rights: [
    { srv_id: serviceId, role_id: 2, roleConfigured: 1, service: 'bookpc', role: 'Педагог' },
  ] };
  const db = {
    getAccount: async id => id === actor.id ? actor : id === target.id ? target : null,
    isAdmin: async id => id === actor.id && actor.active,
    getFamily: async () => null,
  };
  const clientSecret = 'fixture-service-credential';
  const credential = createHmac('sha256', clientSecret).update('mainportal:role-preview:v1:bookpc').digest('hex');
  const nativePreview = createNativeServicePreview({
    env: { BOOKPC_SSO_CLIENT_SECRET: clientSecret, BUY_SSO_CLIENT_SECRET: clientSecret },
    async fetchImpl(url, request) {
      assert.equal(url.origin, 'http://127.0.0.1:81');
      assert.equal(request.headers.Authorization, 'Bearer ' + credential);
      assert.deepEqual(JSON.parse(request.body), { actor_id: 1, subject_id: 2 });
      return Response.json({ code: 'b'.repeat(64) });
    },
  });
  const routes = createFamilyRoutes({
    db, sessionSecret: 'fixture-session', nativePreview,
    important: { previewSource: () => assert.fail('BookPC has no summary') },
    audit: () => {},
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { uid: Number(req.get('x-test-user')) };
    req.sessionID = 'browser';
    next();
  });
  app.use(routes.router);
  const server = await new Promise(resolve => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  t.after(() => server.close());
  const request = (path, options) => fetch('http://127.0.0.1:' + server.address().port + path, {
    method: 'POST', redirect: 'manual', ...options,
  });
  const csrf = routes.formToken({ sessionID: 'browser' });
  const list = await request('/api/users/2/service-preview', {
    headers: { 'Content-Type': 'application/json', 'X-Portal-CSRF': csrf, 'x-test-user': '1' },
    body: '{}',
  });
  const [listing] = (await list.json()).services;
  assert.equal(listing.previewAvailable, false);
  assert.equal(listing.nativePreviewAvailable, true);
  const open = await request('/users/2/service-preview', {
    headers: { 'x-test-user': '1' },
    body: new URLSearchParams({ serviceId: '2', csrf }),
  });
  assert.equal(open.status, 303);
  assert.equal(open.headers.get('location'), 'https://pc.platoniks.ru/audit/#code=' + 'b'.repeat(64));
  assert.equal(open.headers.get('set-cookie'), null);

  const directory = (service, token = credential) => request('/internal/integrations/mainportal/v1/role-preview/authorize', {
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ service, actor_id: 1, subject_id: 2 }),
  });
  assert.equal((await directory('bookpc', clientSecret)).status, 401);
  assert.equal((await directory('buy')).status, 401);
  assert.deepEqual(await (await directory('bookpc')).json(), {
    id: 2, name: target.name, type: 2, roles: [2],
  });
  actor.rights = [];
  assert.equal((await directory('bookpc')).status, 403);
  actor.rights = [{ srv_id: serviceId, role_id: 5, roleConfigured: 1 }];
  target.rights.push({ srv_id: 1, role_id: 7, roleConfigured: 1 });
  assert.equal((await directory('bookpc')).status, 403);
});
