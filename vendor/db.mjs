import mysql from 'mysql2'
let sets = {
    host: process.env.MDBHOST,
    user: process.env.DBUSER,
    password : process.env.DBPASS,
    database: process.env.DBNAMESUSR,
    charset : 'utf8mb4_general_ci',
    waitForConnections: true,
    connectionLimit: 100,
    maxIdle: 100, // max idle connections, the default value is the same as `connectionLimit`
    idleTimeout: 200, // idle connections timeout, in milliseconds, the default value 60000
    queueLimit: 0,
    enableKeepAlive: false,
    keepAliveInitialDelay: 0
}
let setss = {
    host: process.env.MDBHOST,
    user: process.env.DBUSER,
    password : process.env.DBPASS,
    database: process.env.DBNAMES,
    charset : 'utf8mb4_general_ci',
    waitForConnections: true,
    connectionLimit: 100,
    maxIdle: 100, // max idle connections, the default value is the same as `connectionLimit`
    idleTimeout: 200, // idle connections timeout, in milliseconds, the default value 60000
    queueLimit: 0,
    enableKeepAlive: false,
    keepAliveInitialDelay: 0
}
const usr = mysql.createPool(sets).promise()
const portal = mysql.createPool(setss).promise()

const CALENDAR_SSO_SERVICE_NAME = 'calendar';
const CALENDAR_SSO_ROLE_IDS = [1, 2, 3, 4, 5, 6];
const CALENDAR_SSO_LOCK_NAME = 'mainportal:sso:calendar';

export async function migrateCalendarSso(pool = usr) {
  const conn = await pool.getConnection();
  let transactionStarted = false;
  let lockAcquired = false;

  try {
    const [[lock]] = await conn.query(
      'SELECT GET_LOCK(?, 10) AS acquired',
      [CALENDAR_SSO_LOCK_NAME]
    );
    if (Number(lock?.acquired) !== 1) {
      throw new Error('Calendar SSO migration lock was not acquired');
    }
    lockAcquired = true;

    await conn.beginTransaction();
    transactionStarted = true;

    const [roles] = await conn.query(
      `SELECT id
         FROM role_name
        WHERE id IN (${CALENDAR_SSO_ROLE_IDS.map(() => '?').join(', ')})
        ORDER BY id
        FOR UPDATE`,
      CALENDAR_SSO_ROLE_IDS
    );
    const foundRoleIds = roles.map(role => Number(role.id));
    if (foundRoleIds.length !== CALENDAR_SSO_ROLE_IDS.length ||
        foundRoleIds.some((id, index) => id !== CALENDAR_SSO_ROLE_IDS[index])) {
      throw new Error('Calendar SSO migration requires role IDs 1 through 6');
    }

    const [services] = await conn.query(
      'SELECT id, types FROM srvs WHERE name = ? ORDER BY id FOR UPDATE',
      [CALENDAR_SSO_SERVICE_NAME]
    );
    if (services.length > 1) {
      throw new Error('Calendar SSO migration found duplicate service records');
    }

    let serviceId;
    let serviceCreated = false;
    if (!services.length) {
      const [created] = await conn.query(
        'INSERT INTO srvs (types, name) VALUES (?, ?)',
        [0, CALENDAR_SSO_SERVICE_NAME]
      );
      serviceId = created.insertId;
      serviceCreated = true;
    } else {
      serviceId = services[0].id;
      if (Number(services[0].types) !== 0) {
        await conn.query('UPDATE srvs SET types = 0 WHERE id = ?', [serviceId]);
      }
    }

    const [serviceRoles] = await conn.query(
      `INSERT INTO srvs_roles (srvs_id, role_id)
       SELECT ?, rn.id
         FROM role_name rn
        WHERE rn.id IN (${CALENDAR_SSO_ROLE_IDS.map(() => '?').join(', ')})
          AND NOT EXISTS (
            SELECT 1
              FROM srvs_roles existing
             WHERE existing.srvs_id = ?
               AND existing.role_id = rn.id
          )`,
      [serviceId, ...CALENDAR_SSO_ROLE_IDS, serviceId]
    );

    const [rights] = await conn.query(
      `INSERT INTO rights (usr_id, srv_id, role_id)
       SELECT u.id, ?, u.type
         FROM users u
        WHERE u.lifecycle_state = 'active'
          AND u.type IN (${CALENDAR_SSO_ROLE_IDS.map(() => '?').join(', ')})
          AND NOT EXISTS (
            SELECT 1
              FROM rights existing
             WHERE existing.usr_id = u.id
               AND existing.srv_id = ?
          )`,
      [serviceId, ...CALENDAR_SSO_ROLE_IDS, serviceId]
    );

    const [configuredRoles] = await conn.query(
      `SELECT role_id
         FROM srvs_roles
        WHERE srvs_id = ?
          AND role_id IN (${CALENDAR_SSO_ROLE_IDS.map(() => '?').join(', ')})
        ORDER BY role_id`,
      [serviceId, ...CALENDAR_SSO_ROLE_IDS]
    );
    const configuredRoleIds = configuredRoles.map(role => Number(role.role_id));
    if (configuredRoleIds.length !== CALENDAR_SSO_ROLE_IDS.length ||
        configuredRoleIds.some((id, index) => id !== CALENDAR_SSO_ROLE_IDS[index])) {
      throw new Error('Calendar SSO migration could not verify service roles');
    }

    const [[missingRights]] = await conn.query(
      `SELECT COUNT(*) AS count
         FROM users u
        WHERE u.lifecycle_state = 'active'
          AND u.type IN (${CALENDAR_SSO_ROLE_IDS.map(() => '?').join(', ')})
          AND NOT EXISTS (
            SELECT 1
              FROM rights existing
             WHERE existing.usr_id = u.id
               AND existing.srv_id = ?
          )`,
      [...CALENDAR_SSO_ROLE_IDS, serviceId]
    );
    if (Number(missingRights?.count) !== 0) {
      throw new Error('Calendar SSO migration could not verify user rights');
    }

    await conn.commit();
    transactionStarted = false;

    return {
      serviceId: Number(serviceId),
      serviceCreated,
      serviceRolesAdded: Number(serviceRoles.affectedRows || 0),
      rightsAdded: Number(rights.affectedRows || 0),
    };
  } catch (error) {
    if (transactionStarted) await conn.rollback();
    throw error;
  } finally {
    try {
      if (lockAcquired) {
        await conn.query('SELECT RELEASE_LOCK(?) AS released', [CALENDAR_SSO_LOCK_NAME]);
      }
    } finally {
      conn.release();
    }
  }
}

