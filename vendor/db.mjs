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

export const EXTERNAL_ROLE_ID = -1;
export const PORTAL_SERVICE_ID = 1;
export const PORTAL_ADMIN_ROLE_ID = 5;
export const PORTAL_MODERATOR_ROLE_ID = 7;
export const PORTAL_ADMIN_USER_ID = 100;

export function getNonExternalUserClause(prefix = 'WHERE') {
  return `${prefix} (u.type <> ${EXTERNAL_ROLE_ID} OR u.type IS NULL)`;
}

const CALENDAR_SSO_SERVICE_NAME = 'calendar';
const CALENDAR_SSO_ROLE_IDS = [1, 2, 3, 4, 5, 6, PORTAL_MODERATOR_ROLE_ID];
const CALENDAR_SSO_LOCK_NAME = 'mainportal:sso:calendar';
const PORTAL_MODERATOR_LOCK_NAME = 'mainportal:portal:moderator';

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
      throw new Error('Calendar SSO migration requires role IDs 1 through 7');
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
               AND existing.role_id = u.type
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
               AND existing.role_id = u.type
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

export async function migratePortalModeratorRole(pool = usr) {
  const conn = await pool.getConnection();
  let transactionStarted = false;
  let lockAcquired = false;

  try {
    const [[lock]] = await conn.query(
      'SELECT GET_LOCK(?, 10) AS acquired',
      [PORTAL_MODERATOR_LOCK_NAME]
    );
    if (Number(lock?.acquired) !== 1) {
      throw new Error('Portal moderator migration lock was not acquired');
    }
    lockAcquired = true;

    await conn.beginTransaction();
    transactionStarted = true;

    const [roles] = await conn.query(
      'SELECT id, name FROM role_name WHERE id IN (?, ?) ORDER BY id FOR UPDATE',
      [PORTAL_ADMIN_ROLE_ID, PORTAL_MODERATOR_ROLE_ID]
    );
    const adminRole = roles.find(role => Number(role.id) === PORTAL_ADMIN_ROLE_ID);
    const moderatorRole = roles.find(role => Number(role.id) === PORTAL_MODERATOR_ROLE_ID);

    if (!adminRole || String(adminRole.name).trim().toLocaleLowerCase('ru-RU') !== 'админ') {
      throw new Error('Portal moderator migration requires the Admin role with ID 5');
    }
    if (moderatorRole && String(moderatorRole.name).trim().toLocaleLowerCase('ru-RU') !== 'модератор') {
      throw new Error('Portal moderator role ID 7 is already assigned to another role');
    }

    let moderatorRoleCreated = false;
    if (!moderatorRole) {
      await conn.query(
        'INSERT INTO role_name (id, name) VALUES (?, ?)',
        [PORTAL_MODERATOR_ROLE_ID, 'Модератор']
      );
      moderatorRoleCreated = true;
    }

    const [adminServices] = await conn.query(
      'SELECT srvs_id FROM srvs_roles WHERE role_id = ? FOR UPDATE',
      [PORTAL_ADMIN_ROLE_ID]
    );
    if (!adminServices.some(service => Number(service.srvs_id) === PORTAL_SERVICE_ID)) {
      throw new Error('Portal moderator migration requires the Admin role for the portal service');
    }

    const [user100] = await conn.query(
      'SELECT id FROM users WHERE id = ? FOR UPDATE',
      [PORTAL_ADMIN_USER_ID]
    );
    if (!user100.length) {
      throw new Error('Portal moderator migration requires user 100');
    }

    const [serviceRoles] = await conn.query(
      `INSERT INTO srvs_roles (srvs_id, role_id)
       SELECT admin.srvs_id, ?
         FROM srvs_roles admin
        WHERE admin.role_id = ?
          AND NOT EXISTS (
            SELECT 1
              FROM srvs_roles moderator
             WHERE moderator.srvs_id = admin.srvs_id
               AND moderator.role_id = ?
          )`,
      [PORTAL_MODERATOR_ROLE_ID, PORTAL_ADMIN_ROLE_ID, PORTAL_MODERATOR_ROLE_ID]
    );

    const [serviceRights] = await conn.query(
      `UPDATE rights r
         JOIN users u ON u.id = r.usr_id
           SET r.role_id = ?
       WHERE r.role_id = ?
         AND u.type = ?
         AND u.id <> ?`,
      [PORTAL_MODERATOR_ROLE_ID, PORTAL_ADMIN_ROLE_ID, PORTAL_ADMIN_ROLE_ID, PORTAL_ADMIN_USER_ID]
    );
    const [userTypes] = await conn.query(
      'UPDATE users SET type = ? WHERE type = ? AND id <> ?',
      [PORTAL_MODERATOR_ROLE_ID, PORTAL_ADMIN_ROLE_ID, PORTAL_ADMIN_USER_ID]
    );
    await conn.query(
      'UPDATE users SET type = ? WHERE id = ?',
      [PORTAL_ADMIN_ROLE_ID, PORTAL_ADMIN_USER_ID]
    );
    await conn.query(
      `INSERT INTO rights (usr_id, srv_id, role_id)
       SELECT ?, ?, ?
        WHERE NOT EXISTS (
          SELECT 1
            FROM rights
           WHERE usr_id = ?
             AND srv_id = ?
             AND role_id = ?
        )`,
      [
        PORTAL_ADMIN_USER_ID,
        PORTAL_SERVICE_ID,
        PORTAL_ADMIN_ROLE_ID,
        PORTAL_ADMIN_USER_ID,
        PORTAL_SERVICE_ID,
        PORTAL_ADMIN_ROLE_ID,
      ]
    );

    const [[missingServiceRoles]] = await conn.query(
      `SELECT COUNT(*) AS count
         FROM srvs_roles admin
         LEFT JOIN srvs_roles moderator
           ON moderator.srvs_id = admin.srvs_id
          AND moderator.role_id = ?
        WHERE admin.role_id = ?
          AND moderator.srvs_id IS NULL`,
      [PORTAL_MODERATOR_ROLE_ID, PORTAL_ADMIN_ROLE_ID]
    );
    const [[remainingAdmins]] = await conn.query(
      'SELECT COUNT(*) AS count FROM users WHERE type = ? AND id <> ?',
      [PORTAL_ADMIN_ROLE_ID, PORTAL_ADMIN_USER_ID]
    );
    const [[remainingAdminRights]] = await conn.query(
      `SELECT COUNT(*) AS count
         FROM rights r
         JOIN users u ON u.id = r.usr_id
        WHERE r.role_id = ?
          AND u.type = ?`,
      [PORTAL_ADMIN_ROLE_ID, PORTAL_MODERATOR_ROLE_ID]
    );
    const [[user100PortalAdminRight]] = await conn.query(
      'SELECT COUNT(*) AS count FROM rights WHERE usr_id = ? AND srv_id = ? AND role_id = ?',
      [PORTAL_ADMIN_USER_ID, PORTAL_SERVICE_ID, PORTAL_ADMIN_ROLE_ID]
    );

    if (Number(missingServiceRoles?.count) !== 0 ||
        Number(remainingAdmins?.count) !== 0 ||
        Number(remainingAdminRights?.count) !== 0 ||
        Number(user100PortalAdminRight?.count) !== 1) {
      throw new Error('Portal moderator migration could not verify role assignments');
    }

    await conn.commit();
    transactionStarted = false;

    return {
      moderatorRoleCreated,
      serviceRolesAdded: Number(serviceRoles.affectedRows || 0),
      userTypesChanged: Number(userTypes.affectedRows || 0),
      serviceRightsChanged: Number(serviceRights.affectedRows || 0),
    };
  } catch (error) {
    if (transactionStarted) await conn.rollback();
    throw error;
  } finally {
    try {
      if (lockAcquired) {
        await conn.query('SELECT RELEASE_LOCK(?) AS released', [PORTAL_MODERATOR_LOCK_NAME]);
      }
    } finally {
      conn.release();
    }
  }
}

