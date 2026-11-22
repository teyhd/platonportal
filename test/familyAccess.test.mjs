import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { contextualizeFamilyCard, makeFamilyLinks, positiveUserId, selectedFamilyChild } from '../vendor/familyAccess.mjs';
import { createImportantService } from '../vendor/important.mjs';
import { createFamilyRoutes } from '../vendor/familyRoutes.mjs';

const children = [{ id: 101, name: 'Первый ребёнок', active: true }, { id: 102, name: 'Второй ребёнок', active: true }];
const parentGrants = [8, 11, 15, 3].map(srv_id => ({ srv_id, role_id: 6, service: 'test', role: 'Родитель' }));

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
    [900, { id: 900, type: 5, active: true, rights: [{ srv_id: 8, role_id: 5 }] }],
    [901, { id: 901, type: 7, active: true, rights: [{ srv_id: 8, role_id: 5 }] }],
    [600, { id: 600, type: 6, active: true, rights: parentGrants }],
    [601, { id: 601, type: 6, active: true, rights: parentGrants }],
    [500, { id: 500, type: 2, active: true, rights: [{ srv_id: 8, role_id: 5, service: 'rasp', role: 'Админ' }] }],
  ]);
  const sessions = new Map();
  const reads = [];
  const writes = [];
  const snapshots = [];
  const db = {
    getFamily: async id => id === 600 ? { children, rights: parentGrants } : null,
    isAdmin: async id => id === 900,
    getAccount: async id => accounts.get(id),
    updateChild: async (...args) => (writes.push(args), true),
  };
  const routes = createFamilyRoutes({
    db, sessionSecret: 'synthetic',
    important: { previewSource: async (...args) => (snapshots.push(args), { state: 'ready', entries: [] }) },
    audit: entry => reads.push(entry),
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
  assert.equal((await post(900, preview, { serviceId: 8, childId: 404 })).status, 403);
  assert.equal((await post(900, preview, { serviceId: 13 })).status, 404);
  assert.equal((await (await post(900, preview, { serviceId: 3 })).json()).state, 'permissions_only');
  assert.equal((await (await post(900, '/api/users/500/service-preview', { serviceId: 8 })).json()).state, 'permissions_only');
  assert.equal((await post(900, preview, { serviceId: 8, childId: 102 })).status, 200);
  assert.deepEqual(snapshots, [[600, 'schedule', 102]]);
  assert.equal((await (await post(900, '/api/users/601/service-preview', { serviceId: 8 })).json()).state, 'no_child');
  assert.deepEqual(sessions.get(900), { uid: 900 });
  assert(reads.some(entry => /actor=900 subject=600 service=8 child=102/.test(entry)));
  assert.equal((await post(901, '/api/users/600/family', { childId: 102, action: 'remove' })).status, 403);
  assert.equal((await post(900, '/api/users/600/family', { childId: 600, action: 'add' })).status, 400);
  assert.equal((await post(900, '/api/users/600/family', { childId: 102, action: 'remove' })).status, 200);
  assert.deepEqual(writes, [[600, 102, 'remove']]);
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