export async function auth_user(pin){
    const [rows] = await usr.query(
      `SELECT id,name,type as role FROM users WHERE pin = ? LIMIT 1`,
      [pin]
    );
    return rows[0];
}

export async function getUserRolesForsrvnam(usrId, srvNmae) {
  const [rows] = await usr.query(
    `SELECT r.role_id
      FROM rights r
      JOIN srvs srv ON r.srv_id = srv.id
      WHERE r.usr_id = ? AND srv.name = ?;`,
    [usrId, srvNmae]
  );
  // Уберём null/дубликаты на всякий случай
  const ids = Array.from(new Set(rows.map(r => r.role_id).filter(v => Number.isInteger(v))));
  return ids;
}
///console.log(await getUserRolesForServiceById(147, 'portal'))
// ==== USERS ====zz
export async function get_err_roles_users() {
  const sql = `
        SELECT
            u.id,
            u.name,
            GROUP_CONCAT(s.id ORDER BY s.id) AS missing_srv_ids,
            GROUP_CONCAT(s.name ORDER BY s.name SEPARATOR ', ') AS missing_srv_names
        FROM users u
        CROSS JOIN srvs s
        LEFT JOIN rights r
            ON r.usr_id = u.id
          AND r.srv_id = s.id
        WHERE s.id < 10
          AND s.types = 0
          AND r.id IS NULL
        GROUP BY u.id, u.name
        ORDER BY u.id;

  `;
  const [rows] = await usr.query(sql);
  return rows;
}
export async function get_types() {
  const sql = `
    SELECT * FROM role_name`;
  const [rows] = await usr.query(sql);
  return rows;
}


