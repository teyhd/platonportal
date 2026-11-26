const scheduleOrigin = 'https://rasp.platoniks.ru';
const attendanceOrigin = 'https://stud.platoniks.ru';
export const expandedSources = {
  diary: { label: 'Дневник', origin: 'https://diary.platoniks.ru' },
  calendar: { label: 'Календарь', origin: 'https://event.platoniks.ru' },
  progress: { label: 'Прогресс', origin: 'https://rep.platoniks.ru' },
};

export const schoolDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow' });
const schoolClock = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' });
const shortDate = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day:'numeric', month:'long' });
const minute = 60_000;
const instant = value => Date.parse(value);
const time = value => schoolClock.format(new Date(value));
const hasInterval = item => instant(item?.end) > instant(item?.start);
const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';

export function importantLink(value, origin) {
  if (typeof value !== 'string' || !value || value.startsWith('//')) return null;
  try {
    const url = new URL(value, origin);
    return url.origin === origin && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

export function lessonReferences(schedule, now = new Date()) {
  return (schedule?.lessons ?? []).filter(lesson => Number(lesson.entryId) > 0 &&
    Number(lesson.versionId ?? schedule.versionId ?? schedule.weekVersionId) > 0 && hasInterval(lesson))
    .sort((a,b) => {
      const rank = lesson => lesson.own ? 0 : lesson.contexts?.includes('child') ? 1 : 2;
      const distance = lesson => Math.max(0, instant(lesson.start) - +now, +now - instant(lesson.end));
      return rank(a) - rank(b) || distance(a) - distance(b);
    })
    .slice(0, 40).map(lesson => ({
      key: lesson.key,
      entryId: Number(lesson.entryId),
      versionId: Number(lesson.versionId ?? schedule.versionId ?? schedule.weekVersionId) || null,
      date: lesson.date ?? schoolDate.format(new Date(lesson.start)),
      ...(lesson.rosterComplete ? { studentIds: (lesson.students ?? []).map(student => Number(student.id)).filter(value => value > 0) } : {}),
      subjectIds: (lesson.subjectIds ?? []).map(Number).filter(value => value > 0),
    }));
}

export function returnPeriods(schedule, attendance, now) {
  const assigned = new Set([...(schedule?.assignedStudents ?? []).map(student => String(student.id)),
    ...(attendance?.assignedIds ?? []).map(String)]);
  const periods = new Map();
  const confirmed = (attendance?.students ?? []).flatMap(student => (student.absences ?? [])
    .filter(period => period.confirmation === 'confirmed')
    .map(period => ({ studentId: Number(student.id), start: period.start, end: period.end })));
  for (const period of [...confirmed, ...(attendance?.recentReturns ?? [])]) {
    const studentId = Number(period.studentId);
    if (!Number.isSafeInteger(studentId) || studentId <= 0 || !assigned.has(String(studentId)) || !hasInterval(period) ||
        instant(period.end) > +now || instant(period.end) < +now - 7 * 24 * 60 * minute) continue;
    const meeting = (schedule?.lessons ?? []).find(lesson => lesson.individual && hasInterval(lesson) &&
      (lesson.own || lesson.contexts?.includes('assigned')) && instant(lesson.end) > +now &&
      instant(period.end) <= instant(lesson.start) &&
      lesson.students?.some(person => String(person.id) === String(period.studentId)));
    if (meeting && instant(period.start) >= +now - 60 * 24 * 60 * minute) {
      periods.set(`${studentId}|${period.start}|${period.end}`, {studentId,start:period.start,end:period.end});
    }
  }
  return [...periods.values()].slice(0, 20);
}

export function workdayPreview(schedule, attendance, now) {
  const today = schoolDate.format(now);
  const tomorrow = schoolDate.format(new Date(instant(`${today}T12:00:00+03:00`) + 24 * 60 * minute));
  return [today, tomorrow].map(date => {
    const sources = [
      ['shift', attendance?.workday, attendanceOrigin],
      ['lesson', schedule?.workday, scheduleOrigin],
    ];
    const entries = sources.flatMap(([kind, rows, origin]) => {
      const row = rows?.find?.(item => item.date === date);
      if (!row || row.status !== 'scheduled' || !hasInterval(row) ||
          schoolDate.format(new Date(row.start)) !== date) return [];
      const entry = { kind, start: row.start, end: row.end, href: importantLink(row.href, origin) };
      if (kind === 'lesson') {
        const complete = Array.isArray(row.lessons) || row.lessonCount === 0;
        const lessons = (complete ? row.lessons ?? [] : row.firstLessons ?? []).filter(lesson =>
          instant(lesson?.start) >= instant(row.start) && instant(lesson?.start) < instant(row.end) &&
          (!lesson.end || instant(lesson.end) > instant(lesson.start) && instant(lesson.end) <= instant(row.end)))
          .map(lesson => ({
            start: lesson.start, subject: text(lesson.subject, 180), format: text(lesson.format, 20),
            ...(lesson.end ? {end:lesson.end} : {}),
            classes: Array.isArray(lesson.classes) ? lesson.classes.map(value => text(value, 45)).filter(Boolean) : [],
            rooms: Array.isArray(lesson.rooms) ? lesson.rooms.map(value => text(value, 100)).filter(Boolean) : [],
            studentName: text(lesson.studentName, 200), href: importantLink(lesson.href, origin),
            ...(lesson.individual ? {individual:true} : {}),
          })).sort((a,b)=>instant(a.start)-instant(b.start)||a.subject.localeCompare(b.subject,'ru'));
        if (complete) {
          entry.lessons = lessons;
          entry.lessonCount = lessons.length;
        }
        if (lessons.length) entry.firstLessons = lessons.filter(lesson=>lesson.start===lessons[0].start);
      }
      return [entry];
    }).sort((a, b) => instant(a.start) - instant(b.start) || Number(b.kind === 'shift') - Number(a.kind === 'shift'));
    const pending = sources.flatMap(([kind, rows]) => (rows ?? [])
      .filter(row => row.date === date && ['unpublished', 'unavailable', 'unassigned'].includes(row.status))
      .map(row => ({ kind, status: row.status })));
    return { date, entries, pending };
  });
}

function sourceActions(actions, origin) {
  if (!Array.isArray(actions)) return [];
  return actions.slice(0, 6).flatMap(action => {
    const href = importantLink(action?.href, origin);
    const label = text(action?.label, 80);
    return href && label ? [{ href, label }] : [];
  });
}

function sourceRows(rows, origin) {
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, 200).flatMap((row, index) => {
    const name = text(row?.name ?? row?.title, 240);
    if (!name) return [];
    return [{
      id: text(String(row.id ?? row.key ?? index), 180), name,
      description: text(row.description ?? row.subtitle, 300),
      annotations: Array.isArray(row.annotations) ? row.annotations.slice(0, 5).map(value => text(value, 160)) : [],
      href: importantLink(row.href, origin), needsAttention: row.needsAttention === true,
    }];
  });
}

function returnCheckRows(schedule, attendance, now) {
  const assignedIds = new Set([...(schedule?.assignedStudents ?? []).map(person => String(person.id)),
    ...(attendance?.assignedIds ?? []).map(String)]);
  return (attendance?.students ?? []).flatMap(person => {
    if (!assignedIds.has(String(person.id)) || Number(person.conflicts) > 0) return [];
    const future = (schedule?.lessons ?? []).filter(lesson => !lesson.online && instant(lesson.start) > +now &&
      lesson.students?.some(student => String(student.id) === String(person.id) &&
        (student.mode === 'onsite' || (!student.mode && lesson.format !== 'mixed'))));
    const next = future.sort((a, b) => instant(a.start) - instant(b.start))[0];
    if (!next) return [];
    const ended = (person.absences ?? []).filter(period => period.confirmation === 'confirmed' &&
      instant(period.end) <= +now && instant(period.end) >= +now - 12 * 60 * minute &&
      instant(period.end) >= instant(person.lastEvent?.at ?? '1970-01-01'));
    if (!ended.length || (person.absences ?? []).some(period => instant(period.start) <= instant(next.start) &&
        (!period.end || instant(period.end) > instant(next.start)))) return [];
    return [{
      id: String(person.id), name: person.name, description: `Очное занятие в ${time(next.start)}`,
      annotations: ['Оформленное отсутствие закончилось. Новой отметки прихода пока нет.'],
      needsAttention: true, href: importantLink(next.href, scheduleOrigin),
    }];
  });
}

function deadline(item) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(item.dueAt ?? '')) return instant(`${item.dueAt}T23:59:59+03:00`);
  return instant(item.dueAt) || instant(item.start) || instant(item.end) || Infinity;
}

