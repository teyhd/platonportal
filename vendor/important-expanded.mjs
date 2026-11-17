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

export function lessonReferences(schedule) {
  return (schedule?.lessons ?? []).filter(lesson => Number(lesson.entryId) > 0 &&
    Number(lesson.versionId ?? schedule.versionId ?? schedule.weekVersionId) > 0 && hasInterval(lesson))
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
    if (!assigned.has(String(period.studentId)) || !hasInterval(period) ||
        instant(period.end) > +now || instant(period.end) < +now - 7 * 24 * 60 * minute) continue;
    const meeting = (schedule?.lessons ?? []).find(lesson => lesson.individual && hasInterval(lesson) &&
      (lesson.own || lesson.contexts?.includes('assigned')) && instant(lesson.end) > +now &&
      instant(period.end) <= instant(lesson.start) &&
      lesson.students?.some(person => String(person.id) === String(period.studentId)));
    if (meeting) periods.set(`${period.studentId}|${period.start}|${period.end}`, period);
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
      return [{ kind, start: row.start, end: row.end, href: importantLink(row.href, origin) }];
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
  return rows.slice(0, 150).flatMap((row, index) => {
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
  return instant(item.dueAt) || instant(item.start) || Infinity;
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
    const dateText = date => /^\d{4}-\d{2}-\d{2}$/.test(date ?? '')
      ? shortDate.format(new Date(`${date}T12:00:00+03:00`)) : '';
    const room = value => text(value.roomName ?? value.room, 100);
    const descriptor = value => [
      dateText(value.date),
      hasInterval(value) ? `${time(value.start)}–${time(value.end)}` : '',
      value.online ? 'Онлайн' : room(value) ? `Кабинет ${room(value)}` : '',
      text(value.teacherName, 180),
    ].filter(Boolean).join(' · ');
    item.rows = [['Было',before],['Стало',after]].flatMap(([label, snapshots]) =>
      snapshots.map((value, index) => ({
        id:`${label}:${index}`, name:`${label}${value.subject ? ' · ' + text(value.subject, 160) : ''}`,
        description:descriptor(value),
      })));
    item.detailCount=item.rows.length;
    item.detailLabel='Изменения';
    if (Number.isFinite(instant(event.changedAt))) item.subtitle=`Обновлено ${shortDate.format(new Date(event.changedAt))} в ${time(event.changedAt)}`;
    if (schedule.historyLegacyGap || schedule.unavailableFeatures?.includes('history_truncated')) {
      item.metadata=['Показана доступная часть истории изменений'];
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
      labels.push(`${descriptor({date:previous.date,start:previous.start,end:previous.end})} → ${descriptor({date:current.date,start:current.start,end:current.end})}`);
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
  if (view.context === 'personal') {
    familyDay(view, schedule);
    scheduleHistory(view, schedule);
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
    for (const value of payload?.items ?? []) {
      const key = text(value.key, 300);
      const title = text(value.title, 240);
      if (!key || !title) continue;
      const actions = sourceActions(value.actions, origin);
      const rows = sourceRows(value.rows, origin);
      const kind = text(value.kind, 80) || source;
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
  if (view.workday?.some(day => day.entries.length) || view.items.length) view.visible = true;
  return view;
}