export async function get_kafs() {
  const [rows] = await usr.query(
    `SELECT id, type, name FROM kaf_name ORDER BY type, id`
  );
  return rows;
}

export async function get_users() {
  const sql = `
    SELECT u.*, oi.provider_email AS email
    FROM users u
    LEFT JOIN (
      SELECT user_id,
             SUBSTRING_INDEX(
               GROUP_CONCAT(provider_email ORDER BY updated_at DESC SEPARATOR '\n'),
               '\n',
               1
             ) AS provider_email
      FROM oauth_identities
      GROUP BY user_id
    ) oi ON oi.user_id = u.id
    ORDER BY u.id DESC
  `;
  const [rows] = await usr.query(sql);
  return rows;
}


async function upsert_user_email(userId, email) {
  const val = (email ?? '').toString().trim();
  if (!val) return;

  // Try update existing identities
  const [upd] =  await upsert_user_email(id, email);

  if (upd.affectedRows > 0) return;

  // If no identity exists yet, create a minimal one
  await usr.query(
    `INSERT INTO oauth_identities (
        user_id, provider, provider_uid,
        provider_email, provider_email_verified,
        raw_profile_json,
        last_provider_sync_at, last_login_at,
        created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW(), NOW(), NOW())`,
    [
      userId,
      'manual',
      'manual:' + String(userId),
      val,
      0,
      '{}' 
    ]
  );
}

export async function get_user_by_id(id) {
  const [rows] = await usr.query(
    `SELECT u.*, oi.provider_email AS email
       FROM users u
       LEFT JOIN (
         SELECT user_id,
                SUBSTRING_INDEX(
                  GROUP_CONCAT(provider_email ORDER BY updated_at DESC SEPARATOR '\n'),
                  '\n',
                  1
                ) AS provider_email
         FROM oauth_identities
         GROUP BY user_id
       ) oi ON oi.user_id = u.id
      WHERE u.id = ?
      LIMIT 1`,
    [id]
  );
  return rows[0] ?? null;
}

