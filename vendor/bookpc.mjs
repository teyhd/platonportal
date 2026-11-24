import express from 'express';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

const apiPath = '/api/bookpc';
const upstreamPath = '/internal/integrations/harmony/bookpc-portal';
const laptopIssuesPath = '/internal/integrations/mainportal/v1/laptop-issues';
const requestIdPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function loadBookpcKey() {
  try {
    return readFileSync('/etc/platonportal/bookpc.key', 'utf8').trim();
  } catch {
    return '';
  }
}

async function loadBookpcAssignments() {
  const path = process.env.MAINPORTAL_BOOKPC_ASSIGNMENTS_FILE || '/etc/platonportal/bookpc-assignments.json';
  const assignments = JSON.parse(await readFile(path, 'utf8'));
  if (!assignments || typeof assignments !== 'object' || Array.isArray(assignments)) {
    throw new Error('invalid_bookpc_assignments');
  }
  return new Map(Object.entries(assignments).map(([id, entry]) => {
    const { label, room, showInImportant } = typeof entry === 'string' ? { label: entry } : entry ?? {};
    if (!/^[1-9][0-9]{0,9}$/.test(id) || typeof label !== 'string' || !label.trim() || label.length > 100 ||
        (room != null && (typeof room !== 'string' || !room.trim() || room.length > 60)) ||
        (showInImportant != null && typeof showInImportant !== 'boolean') || (showInImportant && !room)) {
      throw new Error('invalid_bookpc_assignment');
    }
    return [Number(id), { label: label.trim(), ...(room && { room: room.trim() }), ...(showInImportant && { showInImportant }) }];
  }));
}

