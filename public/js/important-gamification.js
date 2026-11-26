const endpoint = '/api/important/gamification';
const journal = 'https://points.platoniks.ru/';
const plural = new Intl.PluralRules('ru');
const dateFormatter = new Intl.DateTimeFormat('ru', { day:'numeric', month:'short', timeZone:'Europe/Moscow' });
const scoreValues = [1, 2, 3, 4, 5];
const cellKey = task => [task.scopeId, task.studentId, task.criterionId].join(':');
const taskKey = task => cellKey(task) + ':' + task.periodId;
const availableGradeControl = 'button:not([aria-disabled="true"]), a';

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

function contextLabel(task) {
  const week = dateLabel(task.week);
  const due = dateLabel(task.dueOn);
  return [task.subject, task.group, week && `Неделя с ${week}`, due && `Срок ${due}`].filter(Boolean).join(' · ');
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
  const confirmed = new Map();
  const taskOrder = new Map();
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
    const row = element('div', 'important-grade');
    row.dataset.task = key;
    const label = element('div', 'important-grade-label');
    label.append(element('strong', '', task.criterion));
    row.append(label);
    if (task.reason) {
      row.dataset.state = 'journal';
      const link = element('a', 'important-grade-link', task.reason === 'draft' ? 'Черновик в журнале' : `Шкала ${task.min}–${task.max} в журнале`);
      link.href = journal;
      row.append(link);
      return row;
    }

    row.dataset.gradeCell = cellKey(task);
    if (task.draft != null) row.dataset.draft = task.draft;
    label.append(element('p', 'important-grade-feedback'));
    const actions = element('div', 'important-grade-actions');
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
      if (task.draft === score) button.dataset.draft = 'true';
      button.addEventListener('click', () => save(key, score));
      keys.append(button);
    }
    const status = element('p', 'important-grade-saved', 'Сохранено');
    status.prepend(element('strong'));
    actions.append(keys, status);
    row.append(actions);
    updateGradeRow(row);
    return row;
  }

  function updateGradeRow(row) {
    const key = row.dataset.task;
    const operation = operations.get(row.dataset.gradeCell);
    const ownOperation = operation?.key === key;
    const saved = confirmed.get(key);
    row.dataset.state = saved ? 'confirmed' : ownOperation ? (operation.saving ? 'saving' : 'retry') : '';

    const keys = row.querySelector('.important-grade-keys');
    keys.inert = Boolean(saved);
    for (const button of keys.children) {
      const selected = ownOperation && Number(button.dataset.score) === operation.score;
      button.setAttribute('aria-disabled', String(button.disabled || !!saved || !!operation && (operation.saving || !selected)));
      if (selected) button.dataset.gradeState = row.dataset.state;
      else delete button.dataset.gradeState;
    }

    const status = row.querySelector('.important-grade-saved');
    status.hidden = !saved;
    if (saved) status.firstElementChild.textContent = saved.score;
    const feedback = row.querySelector('.important-grade-feedback');
    if (saved) feedback.textContent = '';
    else if (ownOperation) feedback.textContent = operation.saving ? 'Сохраняем…' : `Повторите балл ${operation.score}`;
    else feedback.textContent = row.dataset.draft ? `Черновик: ${row.dataset.draft}` : '';
  }

  function updateVisibleCell(key) {
    for (const row of list.querySelectorAll(`[data-grade-cell="${key}"]`)) updateGradeRow(row);
  }

  function studentRow({ pending, saved }) {
    const student = pending[0];
    const group = element('section', 'important-grade-student');
    const identity = element('div', 'important-grade-identity');
    identity.append(element('h4', '', student.name));
    const details = element('div', 'important-grade-student-meta');
    if (student.class) details.append(element('span', '', student.class));
    details.append(element('span', 'important-grade-remaining', `Осталось ${pending.length}`));
    identity.append(details);

    const criteria = element('div', 'important-grade-contexts');
    const contexts = new Map();
    for (const task of [...pending, ...saved].sort((a, b) => taskOrder.get(taskKey(a)) - taskOrder.get(taskKey(b)))) {
      const key = [task.scopeId, task.periodId, task.dueOn].join(':');
      if (!contexts.has(key)) contexts.set(key, []);
      contexts.get(key).push(task);
    }
    for (const rows of contexts.values()) {
      const context = element('div', 'important-grade-context');
      const label = contextLabel(rows[0]);
      if (label) context.append(element('p', 'important-grade-meta important-grade-context-label', label));
      const grid = element('div', 'important-grade-grid');
      grid.append(...rows.map(gradeRow));
      context.append(grid);
      criteria.append(context);
    }
    group.append(identity, criteria);
    return group;
  }

  function render() {
    if (!tasks) return;
    const focused = list.contains(document.activeElement) ? document.activeElement : null;
    const previousOrder = [...list.querySelectorAll('[data-task]')].map(row => row.dataset.task);
    const focusedId = focused?.closest('[data-task]')?.dataset.task;
    const focusedScore = focused?.dataset.score;
    const groups = new Map();
    for (const task of tasks) {
      const key = taskKey(task);
      if (!taskOrder.has(key)) taskOrder.set(key, taskOrder.size);
      const rank = taskOrder.get(key);
      if (!groups.has(task.studentId)) groups.set(task.studentId, { pending:[], saved:[], rank });
      const group = groups.get(task.studentId);
      group.pending.push(task);
      group.rank = Math.min(group.rank, rank);
    }
    for (const { task } of confirmed.values()) {
      const group = groups.get(task.studentId);
      if (group) {
        group.saved.push(task);
        group.rank = Math.min(group.rank, taskOrder.get(taskKey(task)));
      } else {
        confirmed.delete(taskKey(task));
      }
    }
    searchBox.hidden = groups.size < 8 && !search.value;
    const query = search.value.trim().toLocaleLowerCase('ru');
    const matches = [...groups.values()].filter(({pending:[student]}) => !query ||
      (student.name + ' ' + (student.class || '')).toLocaleLowerCase('ru').includes(query))
      .sort((a, b) => a.rank - b.rank);
    list.replaceChildren(...matches.slice(0,limit).map(studentRow));
    if (!matches.length && query) list.append(element('p', 'important-grade-meta', 'По этому запросу учеников нет'));
    more.hidden = matches.length <= limit;
    more.textContent = `Ещё ученики · ${Math.max(0, matches.length - limit)}`;
    if (focused) {
      const next = [...list.querySelectorAll('[data-task]')];
      const current = next.findIndex(row => row.dataset.task === focusedId);
      const start = current < 0 ? Math.max(0, previousOrder.indexOf(focusedId)) : current;
      const ordered = [...next.slice(start), ...next.slice(0,start).reverse()];
      const target = ordered.map(row => row.querySelector(
        row.dataset.task === focusedId && focusedScore
          ? `button[data-score="${focusedScore}"]:not(:disabled)`
          : availableGradeControl
      )).find(Boolean) ?? summary;
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
      for (const key of confirmed.keys()) if (incoming.has(key)) confirmed.delete(key);
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

  async function save(row, score) {
    const task = tasks?.find(item => taskKey(item) === row);
    if (!task) return;
    const key = cellKey(task);
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
    updateVisibleCell(key);
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
          updateVisibleCell(key);
          notice.textContent = 'Оценка изменилась или стала недоступна. Обновляем список.';
          await load();
          refreshSummary();
          return;
        }
        throw Error();
      }
      if (!Number.isSafeInteger(content.version)) throw Error();
      operations.delete(key);
      confirmed.set(row, { task, score });
      tasks = tasks.filter(item => taskKey(item) !== row).map(item =>
        cellKey(item) === key ? { ...item, version:content.version } : item);
      const pending = tasks.filter(item => item.studentId === task.studentId).length;
      const tile = list.querySelector(`[data-task="${row}"]`);
      notice.textContent = pending ? `Оценка ${score} сохранена. Осталось ${tasks.length}.` : `${task.name}. Все оценки выставлены.`;
      if (pending) {
        const student = tile?.closest('.important-grade-student');
        const focused = tile?.contains(document.activeElement);
        if (student) student.querySelector('.important-grade-remaining').textContent = `Осталось ${pending}`;
        updateVisibleCell(key);
        if (focused) {
          const tiles = [...student.querySelectorAll('[data-task]')];
          const index = tiles.indexOf(tile);
          const next = [...tiles.slice(index + 1), ...tiles.slice(0,index)].map(item => item.querySelector(availableGradeControl)).find(Boolean);
          (next ?? summary).focus({ preventScroll:true });
        }
      } else {
        render();
      }
      setCount(tasks.length);
      await load();
      refreshSummary();
    } catch {
      if (scope !== generation) return;
      operation.saving = false;
      notice.textContent = 'Подтверждение не получено. Можно повторить отправку тем же баллом.';
      updateVisibleCell(key);
    }
  }

  function reset() {
    generation++;
    active = false;
    request?.abort();
    request = undefined;
    operations.clear();
    confirmed.clear();
    taskOrder.clear();
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