export async function create_user({
  name,
  nickname,
  msgnickname,
  msgnickname_normalized,
  kaf,
  type,
  status,
  pin,
  tg_id,
  allow_discovery_outside_harmony,
  avatar_url_custom,
  display_name_custom,
  email
}) {
  const [res] = await usr.query(
    `INSERT INTO users (
      name, nickname, msgnickname, msgnickname_normalized,
      kaf, type, status, pin, tg_id,
      allow_discovery_outside_harmony, avatar_url_custom, display_name_custom
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      name,
      nickname || null,
      msgnickname || null,
      msgnickname_normalized || null,
      kaf,
      type,
      status,
      pin,
      tg_id,
      Number(allow_discovery_outside_harmony || 0),
      avatar_url_custom || null,
      display_name_custom || null,
    ]
  );

  await upsert_user_email(res.insertId, email);

  return res.insertId;
}

export async function update_user(id, {
  name,
  nickname,
  msgnickname,
  msgnickname_normalized,
  kaf,
  type,
  status,
  pin,
  tg_id,
  allow_discovery_outside_harmony,
  avatar_url_custom,
  display_name_custom,
  email
}) {
  const [res] = await usr.query(
    `UPDATE users
        SET name = ?,
            nickname = ?,
            msgnickname = ?,
            msgnickname_normalized = ?,
            kaf = ?,
            type = ?,
            status = ?,
            pin = ?,
            tg_id = ?,
            allow_discovery_outside_harmony = ?,
            avatar_url_custom = ?,
            display_name_custom = ?
      WHERE id = ?`,
    [
      name,
      nickname || null,
      msgnickname || null,
      msgnickname_normalized || null,
      kaf,
      type,
      status,
      pin,
      tg_id,
      Number(allow_discovery_outside_harmony || 0),
      avatar_url_custom || null,
      display_name_custom || null,
      id
    ]
  );

  await usr.query(
    `UPDATE oauth_identities
        SET provider_email = ?, updated_at = NOW()
      WHERE user_id = ?`,
    [email ? String(email).trim() : null, id]
  );

  return res.affectedRows > 0;
}

export async function delete_user(id) {
  const [res] = await usr.query(`DELETE FROM users WHERE id = ?`, [id]);
  return res.affectedRows > 0;
}

// ==== SERVICES & ROLES (для отрисовки вкладок) ====
// ===== ROLES DICTIONARY =====
export async function get_all_roles() {
  const [rows] = await usr.query(
    'SELECT id, name FROM role_name ORDER BY name'
  );
  return rows;
}

// ===== SERVICES + ALLOWED ROLES (srvs_roles) =====
export async function get_services_with_allowed_roles() {
  // базовые сервисы
  const [srvs] = await usr.query(
    'SELECT * FROM srvs ORDER BY name;'
  );
  // связки "какие роли разрешены в сервисе"
  const [rels] = await usr.query(`
    SELECT sr.srvs_id AS srv_id, rn.id AS role_id, rn.name AS role_name
    FROM srvs_roles sr
    JOIN role_name rn ON rn.id = sr.role_id
    ORDER BY rn.name
  `);

  const bySrv = new Map(srvs.map(s => [s.id, { ...s, roles: [] }]));
  for (const r of rels) {
    const s = bySrv.get(r.srv_id);
    if (s) s.roles.push({ id: r.role_id, name: r.role_name });
  }
  return Array.from(bySrv.values());
}

// Полная замена справочника srvs_roles
export async function replace_srvs_roles(pairs) {
  // pairs: [{srv_id, role_id}]
  const seen = new Set();
  const filtered = [];
  for (const p of pairs || []) {
    const srvId = Number(p?.srv_id);
    const roleId = Number(p?.role_id);
    if (!Number.isInteger(srvId) || !Number.isInteger(roleId)) continue;

    const key = `${srvId}:${roleId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    filtered.push([srvId, roleId]);
  }

  const conn = await usr.getConnection();
  try {
    await conn.beginTransaction();

    // Полностью очищаем и вставляем заново (подходит под текущий UI, который шлёт полный набор)
    await conn.query('DELETE FROM srvs_roles');

    if (filtered.length) {
      await conn.query('INSERT INTO srvs_roles (srvs_id, role_id) VALUES ?', [filtered]);
    }

    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}
export async function get_services_with_roles() {
  const [srvs] = await usr.query(`SELECT id, name FROM srvs ORDER BY name`);
  const [rels] = await usr.query(`
    SELECT sr.srvs_id AS srv_id, rn.id AS role_id, rn.name AS role_name
    FROM srvs_roles sr
    JOIN role_name rn ON rn.id = sr.role_id
    ORDER BY rn.name
  `);

  // Собираем структуру: [{id, name, roles:[{id,name}]}]
  const bySrv = new Map(srvs.map(s => [s.id, { ...s, roles: [] }]));
  for (const r of rels) {
    const s = bySrv.get(r.srv_id);
    if (s) s.roles.push({ id: r.role_id, name: r.role_name });
  }
  return Array.from(bySrv.values());
}

// ==== RIGHTS ====

export async function get_user_rights(userId) {
  const [rows] = await usr.query(
    `SELECT srv_id, role_id FROM rights WHERE usr_id = ?`,
    [userId]
  );
  return rows;
}

export async function replace_user_rights(userId, pairs) {
  // pairs: [{srv_id, role_id}]
  // Проще/надежнее — заменить весь набор:
  await usr.query(`DELETE FROM rights WHERE usr_id = ?`, [userId]);

  if (!pairs?.length) return;

  // Вставка батчем
  const values = pairs
    .filter(p => Number.isInteger(p.srv_id) && Number.isInteger(p.role_id))
    .map(p => [userId, p.srv_id, p.role_id]);

  if (values.length) {
    await usr.query(`INSERT INTO rights (usr_id, srv_id, role_id) VALUES ?`, [values]);
  }
}

// ==== LOGINS ====

export async function get_user_logins(userId) {
  const [rows] = await usr.query(
    `SELECT srvs_id AS srv_id, login, pass FROM logins WHERE usr_id = ?`,
    [userId]
  );
  return rows;
}

export async function upsert_user_logins(userId, rows) {
  // rows: [{srv_id, login, pass_hash?}]
  if (!Array.isArray(rows)) return;

  for (const r of rows) {
    const srv = Number(r.srv_id);
    const login = String(r.login ?? '').trim();
    const pass = r.pass_hash ? String(r.pass_hash) : null;

    if (!Number.isInteger(srv)) continue;

    // если пусто — удаляем запись логина для этого сервиса
    if (!login && !pass) {
      await usr.query(`DELETE FROM logins WHERE usr_id = ? AND srvs_id = ?`, [userId, srv]);
      continue;
    }

    // ищем, есть ли уже логин в этом сервисе
    const [ex] = await usr.query(
      `SELECT id FROM logins WHERE usr_id = ? AND srvs_id = ? LIMIT 1`,
      [userId, srv]
    );

    if (ex.length) {
      // апдейт
      if (pass) {
        await usr.query(
          `UPDATE logins SET login = ?, pass = ? WHERE id = ?`,
          [login, pass, ex[0].id]
        );
      } else {
        await usr.query(
          `UPDATE logins SET login = ? WHERE id = ?`,
          [login, ex[0].id]
        );
      }
    } else {
      // инсерт
      await usr.query(
        `INSERT INTO logins (srvs_id, usr_id, login, pass) VALUES (?, ?, ?, ?)`,
        [srv, userId, login, pass]
      );
    }
  }
}

function normalizeCardPayload(card = {}) {
  const type = Number(card.type);
  const role = Number(card.role);
  const shows = Number(card.shows);
  const crdorder = Number(card.crdorder);

  return {
    type: Number.isInteger(type) ? type : 0,
    title: card.title ?? null,
    cont: card.cont ?? null,
    pic: card.pic ?? null,
    role: Number.isInteger(role) ? role : 0,
    shows: Number.isInteger(shows) ? shows : 1,
    crdorder: Number.isInteger(crdorder) ? crdorder : 100,
  };
}

export async function get_card_role_options() {
  const [rows] = await usr.query(
    `SELECT id, name FROM role_name WHERE id >= 0 ORDER BY id`
  );
  return rows;
}

export async function get_cards(role = 0) {
  const numericRole = Number(role);
  const safeRole = Number.isFinite(numericRole) ? numericRole : 0;
  const [rows] = await portal.query(
    `SELECT * FROM cards WHERE role <= ? AND shows = 1 ORDER BY crdorder, id`,
    [safeRole]
  );
  return rows;
}

export async function get_all_cards() {
  const [rows] = await portal.query(
    `SELECT * FROM cards ORDER BY type, crdorder, id`
  );
  return rows;
}

export async function get_card_by_id(id) {
  const [rows] = await portal.query(
    `SELECT * FROM cards WHERE id = ? LIMIT 1`,
    [id]
  );
  return rows[0] ?? null;
}

export async function create_card(card) {
  const data = normalizeCardPayload(card);
  const [res] = await portal.query(
    `INSERT INTO cards (type, title, cont, pic, role, shows, crdorder)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [data.type, data.title, data.cont, data.pic, data.role, data.shows, data.crdorder]
  );
  return res.insertId;
}

export async function update_card(id, card) {
  const data = normalizeCardPayload(card);
  const [res] = await portal.query(
    `UPDATE cards
        SET type = ?,
            title = ?,
            cont = ?,
            pic = ?,
            role = ?,
            shows = ?,
            crdorder = ?
      WHERE id = ?`,
    [data.type, data.title, data.cont, data.pic, data.role, data.shows, data.crdorder, id]
  );
  if (res.affectedRows > 0) return true;
  return Boolean(await get_card_by_id(id));
}

export async function set_card_visibility(id, shows) {
  const [res] = await portal.query(
    `UPDATE cards SET shows = ? WHERE id = ?`,
    [shows ? 1 : 0, id]
  );
  if (res.affectedRows > 0) return true;
  return Boolean(await get_card_by_id(id));
}