export function createBookpcBlock({
  secret = process.env.MAINPORTAL_BOOKPC_SECRET ?? loadBookpcKey(),
  upstream = 'http://127.0.0.1:81',
  origin = 'https://platoniks.ru',
  issuesToken = process.env.MAINPORTAL_ROOM_ISSUES_TOKEN,
  issuesUpstream = process.env.MAINPORTAL_ROOM_ISSUES_URL || 'http://127.0.0.1:18181',
  canReadIssues = () => false,
  getAssignments = loadBookpcAssignments,
  getAssignmentAccess = async () => null,
  fetchImpl = fetch,
} = {}) {
  const enabled = /^[0-9a-f]{64}$/.test(secret ?? '');
  const actorId = session => {
    const id = Number(session?.uid);
    return Number.isSafeInteger(id) && id > 0 && id <= 2147483647 ? id : null;
  };
  let issuesCache;

  async function loadIssues() {
    const response = await fetchImpl(new URL(laptopIssuesPath, issuesUpstream), {
      headers: { Authorization: `Bearer ${issuesToken}` }, redirect: 'error', signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) throw new Error('laptop_issues_unavailable');
    const payload = await response.json();
    if (payload.schema !== 1 || !Array.isArray(payload.devices)) throw new Error('invalid_laptop_issues');
    const issues = new Map();
    for (const { targetId, count, title, incidentId } of payload.devices) {
      if (!/^laptop-\d{3,10}$/.test(targetId) || !Number.isSafeInteger(count) || count < 1 ||
          typeof title !== 'string' || !title.trim()) continue;
      const shortTitle = title.trim().replace(/\s+/g, ' ');
      issues.set(targetId, {
        count,
        title: shortTitle.length > 160 ? `${shortTitle.slice(0, 159)}…` : shortTitle,
        incidentId: requestIdPattern.test(incidentId) ? incidentId : undefined,
      });
    }
    return issues;
  }

  async function attachIssues(result, userId) {
    if (!issuesToken) return result;
    try {
      if (!await canReadIssues(userId)) return result;
      if (!issuesCache || Date.now() >= issuesCache.expiresAt) {
        const entry = { expiresAt: Infinity };
        entry.promise = loadIssues().then(issues => {
          entry.expiresAt = Date.now() + 15_000;
          return issues;
        }, () => {
          entry.expiresAt = Date.now() + 5000;
          return null;
        });
        issuesCache = entry;
      }
      const issues = await issuesCache.promise;
      if (!issues) return { ...result, issuesStatus: 'unavailable' };
      return { ...result, devices: result.devices.map(device => ({
        ...device, issue: issues.get(`laptop-${String(device.id).padStart(3, '0')}`),
      })) };
    } catch {
      return { ...result, issuesStatus: 'unavailable' };
    }
  }

  async function applyAssignments(result, userId, assignments) {
    const access = assignments.size ? await getAssignmentAccess(userId).catch(() => null) : null;
    const ownRentals = result.devices.filter(device => device.own === true && device.state === 'occupied' && device.rental?.id);
    const devices = result.devices.filter(device => !assignments.has(Number(device.id)));
    if (access === 'admin' || access === 'moderator') {
      const liveStates = new Map(result.devices.map(device => [Number(device.id), device.state]));
      for (const [id, assignment] of assignments) {
        devices.push({
          id, state: liveStates.get(id) ?? 'unknown', assignment: access === 'admin' ? assignment : {},
        });
      }
      devices.sort((first, second) => first.id - second.id);
    }
    return { ...result, devices, ownRentals };
  }

  return {
    visibleFor(session) {
      return enabled && Boolean(actorId(session)) && Array.isArray(session.right) &&
        session.right.some(right => Number(right.srv_id) === 2 && Number(right.role_id) >= 1);
    },
    register(app) {
      const router = express.Router();
      router.use((req, res, next) => {
        res.set('Cache-Control', 'private, no-store');
        res.vary('Cookie');
        if (!actorId(req.session)) return res.status(401).json({ error: 'authentication_required' });
        if (!enabled) return res.status(503).json({ error: 'bookpc_unavailable' });
        if (req.method === 'POST' && req.get('Origin') !== origin) {
          return res.status(403).json({ error: 'invalid_origin' });
        }
        next();
      });
      router.use(express.json({ limit: '8kb' }));

      const proxy = operation => async (req, res) => {
        const headers = {
          Authorization: `Bearer ${secret}`,
          'X-Portal-User-Id': String(actorId(req.session)),
        };
        let body;
        if (operation) {
          const { requestId, computer_id, room, rental_id, comment } = req.body ?? {};
          if (typeof requestId !== 'string' || !requestIdPattern.test(requestId)) {
            return res.status(400).json({ error: 'invalid_request_id' });
          }
          headers['Content-Type'] = 'application/json';
          headers['X-Portal-Request-Id'] = requestId;
          body = JSON.stringify(operation === 'rent' ? { computer_id, room } : {
            computer_id, rental_id, ...(operation === 'return' && { comment }),
          });
        }
        let assignments;
        if (!operation || operation === 'rent') {
          try {
            assignments = await getAssignments();
          } catch {
            return res.status(503).json({ error: 'assignments_unavailable' });
          }
        }
        if (operation === 'rent' && assignments.has(Number(req.body.computer_id))) {
          return res.status(409).json({ error: 'computer_assigned' });
        }
        try {
          const response = await fetchImpl(`${upstream}${upstreamPath}${operation ? `/${operation}` : ''}`, {
            method: req.method, headers, body, redirect: 'error', signal: AbortSignal.timeout(5000),
          });
          const result = await response.json();
          if (response.status === 401 || response.status >= 500) throw new Error('bookpc_unavailable');
          const userId = actorId(req.session);
          const payload = !operation && response.ok
            ? await attachIssues(await applyAssignments(result, userId, assignments), userId)
            : result;
          return res.status(response.status).json(payload);
        } catch {
          return res.status(503).json({ error: operation ? 'operation_unconfirmed' : 'bookpc_unavailable' });
        }
      };
      router.get('/', proxy());
      router.post('/rent', proxy('rent'));
      router.post('/return', proxy('return'));
      router.post('/force-return', proxy('force-return'));
      router.use((error, _req, res, _next) => {
        res.status(error.status === 413 ? 413 : 400).json({ error: 'invalid_request_body' });
      });
      app.use(apiPath, router);
    },
  };
}
