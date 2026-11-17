const panel = document.querySelector('[data-important]');

if (panel) {
  const $ = selector => panel.querySelector(selector);
  const list = $('[data-important-items]');
  const status = $('[data-important-sources]');
  const nodes = new Map();
  const details = new Map();
  const clockFormat = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' });
  let data = null, etag = '', context = 'personal', childId = '', generation = 0, controller, pollTimer;
  let baseTime = Date.now(), basePerformance = performance.now(), lastSuccess = 0, failures = 0, expanded = false;
  let noticeUntil = 0, boundary = '', networkFailed = false;
  let itemSequence = 0;
  const currentTime = () => baseTime + performance.now() - basePerformance;
  const text = (node, value) => { const next = String(value ?? ''); if (node.textContent !== next) node.textContent = next; };
  const element = (tag, className, value) => { const node = document.createElement(tag); if (className) node.className = className; if (value != null) text(node, value); return node; };
  const when = value => value ? Date.parse(value) : NaN;
  const formatTime = value => Number.isFinite(when(value)) ? clockFormat.format(new Date(value)) : '';
  const remaining = duration => duration < 60_000 ? 'меньше минуты' : `${Math.ceil(duration / 60_000)} мин`;
  const setClock = value => { const parsed = Date.parse(value); if (Number.isFinite(parsed)) { baseTime = parsed; basePerformance = performance.now(); } };
  const query = extra => new URLSearchParams({ context, ...(childId ? { childId } : {}), ...extra });

  function timing(item, now) {
    const start = when(item.start), end = when(item.end);
    const number = item.displayNumber == null ? '' : `${item.displayNumber}-й урок`;
    const part = String(item.segment).toUpperCase() === 'H1' ? '1-я часть' : String(item.segment).toUpperCase() === 'H2' ? '2-я часть' : '';
    if (!Number.isFinite(start) && Number.isFinite(end)) return `До ${formatTime(item.end)}`;
    if (!Number.isFinite(start) || !Number.isFinite(end)) return '';
    if (now >= end) return ['По расписанию завершено', number, part].filter(Boolean).join(' · ');
    if (now >= start) return ['Сейчас', number, part, `до конца ${remaining(end - now)}`].filter(Boolean).join(' · ');
    const delay = start - now;
    return [delay <= 600_000 ? `Через ${remaining(delay)}` : `Следующее в ${formatTime(item.start)}`, number, part].filter(Boolean).join(' · ');
  }

  function tick() {
    if (!data) return;
    const now = currentTime();
    for (const item of data.items) {
      const node = nodes.get(item.key); if (!node) continue;
      const label = timing(item, now);
      text(node.timing, label); node.timing.hidden = !label;
      node.article.dataset.imminent = String(when(item.start) > now && when(item.start) - now <= 300_000);
    }
    const slots = (data.clock ?? []).filter(slot => when(slot.start) <= now && when(slot.end) > now);
    const unique = new Set(slots.map(slot => `${slot.displayNumber}|${slot.end}`));
    const clockText = unique.size === 1 ? `${slots[0].displayNumber}-й урок · до конца ${remaining(when(slots[0].end) - now)}` : clockFormat.format(new Date(now));
    text($('[data-important-clock]'), clockText);
    $('[data-important-update]').hidden = now >= noticeUntil;
    const nextBoundary = (data.items ?? []).map(item => `${item.key}:${now >= when(item.end) ? 'ended' : now >= when(item.start) ? 'now' : when(item.start)-now <= 300_000 ? 'five' : when(item.start)-now <= 600_000 ? 'ten' : 'later'}`).join('|');
    const day = new Intl.DateTimeFormat('sv-SE', {timeZone:'Europe/Moscow'}).format(new Date(now));
    if (day !== data.date || boundary && nextBoundary !== boundary) schedule(0);
    boundary = nextBoundary;
    if (networkFailed && performance.now() - lastSuccess > 120_000) {
      list.hidden = true;
      text($('[data-important-day]'), 'Сводка устарела. Восстановите соединение или откройте нужный сервис ниже.');
    }
  }

  function createItem(key) {
    const article = element('article', 'important-item');
    const top = element('div', 'important-item-top');
    const content = element('div', 'important-item-content');
    const timing = element('p', 'important-item-timing');
    const title = element('h3', 'important-item-title');
    const subtitle = element('p', 'important-item-subtitle');
    const notes = element('div');
    const actions = element('div', 'important-item-actions');
    const toggle = element('button', 'important-details-toggle'); toggle.type = 'button'; toggle.setAttribute('aria-expanded', 'false');
    const body = element('div', 'important-details'); body.hidden = true;
    const bodyID = `important-detail-${++itemSequence}-${generation}`;
    body.id = bodyID; toggle.setAttribute('aria-controls', bodyID);
    content.append(timing, title, subtitle, notes); top.append(content, actions); article.append(top, toggle, body);
    const node = { article, timing, title, subtitle, notes, actions, toggle, body, actionKey: '', detailRevision: '' };
    toggle.addEventListener('click', () => {
      body.hidden = !body.hidden; toggle.setAttribute('aria-expanded', String(!body.hidden));
      if (!body.hidden) loadDetails(key, true);
    });
    nodes.set(key, node); return node;
  }

  function render() {
    panel.hidden = !data.visible;
    if (!data.visible) return;
    list.hidden = false;
    $('[data-important-contexts]').hidden = !data.schoolAllowed;
    for (const button of panel.querySelectorAll('[data-context]')) button.setAttribute('aria-pressed', String(button.dataset.context === context));
    const children = data.children ?? [];
    const childSelect = $('[data-important-child]');
    const childOptions = JSON.stringify(children.map(child => [child.id, child.name]));
    if (childSelect.dataset.options !== childOptions) {
      childSelect.replaceChildren(...children.map(child => { const option = element('option', '', child.name); option.value = child.id; return option; }));
      childSelect.dataset.options = childOptions;
    }
    childSelect.value = String(data.selectedChildId ?? '');
    $('[data-important-family]').hidden = children.length < 2 || context !== 'personal';
    const issues = Object.values(data.sources).filter(source => source.partial || ['unavailable', 'unconfigured'].includes(source.status));
    text(status, issues.length ? issues.map(source => `${source.label}: ${source.status==='ready' && source.partial ? 'часть сведений временно недоступна' : source.checkedAt ? `последние данные ${formatTime(source.checkedAt)}` : 'временно недоступно'}`).join(' · ')
      : `Обновлено в ${formatTime(data.serverTime)}`);
    const wanted = new Set(data.items.map(item => item.key));
    for (const [key, node] of nodes) if (!wanted.has(key)) {
      if (node.article.contains(document.activeElement)) $('[data-important-refresh]').focus({ preventScroll: true });
      details.get(key)?.controller?.abort(); node.article.remove(); nodes.delete(key); details.delete(key);
    }
    const focused = list.contains(document.activeElement);
    data.items.forEach((item, index) => {
      const node = nodes.get(item.key) || createItem(item.key);
      node.article.dataset.tone = item.tone || 'neutral';
      text(node.title, item.title); text(node.subtitle, item.subtitle); node.subtitle.hidden = !item.subtitle;
      const notesKey = JSON.stringify(item.notes ?? []);
      if (node.notes.dataset.value !== notesKey) { node.notes.replaceChildren(...(item.notes ?? []).map(note => element('p', 'important-note', note))); node.notes.dataset.value = notesKey; }
      const actionKey = JSON.stringify(item.actions ?? []);
      if (actionKey !== node.actionKey) {
        node.actions.replaceChildren(...(item.actions ?? []).map(action => {
          const link = element('a', '', action.label); link.href = action.href;
          if (['#lesson', '#room'].includes(action.href)) link.addEventListener('click', event => {
            const existing = document.querySelector(`[data-lesson-room-panel] a[href="${action.href}"]`);
            if (existing) { event.preventDefault(); existing.click(); }
          });
          return link;
        })); node.actionKey = actionKey;
      }
      node.toggle.hidden = !item.detailCount;
      text(node.toggle, `${item.detailLabel || 'Подробнее'} · ${item.detailCount ?? 0}${item.attentionCount ? ` / проверить ${item.attentionCount}` : ''} ▾`);
      const changedDetails = node.detailRevision !== item.detailRevision;
      node.detailRevision = item.detailRevision;
      if (!node.body.hidden && (changedDetails || item.remoteDetails)) loadDetails(item.key, true, true);
      node.article.hidden = !expanded && index >= 3 && !node.article.contains(document.activeElement);
      if (!focused || !node.article.isConnected) list.append(node.article);
    });
    const more = $('[data-important-more]');
    more.hidden = data.items.length <= 3;
    text(more, expanded ? 'Свернуть' : `Ещё: ${Math.max(0, data.items.length - 3)}`);
    more.setAttribute('aria-expanded', String(expanded));
    text($('[data-important-day]'), data.daySummary || (!data.items.length ? 'Сейчас нет доступных персональных событий' : ''));
    tick();
  }

  function detailState(key) {
    if (details.has(key)) return details.get(key);
    const node = nodes.get(key);
    const metadata = element('p', 'important-detail-metadata');
    const tools = element('div', 'important-detail-tools');
    const filters = element('div');
    const all = element('button', '', 'Все'); all.type = 'button'; all.setAttribute('aria-pressed', 'true');
    const attention = element('button', '', 'Требуют внимания'); attention.type = 'button'; attention.setAttribute('aria-pressed', 'false');
    const search = element('input'); search.type = 'search'; search.placeholder = 'Найти ученика'; search.setAttribute('aria-label', 'Поиск ученика');
    filters.append(all, attention); tools.append(filters, search);
    const message = element('p', 'important-detail-status'); message.setAttribute('role', 'status');
    const students = element('ul', 'important-students');
    const more = element('button', 'important-more-rows', 'Показать ещё'); more.type = 'button'; more.hidden = true;
    node.body.append(metadata, tools, message, students, more);
    const state = { metadata, tools, all, attention, search, message, students, more, rows: new Map(), filter: 'all', q: '', nextOffset: null, request: 0 };
    let searchTimer;
    search.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.q = search.value; loadDetails(key, true); }, 250); });
    for (const [button, filter] of [[all, 'all'], [attention, 'attention']]) button.addEventListener('click', () => { state.filter = filter; loadDetails(key, true); });
    more.addEventListener('click', () => loadDetails(key, false));
    details.set(key, state); return state;
  }

  function renderRows(state, rows, reset) {
    const incoming = new Set(rows.map(row => row.id));
    if (reset) for (const [id, row] of state.rows) if (!incoming.has(id)) { if (row.node.contains(document.activeElement)) state.all.focus({ preventScroll:true }); row.node.remove(); state.rows.delete(id); }
    for (const person of rows) {
      let row = state.rows.get(person.id);
      if (!row) {
        const node = element('li', 'important-student');
        const name = element('span', 'important-student-name');
        const description = element('div', 'important-student-description');
        const status = element('p'); const annotations = element('small'); description.append(status, annotations);
        const link = element('a', '', 'Открыть'); node.append(name, description, link);
        row = { node, name, status, annotations, link }; state.rows.set(person.id, row);
      }
      text(row.name, person.name); text(row.status, person.description); text(row.annotations, (person.annotations ?? []).join(' · '));
      row.node.dataset.attention = String(person.needsAttention); row.link.hidden = !person.href;
      if (person.href) row.link.href = person.href;
      if (!row.node.contains(document.activeElement)) state.students.append(row.node);
    }
  }

  async function loadDetails(key, reset, automatic = false) {
    if (!nodes.has(key)) return;
    const state = detailState(key); state.controller?.abort(); state.controller = new AbortController();
    const request = ++state.request, scope = generation;
    const requestController = state.controller;
    const timeout = setTimeout(() => requestController.abort(), 12_000);
    if (!automatic) text(state.message, 'Обновляем…'); state.more.disabled = true;
    try {
      let offset = reset ? 0 : state.nextOffset ?? 0, payload;
      const rows = [], wanted = automatic ? Math.max(50, state.rows.size) : 50;
      do {
        const response = await fetch(`/api/important/details?${query({ key, offset: String(offset), filter: state.filter, q: state.q })}`, { credentials:'same-origin', cache:'no-cache', signal:requestController.signal });
        if (scope !== generation || request !== state.request) return;
        if ([401,403].includes(response.status)) { clearPrivateData(); return; }
        if (!response.ok) throw new Error('details_unavailable');
        payload = await response.json();
        if (scope !== generation || request !== state.request) return;
        rows.push(...payload.rows);
        if (payload.nextOffset != null && payload.nextOffset <= offset) payload.nextOffset = null;
        offset = payload.nextOffset;
      } while (automatic && offset != null && rows.length < wanted);
      payload.rows = rows;
      renderRows(state, payload.rows, reset);
      state.nextOffset = payload.nextOffset;
      state.more.hidden = payload.nextOffset == null;
      state.search.hidden = payload.total <= 12 && !state.q;
      const item = data?.items.find(item => item.key === key);
      state.tools.hidden = Boolean(item?.remoteDetails);
      state.attention.hidden = !item?.attentionCount;
      state.all.setAttribute('aria-pressed', String(state.filter === 'all'));
      state.attention.setAttribute('aria-pressed', String(state.filter === 'attention'));
      text(state.metadata, payload.metadata.join(' · '));
      text(state.message, payload.total ? `Показано ${state.rows.size} из ${payload.total}` : 'По выбранным условиям учеников нет');
    } catch (error) { if (error.name !== 'AbortError' && request === state.request) text(state.message, 'Не удалось обновить сведения. Сверните и откройте список для повтора.'); }
    finally { clearTimeout(timeout); if (request === state.request) state.more.disabled = false; }
  }

  function clearPrivateData() {
    generation++; controller?.abort(); controller = null; clearTimeout(pollTimer);
    for (const state of details.values()) state.controller?.abort();
    list.replaceChildren(); nodes.clear(); details.clear(); data = null; etag = ''; panel.hidden = true;
    $('[data-important-child]').replaceChildren();
    $('[data-important-child]').dataset.options = '';
  }
  function schedule(delay = 15_000) {
    clearTimeout(pollTimer);
    if (!document.hidden) pollTimer = setTimeout(refresh, delay);
  }
  async function refresh() {
    if (document.hidden || controller) return;
    const scope = generation;
    controller = new AbortController();
    const requestController = controller;
    const timeout = setTimeout(() => requestController.abort(), 15_000);
    try {
      const response = await fetch(`/api/important?${query()}`, { credentials:'same-origin', cache:'no-cache', signal:controller.signal, headers:etag?{'If-None-Match':etag}:{} });
      if (scope !== generation) return;
      if ([401,403,404].includes(response.status)) { clearPrivateData(); return; }
      if (!response.ok && response.status !== 304) throw new Error('important_unavailable');
      if (response.status === 304 && data) {
        data.serverTime = response.headers.get('X-Server-Time') || data.serverTime;
      } else {
        const next = await response.json();
        if (scope !== generation) return;
        if (data?.scheduleFingerprint && next.scheduleFingerprint && next.scheduleFingerprint !== data.scheduleFingerprint && next.date === data.date) noticeUntil = Date.parse(next.serverTime) + 300_000;
        data = next;
      }
      setClock(response.headers.get('X-Server-Time') || data.serverTime);
      etag = response.headers.get('etag') || ''; failures = 0; lastSuccess = performance.now(); networkFailed = false;
      panel.dataset.offline = 'false'; render();
    } catch (error) {
      if (scope !== generation) return;
      networkFailed = true; failures++; panel.hidden = false; panel.dataset.offline = 'true';
      text(status, 'Не удалось обновить сводку. Повторим после восстановления связи.');
    } finally {
      clearTimeout(timeout); if (controller === requestController) controller = null;
      if (scope === generation) schedule(failures ? Math.min(60_000, 30_000 * failures) : 15_000);
    }
  }
  function changeScope() {
    clearPrivateData(); expanded = false; boundary = ''; noticeUntil = 0;
    panel.hidden = false; text(status, 'Загружаем вашу сводку…');
    // Let the cancelled request release its controller before starting the new scope.
    schedule(0);
  }
  for (const button of panel.querySelectorAll('[data-context]')) button.addEventListener('click', () => { context = button.dataset.context; changeScope(); });
  $('[data-important-child]').addEventListener('change', event => { childId = event.target.value; changeScope(); });
  $('[data-important-more]').addEventListener('click', () => { expanded = !expanded; render(); });
  $('[data-important-refresh]').addEventListener('click', () => { etag = ''; schedule(0); });
  document.addEventListener('visibilitychange', () => document.hidden ? clearTimeout(pollTimer) : schedule(0));
  window.addEventListener('focus', () => schedule(0)); window.addEventListener('online', () => schedule(0));
  window.addEventListener('pagehide', clearPrivateData);
  window.addEventListener('pageshow', event => { if (event.persisted) schedule(0); });
  panel.hidden = false;
  setInterval(tick, 1000);
  refresh();
}
