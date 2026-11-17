const panel = document.querySelector('[data-important]');

if (panel) {
  const $ = selector => panel.querySelector(selector);
  const list = $('[data-important-items]');
  const status = $('[data-important-sources]');
  const nodes = new Map();
  const details = new Map();
  const clockFormat = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' });
  const dateFormat = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow' });
  const schoolCategories = {
    attendance: 'Посещаемость',
    schedule_conflict: 'Расписание',
    publication: 'Расписание',
    reports: 'Обращения',
    flex: 'Flex',
  };
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

  function updateLessonTime(item, node, now) {
    const start = when(item.start);
    const end = when(item.end);
    if (!Number.isFinite(start) || !(end > start)) return false;
    const current = start <= now && now < end;
    const upcoming = now < start;
    const imminent = upcoming && start - now <= 300_000;
    const stage = current ? 'Сейчас' : imminent ? 'Скоро' : upcoming ? 'Далее' : 'Завершилось';
    const number = item.displayNumber == null ? '' : `${item.displayNumber}-й урок`;
    const segment = String(item.segment ?? '').toUpperCase();
    const half = segment === 'H1' ? '1-я часть' : segment === 'H2' ? '2-я часть' : '';
    node.article.dataset.current = String(current);
    node.article.dataset.imminent = String(imminent);
    text(node.timing, [stage, number, half].filter(Boolean).join(' · '));
    node.timing.hidden = false;
    node.timeBox.hidden = false;
    text(node.timeValue, current ? remaining(end - now) : formatTime(upcoming ? item.start : item.end));
    text(node.timeCaption, current ? 'до конца'
      : upcoming && start - now <= 600_000 ? `через ${remaining(start - now)}`
        : upcoming ? 'начало' : 'завершилось');
    node.progress.hidden = !current;
    if (current) node.progressFill.style.width = `${100 * (now - start) / (end - start)}%`;
    return current;
  }

  function tick() {
    if (!data) return;
    const now = currentTime();
    let hasCurrentLesson = false;
    for (const item of data.items) {
      const node = nodes.get(item.key); if (!node) continue;
      if (item.kind === 'lesson') {
        const current = updateLessonTime(item, node, now);
        hasCurrentLesson ||= current && !node.article.hidden;
      } else if (context === 'personal') {
        const label = timing(item, now);
        text(node.timing, label); node.timing.hidden = !label;
      }
    }
    const slots = (data.clock ?? []).filter(slot => when(slot.start) <= now && when(slot.end) > now);
    const unique = new Set(slots.map(slot => `${slot.displayNumber}|${slot.end}`));
    const clockText = unique.size === 1 ? `${slots[0].displayNumber}-й урок · до конца ${remaining(when(slots[0].end) - now)}` : clockFormat.format(new Date(now));
    const clock = $('[data-important-clock]');
    clock.hidden = hasCurrentLesson;
    text(clock, clockText);
    $('[data-important-update]').hidden = now >= noticeUntil;
    const nextBoundary = (data.items ?? []).map(item => `${item.key}:${now >= when(item.end) ? 'ended' : now >= when(item.start) ? 'now' : when(item.start)-now <= 300_000 ? 'five' : when(item.start)-now <= 600_000 ? 'ten' : 'later'}`).join('|');
    const day = dateFormat.format(new Date(now));
    if (day !== data.date || boundary && nextBoundary !== boundary) schedule(0);
    boundary = nextBoundary;
    if (networkFailed && performance.now() - lastSuccess > 120_000) {
      list.hidden = true;
      const footer = $('[data-important-day]');
      text(footer, 'Сводка устарела. Восстановите соединение или откройте нужный сервис ниже.');
      footer.hidden = false;
    }
  }

  function createItem(key) {
    const article = element('article', 'important-item');
    const top = element('div', 'important-item-top');
    const content = element('div', 'important-item-content');
    const timing = element('p', 'important-item-timing');
    const title = element('h3', 'important-item-title');
    const subtitle = element('p', 'important-item-subtitle');
    const notes = element('div', 'important-notes');
    const timeBox = element('div', 'important-timebox');
    const timeValue = element('span', 'important-time-value');
    const timeCaption = element('span', 'important-time-caption');
    timeBox.hidden = true;
    timeBox.append(timeValue, timeCaption);
    const progress = element('div', 'important-progress');
    const progressFill = element('span');
    progress.hidden = true;
    progress.setAttribute('aria-hidden', 'true');
    progress.append(progressFill);
    const contacts = element('div', 'important-mentors');
    const contactLabel = element('span', 'important-mentor-label');
    const contactList = element('ul');
    contacts.hidden = true;
    contacts.append(contactLabel, contactList);
    const controls = element('div', 'important-item-controls');
    const primaryActions = element('div', 'important-item-actions');
    const actions = element('div', 'important-item-actions');
    const toggle = element('button', 'important-details-toggle');
    const toggleText = element('span');
    const checkCount = element('span', 'important-check-count');
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.append(toggleText, checkCount);
    const metric = element('div', 'important-metric');
    const metricValue = element('span', 'important-metric-value');
    const metricLabel = element('span', 'important-time-caption');
    metric.append(metricValue, metricLabel);
    metric.hidden = true;
    const body = element('div', 'important-details'); body.hidden = true;
    const bodyID = `important-detail-${++itemSequence}-${generation}`;
    body.id = bodyID; toggle.setAttribute('aria-controls', bodyID);
    content.append(timing, title, subtitle, notes);
    top.append(content, timeBox, metric);
    controls.append(primaryActions, toggle, actions);
    article.append(top, contacts, progress, controls, body);
    const node = { article, timing, title, subtitle, notes, timeBox, timeValue, timeCaption, progress, progressFill,
      metric, metricValue, metricLabel, controls, primaryActions, actions, toggle, toggleText, checkCount,
      contacts, contactLabel, contactList, body, actionKey: '', contactKey: '', detailRevision: '' };
    toggle.addEventListener('click', () => {
      body.hidden = !body.hidden; toggle.setAttribute('aria-expanded', String(!body.hidden));
      if (!body.hidden) loadDetails(key, true);
    });
    nodes.set(key, node); return node;
  }

  function renderMentors(node, mentors = []) {
    const contactKey = JSON.stringify(mentors);
    if (node.contactKey === contactKey) return;
    node.contactKey = contactKey;
    node.contacts.hidden = !mentors.length;
    text(node.contactLabel, mentors.length === 1 ? 'Наставник' : 'Наставники');
    node.contactList.replaceChildren(...mentors.map(mentor => {
      const row = element('li');
      if (mentor.classNames.length) {
        row.append(element('span', 'important-mentor-classes', mentor.classNames.join(', ')));
      }
      if (/^https:\/\/t\.me\/[a-z][a-z0-9_]{3,31}$/i.test(mentor.href ?? '')) {
        const link = element('a', '', mentor.name);
        link.href = mentor.href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.setAttribute('aria-label', `${mentor.name} в Telegram`);
        row.append(link);
      } else {
        row.append(element('span', '', mentor.name), element('small', '', 'Telegram не указан'));
      }
      return row;
    }));
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
    status.dataset.state = issues.length ? 'warning' : 'ready';
    text(status, issues.length ? issues.map(source => `${source.label}: ${source.status==='ready' && source.partial ? 'часть сведений временно недоступна' : source.checkedAt ? `последние данные ${formatTime(source.checkedAt)}` : 'временно недоступно'}`).join(' · ')
      : `Обновлено в ${formatTime(data.serverTime)}`);
    const wanted = new Set(data.items.map(item => item.key));
    for (const [key, node] of nodes) if (!wanted.has(key)) {
      if (node.article.contains(document.activeElement)) $('[data-important-refresh]').focus({ preventScroll: true });
      details.get(key)?.controller?.abort(); node.article.remove(); nodes.delete(key); details.delete(key);
    }
    const focused = list.contains(document.activeElement);
    panel.dataset.context = context;
    panel.dataset.empty = String(!data.items.length);
    list.dataset.paired = String(context === 'personal' && data.items.slice(0, 2).filter(item => item.kind === 'lesson').length === 2);
    data.items.forEach((item, index) => {
      const node = nodes.get(item.key) || createItem(item.key);
      const lesson = item.kind === 'lesson';
      const school = context === 'school';
      const count = item.kind === 'attendance' ? item.detailCount : item.count;
      node.article.dataset.tone = item.tone || 'neutral';
      node.article.dataset.kind = item.kind;
      node.article.dataset.pair = String(index < 2 && lesson);
      text(node.title, item.title);
      const subtitle = school && item.kind === 'attendance' && item.recordCount != null ? `Записей: ${item.recordCount}` : item.subtitle;
      text(node.subtitle, subtitle);
      node.subtitle.hidden = !subtitle || (school && count > 0 && subtitle === `Записей: ${count}` && item.kind !== 'attendance');
      renderMentors(node, item.mentors);
      node.metric.hidden = !school || !(count > 0);
      text(node.metricValue, count);
      text(node.metricLabel, item.kind === 'attendance' ? 'Ученики' : 'Записи');
      if (school) {
        text(node.timing, schoolCategories[item.kind] || '');
        node.timing.hidden = !schoolCategories[item.kind];
      }
      const notes = (item.notes ?? []).filter(note => !(lesson && note === `Требуют проверки: ${item.attentionCount}`));
      const notesKey = JSON.stringify(notes);
      if (node.notes.dataset.value !== notesKey) { node.notes.replaceChildren(...notes.map(note => element('p', 'important-note', note))); node.notes.dataset.value = notesKey; }
      const actionKey = JSON.stringify(item.actions ?? []);
      if (actionKey !== node.actionKey) {
        node.actions.replaceChildren();
        node.primaryActions.replaceChildren();
        for (const action of item.actions ?? []) {
          const link = element('a', '', action.label);
          link.href = action.href;
          const primary = ['#lesson', '#room'].includes(action.href);
          if (primary) {
            link.dataset.primary = 'true';
            link.addEventListener('click', event => {
              const existing = document.querySelector(`[data-lesson-room-panel] a[href="${action.href}"]`);
              if (existing) { event.preventDefault(); existing.click(); }
            });
          }
          (primary ? node.primaryActions : node.actions).append(link);
        }
        node.actionKey = actionKey;
      }
      node.toggle.hidden = !lesson && !item.detailCount;
      node.controls.hidden = node.toggle.hidden && !item.actions?.length;
      const detailCountLabel = school && count > 0 ? '' : ` · ${item.detailCount}`;
      const detailLabel = lesson ? 'Ученики' : item.detailLabel || 'Подробнее';
      text(node.toggleText, item.detailCount ? detailLabel + detailCountLabel : 'Подробности');
      node.checkCount.hidden = !lesson || !item.attentionCount;
      text(node.checkCount, lesson && item.attentionCount ? `Проверить: ${item.attentionCount}` : '');
      const changedDetails = node.detailRevision !== item.detailRevision;
      node.detailRevision = item.detailRevision;
      if (!node.body.hidden && (changedDetails || item.remoteDetails)) loadDetails(item.key, true, true);
      node.article.hidden = !expanded && index >= 3 && !node.article.contains(document.activeElement);
      if (!focused || !node.article.isConnected) list.append(node.article);
    });
    const more = $('[data-important-more]');
    more.hidden = data.items.length <= 3;
    text(more, expanded ? 'Свернуть' : `Показать ещё ${Math.max(0, data.items.length - 3)}`);
    more.setAttribute('aria-expanded', String(expanded));
    const emptyMessage = issues.length ? 'Нет доступных сведений' : context === 'school' ? 'Нет событий, требующих внимания' : 'Сейчас нет важных событий';
    const footer = $('[data-important-day]');
    text(footer, data.daySummary || (!data.items.length ? emptyMessage : ''));
    footer.hidden = !footer.textContent;
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
    const state = { metadata, tools, filters, all, attention, search, message, students, more, rows: new Map(), filter: 'all', q: '', nextOffset: null, request: 0 };
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
      state.tools.hidden = Boolean(item?.remoteDetails) || !item?.detailCount;
      state.filters.hidden = !item?.attentionCount && state.filter === 'all';
      state.all.setAttribute('aria-pressed', String(state.filter === 'all'));
      state.attention.setAttribute('aria-pressed', String(state.filter === 'attention'));
      text(state.metadata, payload.metadata.join(' · '));
      text(state.message, payload.total ? `Показано ${state.rows.size} из ${payload.total}`
        : item?.detailCount ? 'По выбранным условиям ничего не найдено' : 'Список участников не указан');
    } catch (error) { if (error.name !== 'AbortError' && request === state.request) text(state.message, 'Не удалось обновить сведения. Сверните и откройте список для повтора.'); }
    finally { clearTimeout(timeout); if (request === state.request) state.more.disabled = false; }
  }

  function clearPrivateData() {
    generation++; controller?.abort(); controller = null; clearTimeout(pollTimer);
    for (const state of details.values()) state.controller?.abort();
    list.replaceChildren(); nodes.clear(); details.clear(); data = null; etag = ''; panel.hidden = true;
    $('[data-important-clock]').hidden = true;
    $('[data-important-more]').hidden = true;
    $('[data-important-day]').hidden = true;
    $('[data-important-update]').hidden = true;
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
      status.dataset.state = 'warning';
      text(status, 'Не удалось обновить сводку. Повторим после восстановления связи.');
    } finally {
      clearTimeout(timeout); if (controller === requestController) controller = null;
      if (scope === generation) schedule(failures ? Math.min(60_000, 30_000 * failures) : 15_000);
    }
  }
  function changeScope() {
    clearPrivateData(); expanded = false; boundary = ''; noticeUntil = 0;
    panel.hidden = false; status.dataset.state = 'loading'; text(status, 'Загружаем вашу сводку…');
    for (const button of panel.querySelectorAll('[data-context]')) button.setAttribute('aria-pressed', String(button.dataset.context === context));
    if (context === 'school') $('[data-important-family]').hidden = true;
    // Let the cancelled request release its controller before starting the new scope.
    schedule(0);
  }
  for (const button of panel.querySelectorAll('[data-context]')) button.addEventListener('click', () => {
    if (context === button.dataset.context) return;
    context = button.dataset.context;
    changeScope();
  });
  $('[data-important-child]').addEventListener('change', event => { childId = event.target.value; changeScope(); });
  $('[data-important-more]').addEventListener('click', () => { expanded = !expanded; render(); });
  $('[data-important-refresh]').addEventListener('click', () => {
    if (controller) return;
    etag = '';
    status.dataset.state = 'loading';
    text(status, 'Обновляем…');
    schedule(0);
  });
  document.addEventListener('visibilitychange', () => document.hidden ? clearTimeout(pollTimer) : schedule(0));
  window.addEventListener('focus', () => schedule(0)); window.addEventListener('online', () => schedule(0));
  window.addEventListener('pagehide', clearPrivateData);
  window.addEventListener('pageshow', event => { if (event.persisted) schedule(0); });
  panel.hidden = false;
  setInterval(tick, 1000);
  refresh();
}