export async function ensureCalendarSsoRightForUser(userId, pool = usr) {
  const [right] = await pool.query(
    `INSERT INTO rights (usr_id, srv_id, role_id)
     SELECT u.id, calendar.id, u.type
       FROM users u
       CROSS JOIN (
         SELECT id
           FROM srvs
          WHERE name = ?
          ORDER BY id
          LIMIT 1
       ) calendar
      WHERE u.id = ?
        AND u.lifecycle_state = 'active'
        AND u.type IN (${CALENDAR_SSO_ROLE_IDS.map(() => '?').join(', ')})
        AND NOT EXISTS (
          SELECT 1
            FROM rights existing
           WHERE existing.usr_id = u.id
             AND existing.srv_id = calendar.id
             AND existing.role_id = u.type
        )`,
    [CALENDAR_SSO_SERVICE_NAME, userId, ...CALENDAR_SSO_ROLE_IDS]
  );

  return Number(right.affectedRows || 0);
}

export async function auth_user(pin, pool = usr){
    const [rows] = await pool.query(
      `SELECT id,name,type as role
         FROM users
        WHERE pin = ?
          AND status = 1
          AND lifecycle_state = 'active'
        LIMIT 1`,
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
export async function get_err_roles_users(pool = usr) {
  // External accounts do not receive service roles by design, so they are never access issues.
  const externalFilter = getNonExternalUserClause('AND');
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
          ${externalFilter}
        GROUP BY u.id, u.name
        ORDER BY u.id;

  `;
  const [rows] = await pool.query(sql);
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

export async function get_users({ excludeExternal = false } = {}) {
  const externalFilter = excludeExternal ? getNonExternalUserClause() : '';
  const sql = `
    SELECT u.*, DATE_FORMAT(u.birth_date, '%Y-%m-%d') AS birth_date, oi.provider_email AS email
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
    ${externalFilter}
    ORDER BY u.id DESC
  `;
  const [rows] = await usr.query(sql);
  return rows;
}

function isIsoBirthDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
}

export async function fill_missing_user_birth_dates(updates, pool = usr) {
  if (!Array.isArray(updates)) throw new TypeError('Birth date updates must be an array');

  const datesByUserId = new Map();
  for (const update of updates) {
    const userId = Number(update?.id);
    const birthDate = String(update?.birth_date ?? update?.birthDate ?? '');

    if (!Number.isSafeInteger(userId) || userId <= 0 || !isIsoBirthDate(birthDate)) {
      throw new TypeError('Each birth date update must contain a valid user id and ISO date');
    }

    const existingDate = datesByUserId.get(userId);
    if (existingDate && existingDate !== birthDate) {
      throw new TypeError(`User ${userId} has conflicting birth date updates`);
    }
    datesByUserId.set(userId, birthDate);
  }

  if (!datesByUserId.size) return { updated: 0, alreadyPresent: 0 };

  const connection = await pool.getConnection();
  let transactionStarted = false;

  try {
    await connection.beginTransaction();
    transactionStarted = true;

    const userIds = [...datesByUserId.keys()];
    const [users] = await connection.query(
      `SELECT id, DATE_FORMAT(birth_date, '%Y-%m-%d') AS birth_date
         FROM users
        WHERE id IN (${userIds.map(() => '?').join(', ')})
        FOR UPDATE`,
      userIds
    );

    if (users.length !== userIds.length) {
      throw new Error('One or more users for the birth date update were not found');
    }

    const usersById = new Map(users.map(user => [Number(user.id), user]));
    let updated = 0;
    let alreadyPresent = 0;

    for (const userId of userIds) {
      const user = usersById.get(userId);
      if (user.birth_date) {
        alreadyPresent += 1;
        continue;
      }

      const [result] = await connection.query(
        'UPDATE users SET birth_date = ? WHERE id = ? AND birth_date IS NULL',
        [datesByUserId.get(userId), userId]
      );

      if (result.affectedRows !== 1) {
        throw new Error(`Birth date for user ${userId} could not be updated`);
      }
      updated += 1;
    }

    await connection.commit();
    transactionStarted = false;
    return { updated, alreadyPresent };
  } catch (error) {
    if (transactionStarted) await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}


async function upsert_user_email(userId, email) {
  const val = (email ?? '').toString().trim();
  if (!val) return;

  // Try update existing identities
  const [upd] = await usr.query(
    `UPDATE oauth_identities
        SET provider_email = ?, updated_at = NOW()
      WHERE user_id = ?`,
    [val, userId]
  );

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
    `SELECT u.*, DATE_FORMAT(u.birth_date, '%Y-%m-%d') AS birth_date, oi.provider_email AS email
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
  birth_date,
  email
}) {
  const [res] = await usr.query(
    `INSERT INTO users (
      name, nickname, msgnickname, msgnickname_normalized,
      kaf, type, status, pin, tg_id,
      allow_discovery_outside_harmony, avatar_url_custom, display_name_custom, birth_date
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      birth_date || null,
    ]
  );

  await upsert_user_email(res.insertId, email);
  await ensureCalendarSsoRightForUser(res.insertId);

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
  birth_date,
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
            display_name_custom = ?,
            birth_date = CASE WHEN ? THEN ? ELSE birth_date END
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
      Number(birth_date !== undefined),
      birth_date ?? null,
      id
    ]
  );

  if (email !== undefined) {
    await usr.query(
      `UPDATE oauth_identities
          SET provider_email = ?, updated_at = NOW()
        WHERE user_id = ?`,
      [email ? String(email).trim() : null, id]
    );
  }

  if (!res.affectedRows) return false;

  await ensureCalendarSsoRightForUser(id);
  return true;
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

  // Вставка батчем
  const values = (pairs || [])
    .filter(p => Number.isInteger(p.srv_id) && Number.isInteger(p.role_id))
    .map(p => [userId, p.srv_id, p.role_id]);

  if (values.length) {
    await usr.query(`INSERT INTO rights (usr_id, srv_id, role_id) VALUES ?`, [values]);
  }

  await ensureCalendarSsoRightForUser(userId);
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