function groupProgressDrafts(items, origin) {
  const groups = new Map();
  const rest = [];
  for (const item of items) {
    const href = sourceActions(item.actions, origin)[0]?.href;
    if (item.kind !== 'progress_draft' || !item.key || !href) {
      rest.push(item);
      continue;
    }
    const due = text(item.dueAt, 48);
    if (!groups.has(due)) groups.set(due, new Map());
    groups.get(due).set(item.key, { item, href });
  }
  for (const [dueAt, group] of groups) {
    const cards = [...group.values()];
    if (cards.length === 1) {
      rest.push(cards[0].item);
      continue;
    }
    rest.push({
      key: `drafts:${dueAt || 'undated'}`, kind: 'progress_draft_group', dueAt,
      title: 'Отчёты ждут заполнения', subtitle: `Карточек: ${cards.length}`,
      rows: cards.map(({item,href}) => ({ id:item.key, name:text(item.subtitle,240) || item.title, href })),
    });
  }
  return rest;
}

function prioritizePersonalItems(ordered, now) {
  const lessons = ordered.filter(item => item.kind === 'lesson');
  const own = lessons.filter(item => item.audience === 'self');
  const primary = own.length ? own : lessons;
  const current = primary.find(item => instant(item.start) <= +now && instant(item.end) > +now);
  const next = primary.find(item => instant(item.start) > +now);
  const leading = [...new Set([current,next,...lessons].filter(Boolean))].slice(0,2);
  const action = ordered.find(item => item.kind !== 'lesson' && item.priority < 40 &&
    (item.actions?.length || item.detailCount));
  if (action) leading.push(action);
  const pinned = new Set(leading);
  return [...leading, ...ordered.filter(item => !pinned.has(item))];
}

