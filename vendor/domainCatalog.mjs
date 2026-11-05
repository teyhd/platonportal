import { PORTAL_DOMAINS, findDomainCard, getRegisteredService } from './nginxServices.mjs';

// Role 7 is an explicit management-only audience, not a numerical access threshold.
export const DOMAIN_CARD_ROLE = 7;
export const CARD_VISIBILITY_SQL = `SELECT * FROM cards
  WHERE shows = 1 AND ((role <> 7 AND role <= ?) OR (role = 7 AND ? = 1))
  ORDER BY crdorder, id`;

export function cardVisibilityParams(role) {
  const numeric = Number(role);
  const safeRole = Number.isFinite(numeric) ? numeric : 0;
  return [safeRole, [5, 7].includes(safeRole) ? 1 : 0];
}

export async function migrateDomainCatalog(pool) {
  const conn = await pool.getConnection();
  let locked = false;
  let inTransaction = false;
  try {
    const [[lock]] = await conn.query('SELECT GET_LOCK(?, 10) AS acquired', ['mainportal:domain-catalog']);
    if (Number(lock?.acquired) !== 1) throw new Error('Domain catalog lock unavailable');
    locked = true;
    await conn.beginTransaction();
    inTransaction = true;
    const [cards] = await conn.query('SELECT * FROM cards ORDER BY id FOR UPDATE');
    const created = [];
    const activated = [];
    const repaired = [];
    const existing = [];
    for (const service of PORTAL_DOMAINS) {
      const visible = findDomainCard(service, cards.filter(card => Number(card.shows) === 1));
      if (visible) {
        if (Number(visible.role) > 5 && Number(visible.role) !== DOMAIN_CARD_ROLE) {
          throw new Error(`Domain card is not visible to management: ${service.domain}`);
        }
        for (const match of cards.filter(card => Number(card.type) === 0 && Number(card.shows) === 1 && getRegisteredService(card.cont)?.domain === service.domain)) {
          const url = new URL(match.cont, 'https://platoniks.ru/');
          const specialPath = ['main.platoniks.ru', 'vlad.platoniks.ru'].includes(service.domain);
          if (url.protocol === 'http:' || (specialPath && url.pathname.replace(/\/+$/, '') !== new URL(service.cont).pathname.replace(/\/+$/, ''))) {
            const cont = specialPath ? service.cont : match.cont.replace(/^http:/i, 'https:');
            await conn.query('UPDATE cards SET cont = ? WHERE id = ?', [cont, match.id]);
            match.cont = cont;
            if (!repaired.includes(service.domain)) repaired.push(service.domain);
          }
        }
        existing.push(service.domain);
        continue;
      }
      const hidden = findDomainCard(service, cards);
      const values = [0, service.title, service.cont, service.pic, DOMAIN_CARD_ROLE, 1, 100];
      if (hidden) {
        await conn.query('UPDATE cards SET type = ?, title = ?, cont = ?, pic = ?, role = ?, shows = ?, crdorder = ? WHERE id = ?', [...values, hidden.id]);
        Object.assign(hidden, { title: service.title, cont: service.cont, pic: service.pic, role: DOMAIN_CARD_ROLE, shows: 1, crdorder: 100 });
        activated.push(service.domain);
      } else {
        const [result] = await conn.query('INSERT INTO cards (type, title, cont, pic, role, shows, crdorder) VALUES (?, ?, ?, ?, ?, ?, ?)', values);
        cards.push({ id: result.insertId, type: 0, title: service.title, cont: service.cont, pic: service.pic, role: DOMAIN_CARD_ROLE, shows: 1, crdorder: 100 });
        created.push(service.domain);
      }
    }
    const [verified] = await conn.query('SELECT * FROM cards ORDER BY id FOR UPDATE');
    if (PORTAL_DOMAINS.some(service => !findDomainCard(service, verified.filter(card => Number(card.shows) === 1 && (Number(card.role) <= 5 || Number(card.role) === DOMAIN_CARD_ROLE))))) {
      throw new Error('Domain catalog coverage verification failed');
    }
    await conn.commit();
    inTransaction = false;
    return { created, activated, repaired, existing };
  } catch (error) {
    if (inTransaction) await conn.rollback();
    throw error;
  } finally {
    try { if (locked) await conn.query('SELECT RELEASE_LOCK(?)', ['mainportal:domain-catalog']); }
    finally { conn.release(); }
  }
}
