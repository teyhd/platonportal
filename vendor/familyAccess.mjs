const studentRole = 1;
const parentRole = 6;
const portalAdminRole = 5;
const portalService = 1;

export const familyServices = [
  { key: 'schedule', label: 'Расписание', ids: [8], path: 'https://rasp.platoniks.ru/schedule/personal', parameter: 'child_id', hosts: ['rasp.platoniks.ru'], image: '/img/domain-rasp.svg' },
  { key: 'diary', label: 'Дневник', ids: [11], path: 'https://diary.platoniks.ru/children/overview?viewer=parent', parameter: 'studentId', hosts: ['diary.platoniks.ru'], image: '/img/domain-diary.svg' },
  { key: 'calendar', label: 'Календарь', ids: [15], path: 'https://event.platoniks.ru/', parameter: 'child_id', hosts: ['event.platoniks.ru'], image: '/img/domain-event.svg' },
  { key: 'progress', label: 'Прогресс', ids: [3], path: 'https://rep.platoniks.ru/kid', parameter: 'uid', hosts: ['rep.platoniks.ru'], image: '/img/progres.png' },
];

export const previewServices = [
  ...familyServices,
  { key: 'attendance', label: 'Посещаемость', ids: [13] },
];

export function positiveUserId(value) {
  if ((typeof value !== 'string' && typeof value !== 'number') || !/^[1-9]\d*$/.test(String(value))) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

export function selectedFamilyChild(children, preference) {
  const selected = children.find(child => child.id === positiveUserId(preference));
  return selected ?? children[0] ?? null;
}

export function hasFamilyServiceRight(key, rights) {
  const service = familyServices.find(item => item.key === key);
  return Boolean(service && rights.some(right =>
    service.ids.includes(Number(right.srv_id)) && Number(right.role_id) === parentRole &&
    (right.roleConfigured !== 0 || service.key === 'progress')
  ));
}

export function makeFamilyLinks(childId, rights) {
  if (!positiveUserId(childId)) return [];
  return familyServices
    .filter(service => hasFamilyServiceRight(service.key, rights))
    .map(service => {
      const url = new URL(service.path);
      url.searchParams.set(service.parameter, childId);
      return { ...service, href: url.href };
    });
}

export function contextualizeFamilyCard(card, services) {
  if (card.cont === '/diary') {
    const diary = services.find(service => service.key === 'diary');
    return diary ? { ...card, cont: diary.href } : card;
  }
  let url;
  try { url = new URL(card.cont); } catch { return card; }
  const service = services.find(item => item.hosts.includes(url.hostname));
  if (!service || url.protocol !== 'https:' || url.search || url.hash) return card;
  if (url.pathname !== '/' && url.pathname !== new URL(service.path).pathname) return card;
  return { ...card, cont: service.href };
}

const active = "status = 1 AND lifecycle_state = 'active'";
const parentEligibility = `(u.type = ${parentRole}
  OR EXISTS (SELECT 1 FROM rights r WHERE r.usr_id = u.id AND r.role_id = ${parentRole})
  OR EXISTS (SELECT 1 FROM parents_kids pk WHERE pk.parent_id = u.id))`;

export function createFamilyAccess(openConnection) {
  async function withConnection(operation) {
    const connection = await openConnection();
    try { return await operation(connection); }
    finally { connection.release(); }
  }

  async function getParent(connection, parentId, lock = false) {
    const [[parent]] = await connection.query(
      `SELECT u.id FROM users u
       WHERE u.id = ? AND u.${active} AND u.type > ${studentRole} AND ${parentEligibility}
       ${lock ? 'FOR UPDATE' : ''}`,
      [parentId]
    );
    return parent;
  }

  async function getChildren(connection, parentId, includeInactive = false) {
    const [rows] = await connection.query(
      `SELECT DISTINCT child.id, child.name, COALESCE(k.name, '') AS className,
              (child.status = 1 AND child.lifecycle_state = 'active' AND child.type = 1) AS active
       FROM parents_kids pk
       JOIN users child ON child.id = pk.kid_id
       LEFT JOIN kaf_name k ON k.id = child.kaf
       WHERE pk.parent_id = ? AND pk.kid_id <> pk.parent_id
       ${includeInactive ? '' : `AND child.${active} AND child.type = ${studentRole}`}
       ORDER BY child.name, child.id`,
      [parentId]
    );
    return rows.map(row => ({ ...row, id: Number(row.id), active: Boolean(row.active) }));
  }

  async function serviceGrants(connection, userId) {
    const [rows] = await connection.query(
      `SELECT DISTINCT r.srv_id, r.role_id, s.name AS service, rn.name AS role,
              (sr.role_id IS NOT NULL) AS roleConfigured
       FROM rights r JOIN srvs s ON s.id = r.srv_id
       JOIN role_name rn ON rn.id = r.role_id
       LEFT JOIN srvs_roles sr ON sr.srvs_id = r.srv_id AND sr.role_id = r.role_id
       WHERE r.usr_id = ? AND s.types = 0 ORDER BY s.id, rn.id`,
      [userId]
    );
    return rows;
  }

  return {
    getFamily(parentId, { includeInactive = false, includeGrants = !includeInactive } = {}) {
      return withConnection(async connection => {
        if (!await getParent(connection, parentId)) return null;
        const children = await getChildren(connection, parentId, includeInactive);
        const rights = includeGrants ? await serviceGrants(connection, parentId) : [];
        return { children, rights };
      });
    },

    isAdmin(userId) {
      return withConnection(async connection => {
        const [[row]] = await connection.query(
          `SELECT 1 FROM users u JOIN rights r ON r.usr_id = u.id
           JOIN srvs_roles sr ON sr.srvs_id = r.srv_id AND sr.role_id = r.role_id
           WHERE u.type <> -1 AND u.id = ? AND u.${active} AND r.srv_id = ? AND r.role_id = ? LIMIT 1`,
          [userId, portalService, portalAdminRole]
        );
        return Boolean(row);
      });
    },

    getAccount(userId) {
      return withConnection(async connection => {
        const [[user]] = await connection.query(
          `SELECT id, name, type, (${active}) AS active FROM users WHERE id = ?`, [userId]
        );
        if (!user) return null;
        return { ...user, id: Number(user.id), active: Boolean(user.active), rights: await serviceGrants(connection, userId) };
      });
    },

    updateChild(parentId, childId, action) {
      return withConnection(async connection => {
        await connection.beginTransaction();
        try {
          // Serialize edits to a parent's relationships using the existing parent row.
          if (!await getParent(connection, parentId, true)) {
            await connection.rollback();
            return false;
          }
          if (action === 'add') {
            const [[student]] = await connection.query(
              `SELECT id FROM users WHERE id = ? AND type = ? AND ${active} FOR UPDATE`,
              [childId, studentRole]
            );
            if (!student) {
              await connection.rollback();
              return false;
            }
            await connection.query(
              `INSERT INTO parents_kids (parent_id, kid_id) SELECT ?, ?
               WHERE NOT EXISTS (SELECT 1 FROM parents_kids WHERE parent_id = ? AND kid_id = ?)`,
              [parentId, childId, parentId, childId]
            );
          } else {
            await connection.query('DELETE FROM parents_kids WHERE parent_id = ? AND kid_id = ?', [parentId, childId]);
          }
          await connection.commit();
          return true;
        } catch (error) {
          await connection.rollback();
          throw error;
        }
      });
    },
  };
}