function deadlineNote(value, now) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) return `Срок до ${shortDate.format(new Date(`${value}T12:00:00+03:00`))}`;
  if (!Number.isFinite(instant(value))) return '';
  const day = schoolDate.format(new Date(value));
  const tomorrow = schoolDate.format(new Date(+now + 24 * 60 * minute));
  const dateLabel = day === schoolDate.format(now) ? 'сегодня' : day === tomorrow ? 'завтра' : shortDate.format(new Date(value));
  return `Срок ${dateLabel} в ${time(value)}`;
}

function familyDay(view, schedule) {
  const childId = Number(schedule?.selectedChildId);
  if (!childId) return;
  const child = (schedule.children ?? []).find(person => Number(person.id) === childId);
  const lessons = (schedule.lessons ?? []).filter(lesson => lesson.contexts?.includes('child') &&
    hasInterval(lesson) && lesson.students?.some(person => Number(person.id) === childId));
  const flex = [...(schedule.familyFlex ?? []), ...(schedule.events ?? [])].filter(event => event.kind === 'flex' && event.status === 'assigned' &&
    Number(event.studentId) === childId && hasInterval(event) && schoolDate.format(new Date(event.start)) === view.date);
  const end = [...lessons, ...flex].reduce((latest, item) => Math.max(latest, instant(item.end)), -Infinity);
  if (Number.isFinite(end)) {
    const own = (schedule.lessons ?? []).some(lesson => lesson.own) ||
      (schedule.events ?? []).some(event => event.key?.startsWith('flex:teacher:'));
    view.daySummary = [own ? view.daySummary : '',
      `${child?.name ? child.name + ' · ' : ''}${child?.name ? 'последнее занятие' : 'У ребёнка последнее занятие'} до ${time(end)}`]
      .filter(Boolean).join(' · ');
  }
}

