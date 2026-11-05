import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { PORTAL_DOMAINS, getRegisteredService, normalizePortalUrl } from '../vendor/nginxServices.mjs';
import { migrateDomainCatalog, CARD_VISIBILITY_SQL, cardVisibilityParams } from '../vendor/domainCatalog.mjs';

const expected = 'platoniks magic rec new rasp rep git diary llm plug game next2 next cloud cloudk own pc alisa vpn vote photo tildapi puzzle port aplug pve vision buy stud know chess event graph info main msg russ smart tech tg vlad vs welcome'.split(' ').map(name => name === 'platoniks' ? 'platoniks.ru' : `${name}.platoniks.ru`);

test('registry covers exactly the 43 ANET hosts with safe targets and local icons', async () => {
  assert.deepEqual(PORTAL_DOMAINS.map(service => service.domain), expected);
  assert.equal(new Set(expected).size, 43);
  for (const service of PORTAL_DOMAINS) {
    const url = new URL(service.cont);
    assert.equal(url.protocol, 'https:');
    assert.equal(url.hostname, service.domain);
    assert.equal(url.search + url.username + url.password + url.port, '');
    assert.ok(service.title.length <= 50 && service.pic.length <= 50 && service.summary);
    const svg = await readFile(new URL(`../public/img/${service.pic}`, import.meta.url), 'utf8');
    assert.match(svg, /viewBox="0 0 96 96"/);
    assert.match(svg, /stroke-width="1.8"/);
  }
  assert.equal(PORTAL_DOMAINS.find(s => s.domain === 'main.platoniks.ru').cont, 'https://main.platoniks.ru/private');
  assert.equal(PORTAL_DOMAINS.find(s => s.domain === 'vlad.platoniks.ru').cont, 'https://vlad.platoniks.ru/codex/v1/');
  assert.equal(PORTAL_DOMAINS[0].cont, 'https://platoniks.ru/russian-hotline');
});

test('coverage recognizes existing SSO aliases but never arbitrary portal pages or info text', () => {
  assert.equal(getRegisteredService('https://platoniks.ru/cloud/').domain, 'cloud.platoniks.ru');
  assert.equal(getRegisteredService('/diary').domain, 'diary.platoniks.ru');
  assert.equal(getRegisteredService('https://platoniks.ru/manual'), null);
  assert.equal(getRegisteredService('#room'), null);
  assert.equal(getRegisteredService('https://platoniks.ru/'), null);
  assert.equal(getRegisteredService('https://platoniks.ru/russian-hotline/admin').domain, 'platoniks.ru');
  assert.deepEqual(normalizePortalUrl('HTTP://WWW.VS.PLATONIKS.RU./'), { domain: 'vs.platoniks.ru', pathname: '/' });
  assert.equal(normalizePortalUrl('https://user:password@vs.platoniks.ru/'), null);
  assert.equal(normalizePortalUrl('https://vs.platoniks.ru:8080/'), null);
});

function fixture(initial = [], { failInsert = false, lock = 1 } = {}) {
  let cards = structuredClone(initial);
  let snapshot;
  let rolledBack = false;
  let released = false;
  let writes = 0;
  const connection = {
    async query(sql, values = []) {
      if (sql.startsWith('SELECT GET_LOCK')) return [[{ acquired: lock }]];
      if (sql.startsWith('SELECT RELEASE_LOCK')) return [[{ released: 1 }]];
      if (sql.startsWith('SELECT *')) return [structuredClone(cards)];
      writes++;
      if (sql.startsWith('INSERT')) {
        if (failInsert) throw new Error('insert failed');
        const id = Math.max(0, ...cards.map(card => card.id)) + 1;
        const [type, title, cont, pic, role, shows, crdorder] = values;
        cards.push({ id, type, title, cont, pic, role, shows, crdorder });
        return [{ insertId: id }];
      }
      if (sql.startsWith('UPDATE cards SET cont')) {
        cards.find(card => card.id === values[1]).cont = values[0];
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('UPDATE cards SET type')) {
        const [type, title, cont, pic, role, shows, crdorder, id] = values;
        Object.assign(cards.find(card => card.id === id), { type, title, cont, pic, role, shows, crdorder });
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    async beginTransaction() { snapshot = structuredClone(cards); },
    async commit() {},
    async rollback() { cards = snapshot; rolledBack = true; },
    release() { released = true; },
  };
  return { pool: { async getConnection() { return connection; } }, get cards() { return cards; }, get writes() { return writes; }, get rolledBack() { return rolledBack; }, get released() { return released; } };
}

test('migration preserves active cards, reuses hidden domains, repairs HTTPS, and repeats without writes', async () => {
  const initial = [
    { id: 1, type: 0, cont: '/cloud', pic: 'cloud.png', title: 'Облако', role: 1, shows: 1 },
    { id: 2, type: 0, cont: 'http://vpn.platoniks.ru/', role: 5, shows: 0 },
    { id: 3, type: 0, cont: 'http://diary.platoniks.ru/', role: 5, shows: 1 },
    { id: 4, type: 0, cont: 'https://main.platoniks.ru/', role: 5, shows: 1 },
  ];
  const f = fixture(initial);
  const first = await migrateDomainCatalog(f.pool);
  assert.equal(first.created.length, 39);
  assert.deepEqual(first.activated, ['vpn.platoniks.ru']);
  assert.deepEqual(first.repaired, ['diary.platoniks.ru', 'main.platoniks.ru']);
  assert.deepEqual(f.cards[0], initial[0]);
  assert.equal(f.cards[1].id, 2);
  assert.equal(f.cards[1].role, 7);
  assert.equal(f.cards[2].cont, 'https://diary.platoniks.ru/');
  assert.equal(f.cards[2].role, 5);
  assert.equal(f.cards[3].cont, 'https://main.platoniks.ru/private');
  const writes = f.writes;
  const second = await migrateDomainCatalog(f.pool);
  assert.equal(second.created.length + second.activated.length + second.repaired.length, 0);
  assert.equal(f.writes, writes);
  assert.equal(f.cards.length, 43);
});

test('migration rolls back failures and refuses inaccessible existing cards', async () => {
  const failed = fixture([], { failInsert: true });
  await assert.rejects(migrateDomainCatalog(failed.pool), /insert failed/);
  assert.equal(failed.cards.length, 0);
  assert.ok(failed.rolledBack && failed.released);
  const blocked = fixture([], { lock: 0 });
  await assert.rejects(migrateDomainCatalog(blocked.pool), /lock unavailable/);
  assert.equal(blocked.writes, 0);
  assert.ok(blocked.released);
  const conflict = fixture([{ id: 1, type: 0, cont: 'https://magic.platoniks.ru/', role: 6, shows: 1 }]);
  await assert.rejects(migrateDomainCatalog(conflict.pool), /not visible to management/);
  assert.equal(conflict.cards.length, 1);
  assert.ok(conflict.rolledBack && conflict.released);
});

test('new-card audience is categorical: only admin and moderator, including numeric-string sessions', () => {
  assert.match(CARD_VISIBILITY_SQL, /role <> 7 AND role <= \?/);
  assert.match(CARD_VISIBILITY_SQL, /role = 7 AND \? = 1/);
  for (const role of [5, 7, '5', '7']) assert.equal(cardVisibilityParams(role)[1], 1);
  for (const role of [6, 1, 2, 3, 4, 0, -1, 8, NaN, undefined]) assert.equal(cardVisibilityParams(role)[1], 0);
});
