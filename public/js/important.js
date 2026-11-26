const panel = document.querySelector('[data-important]');

if (panel) {
  const $ = selector => panel.querySelector(selector);
  const list = $('[data-important-items]');
  const status = $('[data-important-sources]');
  const refreshButton = $('[data-important-refresh]');
  const motion = matchMedia('(prefers-reduced-motion: no-preference)');
  const nodes = new Map();
  const details = new Map();
  const clockFormat = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' });
  const dateFormat = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow' });
  const approvalDateFormat = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
  const schoolCategories = {
    attendance: 'Посещаемость',
    schedule_conflict: 'Расписание',
    publication: 'Расписание',
    reports: 'Обращения',
    flex: 'Flex',
    calendar: 'Календарь',
  };
  const portalControlsFamily = panel.hasAttribute('data-portal-family');
  let data = null, etag = '', context = 'personal', childId = panel.dataset.portalChild || '', generation = 0, controller, pollTimer;
  let baseTime = Date.now(), basePerformance = performance.now(), lastSuccess = 0, failures = 0, expanded = false;
  let noticeUntil = 0, boundary = '', networkFailed = false;
  let itemSequence = 0, tickTimer;
  const currentTime = () => baseTime + performance.now() - basePerformance;
  const text = (node, value) => { const next = String(value ?? ''); if (node.textContent !== next) node.textContent = next; };
  const element = (tag, className, value) => { const node = document.createElement(tag); if (className) node.className = className; if (value != null) text(node, value); return node; };
  const when = value => value ? Date.parse(value) : NaN;
  const formatTime = value => Number.isFinite(when(value)) ? clockFormat.format(new Date(value)) : '';
  const remaining = duration => duration < 60_000 ? 'меньше минуты' : formatCountdown(duration);
  const setClock = value => { const parsed = Date.parse(value); if (Number.isFinite(parsed)) { baseTime = parsed; basePerformance = performance.now(); } };
  const query = extra => new URLSearchParams({ context, ...(childId && context === 'personal' ? { childId } : {}), ...extra });
  const workday = $('[data-important-workday]');
  const bookpcSlots = [$('[data-important-rentals]'), $('[data-important-laptop-locations]')].filter(Boolean);
  const orderSlot = $('[data-important-orders]');
  const approvals = $('[data-important-approvals]');
  const approvalList = $('[data-important-approval-list]');
  const pendingReports = $('[data-important-pending-reports]');
  const isPendingReport = item => ['progress_report_pending_fill', 'feedback_pending_fill'].includes(item.kind);
  const reportCountFormat = new Intl.NumberFormat('ru-RU');

  function renderPendingReports(items) {
    const signature = JSON.stringify(items.map(({ key, title, cardCount, actions }) => [key, title, cardCount, actions]));
    if (pendingReports.dataset.items === signature) return;
    const focused = pendingReports.contains(document.activeElement) ? document.activeElement.href : '';
    pendingReports.dataset.items = signature;
    pendingReports.hidden = !items.length;
    let nextFocus;
    pendingReports.replaceChildren(...items.map(item => {
      const row = element('li');
      const content = element('div');
      content.append(element('strong', '', item.title), element('span', '', `Не заполнено: ${reportCountFormat.format(item.cardCount)}`));
      const action = item.actions[0];
      const link = element('a', '', action.label);
      link.href = action.href;
      link.setAttribute('aria-label', `${action.label} · ${item.title}`);
      if (focused === link.href) nextFocus = link;
      row.append(content, link);
      return row;
    }));
    if (focused) (nextFocus || refreshButton).focus({ preventScroll: true });
  }

  function renderApprovals(items) {
    const signature = JSON.stringify(items.map(({ key, title, subtitle, start, actions }) => [key, title, subtitle, start, actions]));
    if (approvals.dataset.items === signature) return;
    const focused = approvals.contains(document.activeElement) ? document.activeElement : null;
    const focusedKey = focused?.closest('li')?.dataset.key;
    approvals.hidden = !items.length;
    if (!items.length) approvals.open = false;
    approvals.dataset.items = signature;
    text($('[data-important-approval-count]'), items.length);

    let nextFocus;
    approvalList.replaceChildren(...items.map(item => {
      const row = element('li', 'important-approval-row');
      row.dataset.key = item.key;
      const content = element('div', 'important-approval-content');
      content.append(element('p', 'important-approval-title', item.subtitle || item.title));
      if (Number.isFinite(when(item.start))) {
        const time = element('time', '', approvalDateFormat.format(new Date(item.start)));
        time.dateTime = item.start;
        content.append(time);
      }
      const actions = element('div', 'important-approval-actions');
      for (const action of item.actions ?? []) {
        const link = element('a', '', action.label);
        link.href = action.href;
        actions.append(link);
        if (item.key === focusedKey && link.href === focused.href) nextFocus = link;
      }
      row.append(content);
      if (actions.childElementCount) row.append(actions);
      return row;
    }));
    if (focused) (nextFocus || (items.length ? approvals.querySelector('summary') : refreshButton)).focus({ preventScroll: true });
  }

  function renderOrders(orders) {
    if (!orderSlot) return;
    const items = orders?.items ?? [];
    orderSlot.hidden = !items.length;
    const signature = JSON.stringify(items);
    if (orderSlot.dataset.items === signature) return;
    orderSlot.dataset.items = signature;
    const row = item => {
      const elementRow = element('li', 'important-order');
      const name = element('span', 'important-order-name', item.title);
      if (item.quantity) name.append(element('small', '', `× ${item.quantity}`));
      const label = element('span', 'important-order-status', item.status);
      label.dataset.stage = item.stage;
      elementRow.append(name, label);
      return elementRow;
    };
    $('[data-important-orders-list]').replaceChildren(...items.slice(0, 3).map(row));
    const moreOrders = $('[data-important-orders-more]');
    moreOrders.hidden = items.length <= 3;
    if (moreOrders.hidden) moreOrders.open = false;
    text(moreOrders.querySelector('summary'), `Показать ещё ${Math.max(0, items.length - 3)}`);
    moreOrders.querySelector('ul').replaceChildren(...items.slice(3).map(row));
  }

  function updatePanelVisibility() {
    const bookpcVisible = context === 'personal' && bookpcSlots.some(slot => !slot.hidden);
    panel.hidden = !data?.visible && !bookpcVisible;
  }

  function formatCountdown(duration) {
    if (duration < 60_000) return `${Math.ceil(duration / 1000)} сек`;
    const minutes = Math.ceil(duration / 60_000);
    const hours = Math.floor(minutes / 60);
    return [hours ? `${hours} ч` : '', minutes % 60 ? `${minutes % 60} мин` : ''].filter(Boolean).join(' ');
  }

  function firstLessonDetails(lesson) {
    const rooms = lesson.rooms.map(room => /^каб(?:инет)?[.\s]/iu.test(room) ? room : `каб. ${room}`);
    const location = lesson.format === 'online' ? 'онлайн' : rooms.join(', ');
    return [lesson.subject, lesson.studentName || lesson.classes.join(', '),
      lesson.studentName ? 'индив.' : '', location].filter(Boolean).join(' · ');
  }

  function lessonCountLabel(count) {
    const last = count % 10;
    const teen = count % 100 >= 11 && count % 100 <= 14;
    return `${count} ${teen || last === 0 || last >= 5 ? 'уроков' : last === 1 ? 'урок' : 'урока'}`;
  }

  function renderWorkdayLessons(group, lessons) {
    const rows = element('ol', 'important-workday-lessons');
    for (const lesson of lessons) {
      const row = element('li');
      const link = element(lesson.href ? 'a' : 'span', 'important-workday-lesson');
      if (lesson.href) link.href = lesson.href;
      const range = [formatTime(lesson.start),formatTime(lesson.end)].filter(Boolean).join('–');
      const rooms = lesson.rooms.map(room => /^каб(?:инет)?[.\s]/iu.test(room) ? room : `каб. ${room}`);
      const room = lesson.format === 'online' ? 'Онлайн' : rooms.join(', ') || 'Кабинет не указан';
      const individual = lesson.individual || lesson.studentName;
      const audience = individual ? `Индив. · ${lesson.studentName || 'Состав уточняется'}`
        : lesson.classes.join(', ') || 'Класс уточняется';
      link.append(element('span','important-workday-lesson-time',range),
        element('span','important-workday-lesson-subject',lesson.subject || 'Занятие'),
        element('span','important-workday-lesson-audience',audience),
        element('span','important-workday-lesson-room',room));
      row.append(link);
      rows.append(row);
    }
    group.append(rows);
  }

  function renderWorkday(now) {
    if (!workday) return;
    const [today, tomorrow] = data.workday ?? [];
    const hasData = context === 'personal' && [today, tomorrow].some(day => day?.entries.length || day?.pending.length);
    workday.hidden = !hasData;
    if (!hasData) return;
    const title = $('[data-important-workday-title]');
    const caption = $('[data-important-workday-time]');
    const day = dateFormat.format(new Date(now));
    if (networkFailed || today?.date !== day) {
      text(title, 'Обновляем рабочий график');
      text(caption, '');
    } else {
      const first = today.entries[0];
      const current = today.entries.find(entry => when(entry.start) <= now && when(entry.end) > now);
      const upcoming = today.entries.filter(entry => when(entry.start) > now);
      const next = upcoming[0];
      const following = tomorrow?.entries[0];
      const teaching = tomorrow?.entries.find(entry => entry.kind === 'lesson');
      const firstLessons = teaching?.firstLessons ?? [];
      const lesson = firstLessons[0];
      const details = lesson ? firstLessonDetails(lesson) : '';
      const count = Number.isSafeInteger(teaching?.lessonCount) ? lessonCountLabel(teaching.lessonCount) : '';
      const simultaneous = !count && firstLessons.length > 1 ? `ещё ${firstLessons.length - 1} в это время` : '';
      const lessonSummary = [details, count || simultaneous].filter(Boolean).join(' · ');
      const previewTomorrow = lesson ? [`Завтра ${formatTime(lesson.start)}`, lessonSummary].filter(Boolean).join(' · ') : '';
      if (first && now < when(first.start)) {
        text(title, `${first.kind === 'shift' ? 'До начала рабочего дня' : 'До первого урока'} ${formatCountdown(when(first.start) - now)}`);
        text(caption, [`Начало в ${formatTime(first.start)}`, previewTomorrow].filter(Boolean).join(' · '));
      } else if (current) {
        text(title, current.kind === 'shift' ? 'Ваша смена' : 'Ваши занятия сегодня');
        text(caption, [`${formatTime(current.start)}–${formatTime(current.end)}`, previewTomorrow].filter(Boolean).join(' · '));
      } else if (next) {
        text(title, next.kind === 'shift' ? 'Ваша смена сегодня' : 'Ваши занятия сегодня');
        text(caption, [`С ${formatTime(next.start)}`, previewTomorrow].filter(Boolean).join(' · '));
      } else if (following) {
        const earlierActivity = following.kind === 'lesson' && lesson && when(following.start) < when(lesson.start);
        const label = following.kind === 'shift' ? 'вам на работу к' : earlierActivity ? 'занятия с' : 'первый урок в';
        text(title, `Завтра ${label} ${formatTime(following.start)}`);
        const lessonTime = lesson && (earlierActivity || following.kind === 'shift') ? `Первый урок в ${formatTime(lesson.start)}` : '';
        text(caption, [lessonTime, lessonSummary].filter(Boolean).join(' · '));
      } else {
        const pending = [today, tomorrow].flatMap(item => item?.pending ?? []);
        text(title, pending.some(item => item.status === 'unpublished') ? 'Рабочий график ещё не опубликован'
          : pending.some(item => item.status === 'unavailable') ? 'Рабочий график временно недоступен'
            : 'Предстоящих смен и уроков в графике нет');
        text(caption, '');
      }
    }
    const preview = $('[data-important-workday-details]');
    const signature = JSON.stringify([today, tomorrow, networkFailed, day]);
    if (preview.dataset.value === signature) return;
    preview.dataset.value = signature;
    preview.replaceChildren();
    if (networkFailed || today?.date !== day) return;
    for (const [index, previewDay] of [today, tomorrow].entries()) {
      if (!previewDay?.entries.length && !previewDay?.pending.length) continue;
      const group = element('div', 'important-workday-day');
      const count = previewDay.entries.find(entry=>entry.kind==='lesson')?.lessonCount;
      const header = [index ? 'Завтра' : 'Сегодня',Number.isSafeInteger(count) ? lessonCountLabel(count) : ''].filter(Boolean).join(' · ');
      group.append(element('strong', '', header));
      for (const entry of previewDay.entries) {
        const lessons = entry.lessons ?? entry.firstLessons ?? [];
        if (lessons.length) {
          if (when(entry.start) < when(lessons[0].start)) {
            const dayLink = element(entry.href ? 'a' : 'span', '', `Занятия с ${formatTime(entry.start)}`);
            if (entry.href) dayLink.href = entry.href;
            group.append(dayLink);
          }
          renderWorkdayLessons(group, lessons);
          continue;
        }
        const label = entry.kind === 'shift' ? `Смена ${formatTime(entry.start)}–${formatTime(entry.end)}`
          : `Первый урок в ${formatTime(entry.start)}`;
        const link = element(entry.href ? 'a' : 'span', '', label);
        if (entry.href) link.href = entry.href;
        group.append(link);
      }
      for (const item of previewDay.pending) {
        const label = item.status === 'unpublished' ? 'График ещё не опубликован'
          : item.status === 'unavailable' ? 'График временно недоступен'
            : item.kind === 'shift' ? 'Смена не назначена' : 'Уроков по расписанию нет';
        group.append(element('span', '', label));
      }
      preview.append(group);
    }
  }

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
    if (!Number.isFinite(start) || !(end > start)) {
      node.article.dataset.current = 'false';
      node.article.dataset.imminent = 'false';
      node.timing.hidden = node.timeBox.hidden = node.timeline.hidden = true;
      return false;
    }
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
    const startTime = formatTime(item.start);
    const endTime = formatTime(item.end);
    const active = current || upcoming;
    const showClock = node.timeMode.getAttribute('aria-pressed') === 'true';
    const duration = (upcoming ? start : end) - now;
    text(node.timeValue, active && !showClock ? formatCountdown(duration) : upcoming ? startTime : endTime);
    text(node.timeCaption, current ? (showClock ? 'конец' : 'до конца')
      : upcoming ? (showClock ? 'начало' : 'до начала') : 'завершилось');
    node.timeMode.hidden = !active;
    node.timeline.hidden = !active;
    if (active) {
      text(node.timelineStart, `Начало ${startTime}`);
      text(node.timelineEnd, `Конец ${endTime}`);
    }
    const progress = current ? (now - start) / (end - start) : 0;
    const percent = String(Math.floor(100 * progress));
    node.progress.hidden = !current;
    if (node.progress.getAttribute('aria-valuenow') !== percent) node.progress.setAttribute('aria-valuenow', percent);
    node.timelineProgress.hidden = !current;
    if (current) text(node.timelineProgress, `${percent}% пройдено`);
    node.progressFill.style.transform = `scaleX(${progress})`;
    return current;
  }

  function tick() {
    if (!data) return;
    const now = currentTime();
    renderWorkday(now);
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
      renderApprovals([]);
      renderPendingReports([]);
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
    const studentName = element('strong', 'important-student-name'); studentName.hidden = true;
    const subtitleText = element('span');
    subtitle.append(studentName, subtitleText);
    const studentStatus = element('p', 'important-item-subtitle'); studentStatus.hidden = true;
    const notes = element('div', 'important-notes');
    const timeBox = element('div', 'important-timebox');
    const timeValue = element('span', 'important-time-value');
    const timeCaption = element('span', 'important-time-caption');
    const timeMode = element('button', 'important-time-mode', 'По часам');
    timeMode.type = 'button';
    timeMode.title = 'Переключить между временем по расписанию и таймером';
    timeMode.setAttribute('aria-pressed', 'false');
    timeBox.hidden = true;
    timeBox.append(timeValue, timeCaption, timeMode);
    const timeline = element('div', 'important-lesson-timeline');
    timeline.hidden = true;
    const timelineLabels = element('div', 'important-timeline-labels');
    const timelineStart = element('span');
    const timelineProgress = element('strong', 'important-progress-value');
    timelineProgress.hidden = true;
    timelineProgress.setAttribute('aria-hidden', 'true');
    const timelineEnd = element('span');
    timelineLabels.append(timelineStart, timelineProgress, timelineEnd);
    const progress = element('div', 'important-progress');
    progress.hidden = true;
    const progressFill = element('span');
    progress.setAttribute('role', 'progressbar');
    progress.setAttribute('aria-label', 'Ход урока');
    progress.append(progressFill);
    timeline.append(progress, timelineLabels);
    const contacts = element('div', 'important-contacts');
    contacts.hidden = true;
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
    content.append(timing, title, subtitle, studentStatus, notes);
    top.append(content, timeBox, metric);
    controls.append(primaryActions, toggle, actions);
    article.append(top, timeline, contacts, controls, body);
    const node = { article, timing, title, subtitle, subtitleText, studentName, studentStatus, notes, timeBox, timeValue, timeCaption, timeMode,
      timeline, timelineStart, timelineProgress, timelineEnd, progress, progressFill,
      metric, metricValue, metricLabel, controls, primaryActions, actions, toggle, toggleText, checkCount,
      contacts, body, actionKey: '', contactKey: '', detailRevision: '' };
    timeMode.addEventListener('click', () => {
      const item = data?.items.find(item => item.key === key);
      if (!item) return;
      timeMode.setAttribute('aria-pressed', String(timeMode.getAttribute('aria-pressed') !== 'true'));
      updateLessonTime(item, node, currentTime());
      if (motion.matches) {
        timeValue.getAnimations().forEach(animation => animation.cancel());
        timeValue.animate([
          { opacity: .55, transform: 'translateY(3px)' },
          { opacity: 1, transform: 'translateY(0)' },
        ], { duration: 180, easing: 'ease-out' });
      }
    });
    toggle.addEventListener('click', () => {
      body.hidden = !body.hidden; toggle.setAttribute('aria-expanded', String(!body.hidden));
      if (body.hidden) details.get(key)?.controller?.abort();
      else loadDetails(key, true);
    });
    nodes.set(key, node); return node;
  }

  function telegramIcon() {
    const namespace = 'http://www.w3.org/2000/svg';
    const icon = document.createElementNS(namespace, 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('class', 'important-telegram-icon');
    icon.setAttribute('aria-hidden', 'true');
    icon.setAttribute('focusable', 'false');
    const disc = document.createElementNS(namespace, 'circle');
    disc.setAttribute('cx', '12');
    disc.setAttribute('cy', '12');
    disc.setAttribute('r', '12');
    disc.setAttribute('fill', '#1684c6');
    const plane = document.createElementNS(namespace, 'path');
    plane.setAttribute('fill', '#fff');
    plane.setAttribute('d', 'M5.1 11.7 17.5 6.9c.6-.2.9.1.8.8l-2.1 9.1c-.1.6-.5.7-.9.4l-4.4-3.2-2.2 2.1c-.3 0-.4-.2-.4-.4l.4-3.4 6.3-4c.2-.1.1-.3-.1-.2l-7.8 3.7-2.4-.8c-.5-.2-.5-.5.4-.8Z');
    icon.append(disc, plane);
    return icon;
  }

  function renderContacts(node, contacts = {}) {
    const contactKey = JSON.stringify(contacts);
    if (node.contactKey === contactKey) return;
    node.contactKey = contactKey;
    const groups = [];
    for (const [role, singular, plural] of [['mentor', 'Наставник', 'Наставники'], ['tutor', 'Тьютор', 'Тьюторы']]) {
      const people = contacts[role] ?? [];
      if (!people.length) continue;
      const label = people.length === 1 ? singular : plural;
      const group = element('div', 'important-contact-group');
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', label);
      const list = element('ul');
      for (const person of people) {
        const row = element('li');
        if (/^https:\/\/t\.me\/[a-z][a-z0-9_]{3,31}$/i.test(person.href ?? '')) {
          const link = element('a');
          link.href = person.href;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.setAttribute('aria-label', `${person.name} в Telegram`);
          link.append(telegramIcon(), element('span', '', person.name));
          row.append(link);
        } else {
          row.append(element('span', '', person.name));
        }
        if (person.classNames.length) row.append(element('span', 'important-contact-classes', person.classNames.join(', ')));
        list.append(row);
      }
      group.append(element('span', 'important-contact-label', label), list);
      groups.push(group);
    }
    node.contacts.hidden = !groups.length;
    node.contacts.replaceChildren(...groups);
  }

  function render() {
    panel.dataset.contextMode = context;
    renderOrders(context === 'personal' ? data.orders : null);
    renderApprovals(data.visible ? data.items.filter(item => item.kind === 'calendar_approval') : []);
    renderPendingReports(data.visible && context === 'personal' ? data.items.filter(isPendingReport) : []);
    updatePanelVisibility();
    if (!data.visible) {
      status.hidden = true;
      list.hidden = true;
      return;
    }
    status.hidden = false;
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
    $('[data-important-family]').hidden = portalControlsFamily || children.length < 2 || context !== 'personal';
    const issues = Object.values(data.sources).filter(source => source.partial || ['unavailable', 'unconfigured'].includes(source.status));
    status.dataset.state = issues.length ? 'warning' : 'ready';
    text(status, issues.length ? issues.map(source => `${source.label}: ${source.status==='ready' && source.partial ? 'часть сведений временно недоступна' : source.checkedAt ? `последние данные ${formatTime(source.checkedAt)}` : 'временно недоступно'}`).join(' · ')
      : `Обновлено в ${formatTime(data.serverTime)}`);
    const items = data.items.filter(item => item.kind !== 'calendar_approval' && !isPendingReport(item));
    const wanted = new Set(items.map(item => item.key));
    for (const [key, node] of nodes) if (!wanted.has(key)) {
      if (node.article.contains(document.activeElement)) $('[data-important-refresh]').focus({ preventScroll: true });
      details.get(key)?.controller?.abort(); node.article.remove(); nodes.delete(key); details.delete(key);
    }
    const focused = list.contains(document.activeElement);
    panel.dataset.context = context;
    panel.dataset.empty = String(!data.items.length);
    list.dataset.paired = String(context === 'personal' && items.slice(0, 2).filter(item => item.kind === 'lesson').length === 2);
    items.forEach((item, index) => {
      const node = nodes.get(item.key) || createItem(item.key);
      const lesson = item.kind === 'lesson';
      const history = item.kind === 'schedule_change';
      const school = context === 'school';
      const count = item.kind === 'attendance' ? item.detailCount : item.count;
      node.article.dataset.tone = item.tone || 'neutral';
      node.article.dataset.kind = item.kind;
      node.article.dataset.pair = String(index < 2 && lesson);
      text(node.title, item.title);
      let subtitle = item.studentName ? item.studentSubtitle : item.subtitle;
      if (school && item.kind === 'attendance' && item.recordCount != null) subtitle = `Записей: ${item.recordCount}`;
      text(node.studentName, item.studentName);
      node.studentName.hidden = !item.studentName;
      node.studentName.dataset.arrivalMark = item.arrivalMark || '';
      text(node.subtitleText, item.studentName && subtitle ? ` · ${subtitle}` : subtitle);
      node.subtitle.hidden = (!subtitle && !item.studentName) || (school && count > 0 && subtitle === `Записей: ${count}` && item.kind !== 'attendance');
      text(node.studentStatus, item.studentStatus);
      node.studentStatus.hidden = !item.studentStatus;
      renderContacts(node, item.contacts);
      node.metric.hidden = !school || !(count > 0);
      text(node.metricValue, count);
      text(node.metricLabel, item.kind === 'attendance' ? 'Ученики' : 'Записи');
      if (school) {
        text(node.timing, schoolCategories[item.kind] || '');
        node.timing.hidden = !schoolCategories[item.kind];
      }
      const notes = history ? [] : (item.notes ?? []).filter(note => !(lesson && note === `Требуют проверки: ${item.attentionCount}`));
      const notesKey = JSON.stringify(notes);
      if (node.notes.dataset.value !== notesKey) { node.notes.replaceChildren(...notes.map(note => element('p', 'important-note', note))); node.notes.dataset.value = notesKey; }
      const actionKey = JSON.stringify(item.actions ?? []);
      if (actionKey !== node.actionKey) {
        node.actions.replaceChildren();
        node.primaryActions.replaceChildren();
        for (const action of item.actions ?? []) {
          const startsRoom = action.method === 'POST' && action.href === '/api/important/vcall/start';
          const link = element(startsRoom ? 'button' : 'a', '', action.label);
          if (startsRoom) {
            link.type = 'button';
            link.addEventListener('click', () => openLessonRoom(link, action, node));
          } else {
            link.href = action.href;
          }
          const existingRoomAction = ['#lesson', '#room'].includes(action.href);
          const primary = startsRoom || existingRoomAction || action.href.startsWith('/api/important/vcall/join?');
          if (primary) {
            link.dataset.primary = 'true';
          }
          if (existingRoomAction) {
            link.addEventListener('click', event => {
              const existing = document.querySelector(`[data-lesson-room-panel] a[href="${action.href}"]`);
              if (existing) { event.preventDefault(); existing.click(); }
            });
          }
          (primary ? node.primaryActions : node.actions).append(link);
        }
        node.actionKey = actionKey;
      }
      if (item.singleStudent && (node.body.contains(document.activeElement) || node.toggle === document.activeElement)) {
        node.actions.querySelector('a')?.focus({ preventScroll: true });
      }
      node.toggle.hidden = Boolean(item.singleStudent) || (!lesson && !item.detailCount);
      if (item.singleStudent && !node.body.hidden) {
        node.body.hidden = true;
        node.toggle.setAttribute('aria-expanded', 'false');
        details.get(item.key)?.controller?.abort();
        details.delete(item.key);
        node.body.replaceChildren();
      }
      node.controls.hidden = node.toggle.hidden && !item.actions?.length;
      const detailCountLabel = history || school && count > 0 ? '' : ` · ${item.detailCount}`;
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
    more.hidden = items.length <= 3;
    text(more, expanded ? 'Свернуть' : `Ещё сегодня · ${Math.max(0, items.length - 3)}`);
    more.setAttribute('aria-expanded', String(expanded));
    const emptyMessage = issues.length ? 'Нет доступных сведений' : context === 'school' ? 'Нет событий, требующих внимания' : 'Сейчас нет важных событий';
    const footer = $('[data-important-day]');
    text(footer, data.daySummary || (!data.items.length && !data.orders?.items.length && bookpcSlots.every(slot => slot.hidden) ? emptyMessage : ''));
    footer.hidden = !footer.textContent;
    tick();
  }

  async function openLessonRoom(button, action, node) {
    const scope = generation;
    button.disabled = true;
    const message = node.article.querySelector('[data-room-status]') ?? element('p', 'important-detail-status');
    message.dataset.roomStatus = '';
    message.setAttribute('role', 'status');
    if (!message.isConnected) node.controls.after(message);
    text(message, 'Открываем комнату…');
    try {
      const response = await fetch(action.href, {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lessonKey: action.lessonKey }), signal: AbortSignal.timeout(12_000),
      });
      if (scope !== generation) return;
      if (!response.ok) throw new Error('room_unavailable');
      const result = await response.json();
      if (scope !== generation) return;
      const join = new URL(result.href, location.origin);
      if (join.origin !== location.origin || join.pathname !== '/api/important/vcall/join') throw new Error('invalid_room_link');
      location.assign(join.href);
    } catch {
      if (scope === generation) {
        text(message, 'Комнату открыть не удалось. Обновляем данные урока.');
        schedule(0);
      }
    } finally {
      button.disabled = false;
    }
  }

  function detailState(key) {
    if (details.has(key)) return details.get(key);
    const node = nodes.get(key);
    const history = node.article.dataset.kind === 'schedule_change';
    const metadata = element('p', 'important-detail-metadata');
    const actions = element('div', 'important-item-actions important-detail-links');
    actions.hidden = true;
    const tools = element('div', 'important-detail-tools');
    tools.hidden = history;
    const filters = element('div');
    const all = element('button', '', 'Все'); all.type = 'button'; all.setAttribute('aria-pressed', 'true');
    const attention = element('button', '', 'Требуют внимания'); attention.type = 'button'; attention.setAttribute('aria-pressed', 'false');
    const search = element('input'); search.type = 'search'; search.placeholder = 'Найти ученика'; search.setAttribute('aria-label', 'Поиск ученика');
    filters.append(all, attention); tools.append(filters, search);
    const message = element('p', 'important-detail-status'); message.setAttribute('role', 'status');
    const students = element('ul', history ? 'important-history-sides' : 'important-students');
    const more = element('button', 'important-more-rows', 'Показать ещё'); more.type = 'button'; more.hidden = true;
    node.body.append(metadata, actions, tools, message, students, more);
    const state = { history, metadata, actions, tools, filters, all, attention, search, message, students, more, rows: new Map(), filter: 'all', q: '', nextOffset: null, request: 0 };
    let searchTimer;
    search.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.q = search.value; loadDetails(key, true); }, 250); });
    for (const [button, filter] of [[all, 'all'], [attention, 'attention']]) button.addEventListener('click', () => { state.filter = filter; loadDetails(key, true); });
    more.addEventListener('click', () => loadDetails(key, false));
    details.set(key, state); return state;
  }

  function renderRows(state, rows, reset) {
    if (state.history) {
      renderHistory(state, rows);
      return;
    }
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
      row.name.dataset.arrivalMark = person.arrivalMark || '';
      row.node.dataset.attention = String(person.needsAttention); row.link.hidden = !person.href;
      if (person.href) row.link.href = person.href;
      if (!row.node.contains(document.activeElement)) state.students.append(row.node);
    }
  }

  function renderHistory(state, rows) {
    const signature = JSON.stringify(rows);
    if (state.students.dataset.value === signature) return;
    state.students.dataset.value = signature;
    const previous = rows.find(row => row.id === 'before')?.lessons ?? [];
    state.students.replaceChildren(...rows.map(({ id, name, lessons }) => {
      const side = element('li', 'important-history-side');
      side.dataset.side = id;
      side.append(element('h4', 'important-history-label', name));
      if (!lessons?.length) {
        side.append(element('p', 'important-history-empty', id === 'before' ? 'Не было в расписании' : 'Нет в расписании'));
        return side;
      }
      const list = element('ul', 'important-history-lessons');
      const compare = id === 'after' && lessons.length === 1 && previous.length === 1 ? previous[0] : null;
      for (const lesson of lessons) {
        const line = element('li', 'important-history-lesson');
        const subject = element('strong', '', lesson.subject);
        if (compare && lesson.subject !== compare.subject) subject.dataset.changed = 'true';
        line.append(subject);
        const facts = element('div', 'important-history-facts');
        for (const field of ['when', 'place', 'teacher']) {
          if (!lesson[field]) continue;
          const fact = element('span', '', lesson[field]);
          if (compare && lesson[field] !== compare[field]) fact.dataset.changed = 'true';
          facts.append(fact);
        }
        if (facts.childElementCount) line.append(facts);
        list.append(line);
      }
      side.append(list);
      return side;
    }));
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
        if (response.status === 404) {
          renderRows(state, [], true);
          state.actions.replaceChildren(); state.actions.hidden = true; state.actions.dataset.value = '';
          state.more.hidden = true;
          text(state.message, 'Сведения изменились. Обновляем сводку.');
          schedule(0);
          return;
        }
        if (!response.ok) throw new Error('details_unavailable');
        payload = await response.json();
        if (scope !== generation || request !== state.request) return;
        rows.push(...payload.rows);
        if (payload.nextOffset != null && payload.nextOffset <= offset) payload.nextOffset = null;
        offset = payload.nextOffset;
      } while (automatic && offset != null && rows.length < wanted);
      payload.rows = rows;
      renderRows(state, payload.rows, reset);
      const actionKey = JSON.stringify(payload.actions ?? []);
      if (state.actions.dataset.value !== actionKey) {
        state.actions.replaceChildren(...(payload.actions ?? []).map(action => {
          const anchor = element('a', '', action.label);
          anchor.href = action.href;
          return anchor;
        }));
        state.actions.dataset.value = actionKey;
      }
      state.actions.hidden = !payload.actions?.length;
      state.nextOffset = payload.nextOffset;
      state.more.hidden = payload.nextOffset == null;
      state.search.hidden = payload.total <= 12 && !state.q;
      const item = data?.items.find(item => item.key === key);
      state.tools.hidden = state.history || Boolean(item?.remoteDetails) || !item?.detailCount;
      state.filters.hidden = !item?.attentionCount && state.filter === 'all';
      state.all.setAttribute('aria-pressed', String(state.filter === 'all'));
      state.attention.setAttribute('aria-pressed', String(state.filter === 'attention'));
      text(state.metadata, payload.metadata.join(' · '));
      text(state.message, state.history ? payload.total ? '' : 'История недоступна'
        : payload.total ? `Показано ${state.rows.size} из ${payload.total}`
          : item?.detailCount ? 'По выбранным условиям ничего не найдено' : 'Список участников не указан');
    } catch (error) { if (error.name !== 'AbortError' && request === state.request) text(state.message, 'Не удалось обновить сведения. Сверните и откройте список для повтора.'); }
    finally { clearTimeout(timeout); if (request === state.request) state.more.disabled = false; }
  }

  function setRefreshBusy(busy) {
    if (busy === (refreshButton.getAttribute('aria-busy') === 'true')) return;
    refreshButton.setAttribute('aria-busy', String(busy));
    refreshButton.setAttribute('aria-disabled', String(busy));
    text(refreshButton, busy ? 'Обновляем…' : 'Обновить');
  }

  function cancelScopeRequests() {
    generation++; controller?.abort(); controller = null; clearTimeout(pollTimer);
    setRefreshBusy(false);
    for (const state of details.values()) state.controller?.abort();
  }
  function clearPrivateData() {
    cancelScopeRequests();
    list.replaceChildren(); nodes.clear(); details.clear(); data = null; etag = ''; panel.hidden = true;
    renderOrders(null);
    renderApprovals([]);
    renderPendingReports([]);
    $('[data-important-clock]').hidden = true;
    if (workday) {
      workday.hidden = true; workday.open = false;
      text($('[data-important-workday-title]'), '');
      text($('[data-important-workday-time]'), '');
      const preview = $('[data-important-workday-details]');
      preview.replaceChildren();
      delete preview.dataset.value;
    }
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
      if ([401,403,404].includes(response.status)) {
        clearPrivateData();
        status.hidden = true;
        if (response.status === 401) for (const slot of bookpcSlots) {
          slot.replaceChildren();
          slot.hidden = true;
        }
        updatePanelVisibility();
        return;
      }
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
      status.hidden = false;
      status.dataset.state = 'warning';
      text(status, 'Не удалось обновить сводку. Повторим после восстановления связи.');
    } finally {
      clearTimeout(timeout); if (controller === requestController) controller = null;
      if (scope === generation) {
        setRefreshBusy(false);
        schedule(failures ? Math.min(60_000, 30_000 * failures) : 15_000);
      }
    }
  }
  function changeScope() {
    clearPrivateData(); expanded = false; boundary = ''; noticeUntil = 0;
    panel.dataset.contextMode = context;
    status.hidden = false;
    panel.hidden = false; status.dataset.state = 'loading'; text(status, 'Загружаем вашу сводку…');
    for (const button of panel.querySelectorAll('[data-context]')) button.setAttribute('aria-pressed', String(button.dataset.context === context));
    if (context === 'school') $('[data-important-family]').hidden = true;
    // Let the cancelled request release its controller before starting the new scope.
    schedule(0);
  }
  function changeChild(nextChild) {
    childId = nextChild;
    if (!data || context !== 'personal') {
      changeScope();
      return;
    }
    cancelScopeRequests();
    data = { ...data, selectedChildId:childId, daySummary:'', scheduleFingerprint:'',
      items:data.items.filter(item => isPendingReport(item) || item.kind === 'calendar_approval' || (item.kind === 'lesson' && item.audience === 'self')) };
    etag = ''; boundary = ''; noticeUntil = 0;
    render();
    status.dataset.state = 'loading';
    text(status, 'Обновляем сведения о ребёнке…');
    schedule(0);
  }
  for (const button of panel.querySelectorAll('[data-context]')) button.addEventListener('click', () => {
    if (context === button.dataset.context) return;
    context = button.dataset.context;
    changeScope();
  });
  $('[data-important-child]').addEventListener('change', event => changeChild(event.target.value));
  $('[data-important-more]').addEventListener('click', () => { expanded = !expanded; render(); });
  refreshButton.addEventListener('click', () => {
    if (refreshButton.getAttribute('aria-busy') === 'true') return;
    setRefreshBusy(true);
    status.dataset.state = 'loading';
    text(status, 'Обновляем…');
    if (!controller) {
      etag = '';
      refresh();
    }
  });

  function syncTicker() {
    clearInterval(tickTimer);
    panel.toggleAttribute('data-page-hidden', document.hidden);
    if (document.hidden) {
      clearTimeout(pollTimer);
      return;
    }
    tick();
    tickTimer = setInterval(tick, 1000);
  }

  document.addEventListener('visibilitychange', () => {
    syncTicker();
    if (!document.hidden) schedule(0);
  });
  window.addEventListener('focus', () => schedule(0)); window.addEventListener('online', () => schedule(0));
  window.addEventListener('pagehide', () => {
    clearInterval(tickTimer);
    clearPrivateData();
  });
  window.addEventListener('pageshow', event => {
    if (event.persisted) {
      syncTicker();
      schedule(0);
    }
  });
  const observeBookpc = new MutationObserver(updatePanelVisibility);
  for (const slot of bookpcSlots) observeBookpc.observe(slot, { attributes: true, attributeFilter: ['hidden'] });
  new IntersectionObserver(([entry]) => {
    panel.toggleAttribute('data-offscreen', !entry.isIntersecting);
  }).observe(panel);
  panel.hidden = false;
  syncTicker();
  refresh();
}