function scheduleHistory(view, schedule) {
  const eventMap = new Map((schedule?.events ?? []).filter(event => event.kind === 'schedule_change')
    .map(event => [event.key,event]));
  for (const item of view.items) {
    const event = eventMap.get(item.key);
    if (!event) continue;
    const before=Array.isArray(event.before) ? event.before : [];
    const after=Array.isArray(event.after) ? event.after : [];
    if (!before.length && !after.length) continue;
    const dateText = date => /^\d{4}-\d{2}-\d{2}$/.test(date ?? '')
      ? shortDate.format(new Date(`${date}T12:00:00+03:00`)) : '';
    const room = value => text(value.roomName ?? value.room, 100);
    const interval = value => [dateText(value.date), hasInterval(value) ? `${time(value.start)}–${time(value.end)}` : '']
      .filter(Boolean).join(' · ');
    const snapshots = entries => [...entries].sort((a,b) => String(a.date).localeCompare(String(b.date)) ||
      String(a.start).localeCompare(String(b.start))).map(value => ({
      subject: text(value.subject, 160) || 'Занятие',
      when: interval(value),
      place: value.online ? 'Онлайн' : room(value) ? `Кабинет ${room(value)}` : '',
      teacher: text(value.teacherName, 180),
    }));
    item.rows = [
      { id:'before', name:'Было', lessons:snapshots(before) },
      { id:'after', name:'Стало', lessons:snapshots(after) },
    ];
    item.detailCount=item.rows.length;
    item.detailLabel='Было / стало';
    if (item.title === 'Опубликованное расписание изменено') {
      item.title = !before.length ? 'Добавлено в расписание' : !after.length ? 'Убрано из расписания' : 'Расписание изменилось';
    }
    item.actions = item.actions.filter(action => action.href).map(action => ({ ...action, label:'Расписание' }));
    const subjects = new Set([...before, ...after].map(value => text(value.subject, 80)).filter(Boolean));
    const changedAt = Number.isFinite(instant(event.changedAt)) ? `${shortDate.format(new Date(event.changedAt))}, ${time(event.changedAt)}` : '';
    item.subtitle = [subjects.size === 1 ? [...subjects][0] : '', changedAt].filter(Boolean).join(' · ');
    if (schedule.historyLegacyGap || schedule.unavailableFeatures?.includes('history_truncated')) {
      item.metadata=['История изменений доступна не полностью'];
    }
    if (before.length !== 1 || after.length !== 1) continue;
    const [previous] = before;
    const [current] = after;
    const sameLesson = previous.teacherId > 0 && previous.subjectId > 0 &&
      previous.teacherId === current.teacherId && previous.subjectId === current.subjectId &&
      (previous.slotId === current.slotId || event.status === 'move');
    if (!sameLesson) continue;
    const labels=[];
    if (room(previous) && room(current) && room(previous) !== room(current)) labels.push(`Кабинет ${room(previous)} → ${room(current)}`);
    if (hasInterval(previous) && hasInterval(current) &&
        (previous.start !== current.start || previous.end !== current.end)) {
      labels.push(`${interval(previous)} → ${interval(current)}`);
    }
    if (previous.online !== current.online) labels.push(current.online ? 'Теперь онлайн' : 'Теперь очно');
    if (!labels.length) continue;
    item.notes=labels;
    const matches=(schedule?.lessons ?? []).filter(lesson => msEquals(lesson.start,current.start) && msEquals(lesson.end,current.end) &&
      lesson.teacherIds?.map(Number).includes(Number(current.teacherId)) &&
      lesson.subjectIds?.map(Number).includes(Number(current.subjectId)));
    const lesson=matches.length===1 && view.items.find(card=>card.key===`lesson:${matches[0].key}`);
    if (lesson) lesson.notes.push(...labels);
  }
}

function msEquals(left, right) {
  const value = instant(left);
  return Number.isFinite(value) && value === instant(right);
}

function calendarConflicts(view, events, schedule, now) {
  const childId = Number(schedule?.selectedChildId);
  const child = (schedule?.children ?? []).find(person => Number(person.id) === childId);
  for (const event of events ?? []) {
    const href = importantLink(event.href, expandedSources.calendar.origin);
    if (!hasInterval(event) || !href || !['participant', 'responsible'].includes(event.relation) || instant(event.end) <= +now) continue;
    const family = Number(event.studentId) === childId && childId > 0 && event.relation === 'participant';
    if (event.studentId != null && !family) continue;
    const lessons = (schedule?.lessons ?? []).filter(lesson => hasInterval(lesson) && instant(lesson.end) > +now &&
      (family ? lesson.contexts?.includes('child') : lesson.own) &&
      instant(lesson.start) < instant(event.end) && instant(event.start) < instant(lesson.end));
    if (!lessons.length) continue;
    const start = Math.max(instant(event.start), Math.min(...lessons.map(lesson => instant(lesson.start))));
    const rows = lessons.map(lesson => {
      const overlap = Math.min(instant(event.end), instant(lesson.end)) - Math.max(instant(event.start), instant(lesson.start));
      return { id: String(lesson.key), name: lesson.subject || 'Занятие',
        description: `${time(lesson.start)}–${time(lesson.end)} · пересечение ${Math.ceil(overlap / minute)} мин`,
        href: importantLink(lesson.href, scheduleOrigin) };
    });
    view.items.push({
      key: `calendar:overlap:${event.id}:${family ? childId : 'self'}`,
      kind: 'calendar_overlap', priority: 17, tone: 'attention', start: new Date(start).toISOString(),
      title: family ? `${child?.name || 'У ребёнка'}: мероприятие пересекается с уроком` : 'Ваши обязательства пересекаются',
      subtitle: `${text(event.title, 180)} · ${time(event.start)}–${time(event.end)}`,
      rows, detailCount: rows.length, actions: [{ label: 'Открыть мероприятие', href }],
    });
  }
}

