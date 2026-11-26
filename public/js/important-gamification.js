const endpoint = '/api/important/gamification';
const journal = 'https://points.platoniks.ru/';
const plural = new Intl.PluralRules('ru');
const dateFormatter = new Intl.DateTimeFormat('ru', { day:'numeric', month:'short', timeZone:'Europe/Moscow' });
const scoreValues = [1, 2, 3, 4, 5];
const cellKey = task => [task.scopeId, task.studentId, task.criterionId].join(':');
const taskKey = task => cellKey(task) + ':' + task.periodId;

function element(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value) node.textContent = value;
  return node;
}

function dateLabel(date) {
  const time = Date.parse(date + 'T12:00:00Z');
  return Number.isFinite(time) ? dateFormatter.format(time) : '';
}

export function mountGamification(panel, refreshSummary) {
  const card = panel.querySelector('[data-important-gamification]');
  if (!card) return { update() {}, reset() {} };
  const summary = card.querySelector('summary');
  const count = card.querySelector('[data-gamification-count]');
  const list = card.querySelector('[data-gamification-list]');
  const search = card.querySelector('input');
  const searchBox = search.closest('label');
  const more = card.querySelector('[data-gamification-more]');
  const message = card.querySelector('[data-gamification-message]');
  const retryList = card.querySelector('[data-gamification-retry]');
  const notice = panel.querySelector('[data-gamification-notice]');
  const fallbackFocus = panel.querySelector('[data-important-refresh]');
  const operations = new Map();
  let tasks = null, limit = 8, active = false, request, generation = 0;

  function setCount(value) {
    const focused = card.contains(document.activeElement);
    const word = { one:'оценку', few:'оценки', many:'оценок' }[plural.select(value)];
    count.textContent = value ? `Выставить ${value} ${word}` : '';
    card.hidden = !value;
    if (card.hidden) {
      card.open = false;
      if (focused) fallbackFocus?.focus({ preventScroll:true });
    }
  }

  function canLoad() {
    return active && card.open && !request && ![...operations.values()].some(op => op.saving);
  }

  function gradeRow(task) {
    const key = taskKey(task);
    const operation = operations.get(cellKey(task));
    const ownOperation = operation?.key === key;
    const row = element('div', 'important-grade');
    row.dataset.task = key;
    const label = element('div');
    const title = element('strong', '', task.criterion);
    label.append(title);
    const week = dateLabel(task.week);
    const due = dateLabel(task.dueOn);
    const meta = [task.subject, task.group, week && `Неделя с ${week}`, due && `Срок ${due}`].filter(Boolean).join(' · ');
    if (meta) label.append(element('p', 'important-grade-meta', meta));
    row.append(label);
    if (task.reason) {
      const link = element('a', 'important-grade-link', task.reason === 'draft' ? 'Черновик в журнале' : `Шкала ${task.min}–${task.max} в журнале`);
      link.href = journal;
      row.append(link);
      return row;
    }

    const keys = element('div', 'important-grade-keys');
    keys.setAttribute('role', 'group');
    keys.setAttribute('aria-label', `${task.criterion} · ${task.name}`);
    for (const score of scoreValues) {
      const button = element('button', '', String(score));
      const meaning = task.anchors?.[score - task.min];
      const outOfRange = score < task.min || score > task.max;
      button.type = 'button';
      button.dataset.score = score;
      button.setAttribute('aria-label', [`Выставить ${score}`, task.criterion, meaning].filter(Boolean).join(' · '));
      if (meaning) button.title = meaning;
      button.disabled = outOfRange;
      button.setAttribute('aria-disabled', String(outOfRange || !!operation && (operation.saving || !ownOperation || operation.score !== score)));
      if (task.draft === score) button.dataset.draft = 'true';
      if (ownOperation && operation.score === score) button.dataset.saving = String(operation.saving);
      button.addEventListener('click', () => save(task, score));
      keys.append(button);
    }
    row.append(keys);
    if (ownOperation) {
      const status = operation.saving ? 'Сохраняем…' : `Нажмите ${operation.score} ещё раз, чтобы повторить`;
      row.append(element('p', 'important-grade-feedback', status));
    } else if (task.draft != null) {
      label.append(element('p', 'important-grade-meta', `Черновик: ${task.draft}`));
    }
    return row;
  }

  function render() {
    if (!tasks) return;
    const focused = list.contains(document.activeElement) ? document.activeElement : null;
    const previousOrder = [...list.querySelectorAll('[data-task]')].map(row => row.dataset.task);
    const focusedId = focused?.closest('[data-task]')?.dataset.task;
    const focusedScore = focused?.dataset.score;
    const groups = new Map();
    for (const task of tasks) {
      if (!groups.has(task.studentId)) groups.set(task.studentId, []);
      groups.get(task.studentId).push(task);
    }
    searchBox.hidden = groups.size < 8 && !search.value;
    const query = search.value.trim().toLocaleLowerCase('ru');
    const matches = [...groups.values()].filter(rows => !query ||
      (rows[0].name + ' ' + (rows[0].class || '')).toLocaleLowerCase('ru').includes(query));
    list.replaceChildren(...matches.slice(0,limit).map(rows => {
      const group = element('section', 'important-grade-student');
      const heading = element('h4', '', rows[0].name + (rows[0].class ? ' · ' + rows[0].class : ''));
      group.append(heading, ...rows.map(gradeRow));
      return group;
    }));
    if (!matches.length && query) list.append(element('p', 'important-grade-meta', 'По этому запросу учеников нет'));
    more.hidden = matches.length <= limit;
    more.textContent = `Ещё ученики · ${Math.max(0, matches.length - limit)}`;
    if (focused) {
      const next = [...list.querySelectorAll('[data-task]')];
      const row = next.find(item => item.dataset.task === focusedId) ?? next[Math.max(0, previousOrder.indexOf(focusedId))];
      const target = row?.querySelector(focusedScore ? `button[data-score="${focusedScore}"]:not(:disabled)` : 'a') ?? summary;
      target.focus({ preventScroll:true });
    }
  }

  async function load() {
    if (!canLoad()) return;
    const scope = generation;
    const controller = new AbortController();
    request = controller;
    const timeout = setTimeout(() => controller.abort(), 8_000);
    retryList.hidden = true;
    if (!tasks) message.textContent = 'Загружаем оценки…';
    try {
      const response = await fetch(endpoint, { credentials:'same-origin', signal:controller.signal, cache:'no-store' });
      if (scope !== generation || request !== controller) return;
      if ([401,403,404].includes(response.status)) { reset(); return; }
      if (!response.ok) throw Error();
      const result = await response.json();
      if (scope !== generation || request !== controller) return;
      if (!Array.isArray(result.tasks)) throw Error();
      const incoming = new Set(result.tasks.map(taskKey));
      for (const [key, op] of operations) if (!incoming.has(op.key)) operations.delete(key);
      const changed = JSON.stringify(tasks) !== JSON.stringify(result.tasks);
      tasks = result.tasks;
      message.textContent = '';
      setCount(result.count);
      if (changed) render();
    } catch {
      if (scope !== generation || request !== controller) return;
      message.textContent = 'Не удалось обновить список';
      retryList.hidden = false;
    } finally {
      clearTimeout(timeout);
      if (request === controller) request = undefined;
    }
  }

  async function save(task, score) {
    const key = cellKey(task), row = taskKey(task);
    let operation = operations.get(key);
    if (task.reason || score < task.min || score > task.max ||
        operation && (operation.saving || operation.key !== row || operation.score !== score)) return;
    const scope = generation;
    if (!operation) {
      operation = { key:row, score, id:crypto.randomUUID(), task };
      operations.set(key, operation);
    }
    request?.abort();
    request = undefined;
    operation.saving = true;
    message.textContent = '';
    render();
    try {
      const response = await fetch(endpoint, { method:'POST', credentials:'same-origin', signal:AbortSignal.timeout(11_000),
        headers:{ 'Content-Type':'application/json', 'Idempotency-Key':operation.id },
        body:JSON.stringify({ scopeId:task.scopeId, studentId:task.studentId, criterionId:task.criterionId,
          periodId:task.periodId, version:operation.task.version, score }) });
      const content = await response.json();
      if (scope !== generation) return;
      if (!response.ok) {
        if ([401,404].includes(response.status)) {
          reset();
          refreshSummary();
          return;
        }
        if ([403,409,422].includes(response.status)) {
          operations.delete(key);
          render();
          notice.textContent = 'Оценка изменилась или стала недоступна. Обновляем список.';
          await load();
          refreshSummary();
          return;
        }
        throw Error();
      }
      if (!Number.isSafeInteger(content.version)) throw Error();
      operations.delete(key);
      tasks = tasks.filter(item => taskKey(item) !== row).map(item =>
        cellKey(item) === key ? { ...item, version:content.version } : item);
      notice.textContent = `Оценка ${score} сохранена. Осталось ${tasks.length}.`;
      render();
      setCount(tasks.length);
      await load();
      refreshSummary();
    } catch {
      if (scope !== generation) return;
      operation.saving = false;
      notice.textContent = 'Подтверждение не получено. Можно повторить отправку тем же баллом.';
      render();
    }
  }

  function reset() {
    generation++;
    active = false;
    request?.abort();
    request = undefined;
    operations.clear();
    tasks = null;
    search.value = '';
    limit = 8;
    list.replaceChildren();
    notice.textContent = '';
    message.textContent = '';
    setCount(0);
  }

  card.addEventListener('toggle', () => { if (card.open) load(); });
  search.addEventListener('input', () => { limit = 8; render(); });
  more.addEventListener('click', () => { limit += 8; render(); });
  retryList.addEventListener('click', load);

  return {
    reset,
    update(value) {
      if (value === undefined) return;
      if (value === null) { reset(); return; }
      active = true;
      if (!card.open || tasks === null) setCount(value);
      if (card.open) load();
    },
  };
}