export function expandImportantView(view, { schedule, attendance, integrated, now, vcallRooms = {} }) {
  scheduleHistory(view, schedule);
  if (view.context === 'personal') {
    familyDay(view, schedule);
    view.workday = workdayPreview(schedule, attendance, now);
    if (view.workday.some(day => day.entries.some(entry => entry.kind === 'shift') || day.pending.some(entry => entry.kind === 'shift'))) {
      view.items = view.items.filter(item => item.key !== 'shift');
    }
    const returns = returnCheckRows(schedule, attendance, now);
    const checks = view.items.find(item => item.key === 'assigned:checks');
    if (returns.length) {
      const rows = new Map((checks?.rows ?? []).map(row => [row.id, row]));
      for (const row of returns) rows.set(row.id, row);
      const item = checks ?? { key: 'assigned:checks', kind: 'assigned', tone: 'attention', priority: 20, actions: [], detailLabel: 'Посмотреть' };
      Object.assign(item, { title: `У ваших подопечных требуют проверки: ${rows.size}`, subtitle: 'До ближайших очных занятий',
        rows: [...rows.values()], detailCount: rows.size, attentionCount: rows.size });
      if (!checks) view.items.push(item);
    }
    const shift = view.workday[0].entries.find(entry => entry.kind === 'shift');
    const open = view.items.find(item => item.key === 'assigned:checks');
    if (shift && instant(shift.end) > +now && instant(shift.end) - +now <= 30 * minute) {
      view.items.push({ key: 'workday:handover', kind: 'handover', priority: 18,
        title: `Смена до ${time(shift.end)}`, subtitle: open ? `Открытых вопросов: ${open.detailCount}` :
          schedule ? 'Открытых вопросов по доступным данным нет' : 'Расписание временно недоступно',
        tone: open ? 'attention' : 'neutral', end: shift.end,
        rows: open?.rows ?? [], detailCount: open?.detailCount ?? 0,
        actions: shift.href ? [{ label: 'График смен', href: shift.href }] : [] });
    }
    const coverage=attendance?.weeklyCoverage;
    if (coverage?.arrivalDays > 0 && coverage.coveredDays < coverage.arrivalDays &&
        !attendance.items?.some(item => item.kind==='weekly_attendance')) {
      view.items.push({ key:'attendance:weekly-coverage',kind:'weekly_attendance',priority:45,tone:'neutral',
        title:'Посещаемость за неделю',subtitle:`Сверено с расписанием дней с отметками прихода: ${coverage.coveredDays} из ${coverage.arrivalDays}`,
        actions:[] });
    }
    calendarConflicts(view, integrated.calendar?.events, schedule, now);

    const lessons = new Map((schedule?.lessons ?? []).map(lesson => [String(lesson.key), lesson]));
    for (const fact of integrated.diary?.lessons ?? []) {
      const lesson = lessons.get(String(fact.key));
      if (!lesson) continue;
      const card = view.items.find(item => item.key === `lesson:${lesson.key}`);
      const journal = importantLink(fact.journalHref, expandedSources.diary.origin);
      const review = importantLink(fact.reviewHref, expandedSources.diary.origin);
      const topic = text(fact.topic, 220);
      const materials = sourceActions(fact.materials, expandedSources.diary.origin);
      if (card) {
        const count = Number(fact.reviewCount);
        const repeated = Number(fact.resubmittedCount);
        if (topic) card.notes.push(`Тема · ${topic}`);
        if (count > 0) card.notes.push(`Работ на проверке · ${count}${repeated > 0 ? ` · повторно сданы ${repeated}` : ''}`);
        if (journal) card.actions.push({ label: 'Запись урока', href: journal });
        if (review && count > 0) card.actions.push({ label: 'Проверить работы', href: review });
        if (materials.length) card.detailActions = materials;
      }
      if (journal && lesson.own && fact.needsCompletion && +now >= instant(lesson.end) + 15 * minute) {
        view.items.push({ key: `diary:complete:${lesson.key}`, kind: 'completion', priority: 25,
          title: fact.topicMissing ? 'Добавить тему в журнал' : 'Завершить оформление урока',
          subtitle: `${lesson.subject || 'Урок'} · завершился в ${time(lesson.end)}`,
          actions: [{ label: 'Открыть журнал', href: journal }] });
      }
    }
    for (const card of view.items.filter(item => item.kind === 'lesson')) {
      const room = vcallRooms[card.key.slice('lesson:'.length)];
      if (!room) continue;
      card.actions = card.actions.filter(action => !['#room', '#lesson'].includes(action.href));
      if (room.status === 'unavailable') continue;
      if (room.kind === 'host' && room.status === 'closed') {
        card.notes.push('Комната этого урока ещё закрыта');
        card.actions.unshift({ label: 'Открыть комнату', method: 'POST', href: '/api/important/vcall/start', lessonKey: room.key });
      } else if (room.status === 'active') {
        card.actions.unshift({ label: 'Войти в комнату', href: `/api/important/vcall/join?lessonKey=${encodeURIComponent(room.key)}` });
      }
    }
  }
  for (const [source, payload] of Object.entries(integrated)) {
    const origin = expandedSources[source]?.origin ?? attendanceOrigin;
    const items = payload?.items ?? [];
    for (const value of source === 'progress' && view.context === 'personal' ? groupProgressDrafts(items,origin) : items) {
      const key = text(value.key, 300);
      const title = text(value.title, 240);
      if (!key || !title) continue;
      const actions = sourceActions(value.actions, origin);
      const rows = sourceRows(value.rows, origin);
      const kind = text(value.kind, 80) || source;
      const pendingFill = ['progress_report_pending_fill', 'feedback_pending_fill'].includes(kind);
      if (pendingFill && (source !== 'progress' || view.context !== 'personal' ||
          !Number.isSafeInteger(value.cardCount) || value.cardCount <= 0 || !actions.length)) continue;
      const published = kind.endsWith('_published') && Number.isFinite(instant(value.publishedAt));
      const publishedDate = published
        ? shortDate.format(new Date(value.publishedAt))
        : '';
      const sourceSubtitle=text(value.subtitle, 300);
      const dueNote = source === 'progress' ? deadlineNote(value.dueAt, now) : '';
      const subtitle = [sourceSubtitle, publishedDate, dueNote].filter(Boolean).join(' · ');
      if (source === 'progress' && view.context === 'personal' && /return/.test(kind) && Number(value.studentId) > 0) {
        const matching = (schedule?.lessons ?? []).find(lesson => lesson.own && lesson.individual && instant(lesson.end) > +now &&
          lesson.students?.some(student => Number(student.id) === Number(value.studentId)));
        const related = matching && view.items.find(item => item.key === `lesson:${matching.key}`);
        if (related && actions.length) {
          related.notes.push([title, subtitle].filter(Boolean).join(' · '));
          related.actions.push(...actions);
          continue;
        }
      }
      view.items.push({
        key: `${source}:${key}`, kind, title, subtitle, actions, rows,
        ...(pendingFill ? { cardCount: value.cardCount } : {}),
        ...(kind === 'progress_draft_group' ? { detailLabel:'Карточки' } : {}),
        detailCount: rows.length, tone: kind.includes('published') || kind==='weekly_attendance' ? 'neutral' : 'attention',
        priority: kind.includes('published') || kind==='weekly_attendance' ? 45 : 22,
        start: text(value.start, 48), end: text(value.end, 48), dueAt: text(value.dueAt, 48),
      });
    }
  }
  const byKey = new Map(view.items.map(item => [item.key, item]));
  view.items = [...byKey.values()].sort((a, b) => {
    if (view.context !== 'personal') {
      return a.priority - b.priority || deadline(a) - deadline(b) || a.key.localeCompare(b.key);
    }
    const rank = item => item.kind === 'lesson' ? 0 : item.priority < 40 ? 1 : 2;
    const category = rank(a) - rank(b);
    if (category) return category;
    if (rank(a) !== 1) return a.priority - b.priority || deadline(a) - deadline(b) || a.key.localeCompare(b.key);
    return deadline(a) - deadline(b) || a.priority - b.priority || a.key.localeCompare(b.key);
  });
  if (view.context === 'personal') view.items = prioritizePersonalItems(view.items,now);
  if (view.workday?.some(day => day.entries.length) || view.items.length) view.visible = true;
  return view;
}
