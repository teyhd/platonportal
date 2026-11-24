import crypto from 'node:crypto';
import { hasFamilyServiceRight, selectedFamilyChild } from './familyAccess.mjs';
import { contactsForClasses } from './important-class-contacts.mjs';
import { expandImportantView, expandedSources, lessonReferences, returnPeriods, schoolDate } from './important-expanded.mjs';
const clock = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' });
const minute = 60_000;
const id = value => String(value ?? '');
const unique = values => [...new Set(values)];
const ms = value => value ? Date.parse(value) : NaN;
const timeLabel = value => Number.isFinite(ms(value)) ? clock.format(new Date(value)) : '';
const overlaps = (a, b) => ms(a.start) < ms(b.end) && ms(b.start) < ms(a.end);
const sameAudience = (a, b) => a.own && b.own || !a.own && !b.own && a.contexts?.includes('child') && b.contexts?.includes('child');
const enabled = env => env.IMPORTANT_ENABLED === '1';
const sourceTitles = { schedule: 'Расписание', attendance: 'Посещаемость',
  ...Object.fromEntries(Object.entries(expandedSources).map(([key, source]) => [key, source.label])) };
const safeLink = (value, origin) => {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return origin;
  const parsed = new URL(value, origin);
  return parsed.origin === new URL(origin).origin ? parsed.href : origin;
};

function releaseIntervals(person) {
  if (person.releaseIntervals?.length) return person.releaseIntervals;
  if (person.participation === 'partial' && Number.isFinite(ms(person.releaseStart)) && ms(person.releaseEnd) > ms(person.releaseStart)) {
    return [{ start:person.releaseStart,end:person.releaseEnd }];
  }
  return [];
}

export function attendanceRow(person, fact, lesson, now) {
  const row = { id: id(person.id), name: person.name || 'Ученик', className: fact?.className || '', description: 'Нет данных о посещаемости', needsAttention: false, annotations: [] };
  if (!fact) return row;
  row.href = `https://stud.platoniks.ru/attendance?class=${encodeURIComponent(fact.classId || person.classId || '')}&student=${encodeURIComponent(person.id)}&date=${schoolDate.format(now)}`;
  const end = lesson?.end ?? `${schoolDate.format(now)}T23:59:59+03:00`;
  const at = lesson ? Math.max(+now, ms(lesson.start)) : +now;
  const absences = (fact.absences ?? []).filter(absence => ms(absence.start) < ms(end) && (!absence.end || ms(absence.end) > at));
  const scheduleRelease = releaseIntervals(person).some(period=>ms(period.start)<=at&&ms(period.end)>at);
  const currentAbsence = scheduleRelease || absences.some(absence => ms(absence.start) <= at && (!absence.end || ms(absence.end) > at));
  const last = fact.lastEvent;
  row.description = last?.type === 'arrival' ? `Приход отмечен в ${timeLabel(last.at)}` : last?.type === 'departure' ? `Уход отмечен в ${timeLabel(last.at)}` : 'Приход пока не отмечен';
  row.physicalStatus = last?.type === 'arrival' ? 'arrival' : last?.type === 'departure' ? 'departure' : 'none';
  for (const absence of absences) row.annotations.push(`Оформлено отсутствие ${timeLabel(absence.start)}${absence.end ? `–${timeLabel(absence.end)}` : ''}`);
  if (Number(fact.conflicts) > 0) {
    row.description = 'Нужно проверить противоречащие отметки';
    row.needsAttention = true;
    row.physicalStatus = 'conflict';
  } else if (!currentAbsence && lesson && person.mode !== 'online' && person.mode !== 'mixed' && !lesson.online && (lesson.format !== 'mixed' || person.mode === 'onsite')
      && ms(lesson.start) - +now <= 10 * minute && ms(lesson.end) > +now) {
    row.needsAttention = !last || last.type === 'departure';
  }
  if (absences.some(absence => absence.needsAttention || ['needs_clarification', 'system_conflict'].includes(absence.confirmation))) row.needsAttention = true;
  if (person.mode === 'online' || lesson?.online) row.annotations.push('По расписанию онлайн');
  if (person.mode === 'mixed') row.annotations.push('Формат требует уточнения');
  return row;
}

function lessonItem(lesson, facts, now, canVcall, allowAttendance) {
  const rows = (lesson.students ?? []).map(person => allowAttendance ? attendanceRow(person, facts.get(id(person.id)), lesson, now)
    : {id:id(person.id),name:person.name||'Ученик',description:person.mode==='online'?'Онлайн по расписанию':'Участник по расписанию',needsAttention:false,annotations:[]});
  const student = rows.length === 1 ? rows[0] : null;
  const attention = rows.filter(row => row.needsAttention).length;
  const current = ms(lesson.start) <= +now && ms(lesson.end) > +now;
  const child = lesson.contexts?.includes('child') && !lesson.own;
  const rooms = lesson.rooms ?? [];
  const roomLabel = rooms.length ? `${rooms.length > 1 ? 'Кабинеты' : 'Кабинет'} ${rooms.join(', ')}` : '';
  const classes = (lesson.classes ?? []).join(', ');
  const audience = student?.name || classes || (lesson.individual ? 'Индивидуальное занятие' : rows.length > 1 ? 'Класс не указан' : '');
  const subtitle = [child ? 'У ребёнка' : '', audience,
    lesson.format === 'mixed' ? 'Смешанный формат' : '',
    lesson.online ? 'Онлайн' : roomLabel || (lesson.format === 'mixed' ? '' : 'Кабинет не указан')].filter(Boolean).join(' · ');
  const notes = [];
  for (const [index, person] of (lesson.students ?? []).entries()) {
    for (const period of releaseIntervals(person)) {
      rows[index].annotations.push(`Участие снято с ${timeLabel(period.start)} до ${timeLabel(period.end)}`);
    }
  }
  if (!lesson.rosterComplete) notes.push('Состав участников уточняется');
  const checkOnline = attention && lesson.individual && !lesson.online && student?.physicalStatus === 'none';
  if (checkOnline) notes.push('Приход в школу пока не отмечен. Уточните, подключится ли ученик онлайн.');
  else if (attention) notes.push(`Требуют проверки: ${attention}`);
  const studentStatus = student && [
    !checkOnline && (student.needsAttention || ['arrival', 'departure'].includes(student.physicalStatus)) ? student.description : '',
    ...student.annotations.filter(note => !lesson.online || note !== 'По расписанию онлайн'),
  ].filter(Boolean).join(' · ');
  const actions = [{ label: 'Расписание', href: safeLink(lesson.href, 'https://rasp.platoniks.ru') }];
  if (student?.href) actions.push({ label: 'Посещаемость', href: student.href });
  if (canVcall && (lesson.online || lesson.format === 'mixed' || attention && lesson.individual)) actions.unshift(canVcall === 'join' ? { label:'Открыть комнаты',href:'#room' } : { label: 'Открыть V.CALL', href: '#lesson' });
  return { key: `lesson:${lesson.key}`, kind: 'lesson', audience: child ? 'child' : 'self',
    title: lesson.subject || 'Занятие', subtitle, notes,
    ...(student ? { singleStudent: true, studentStatus } : {}),
    priority: current && lesson.own ? 0 : current ? 5 : 15, tone: attention ? 'attention' : current ? 'current' : 'neutral',
    start: lesson.start, end: lesson.end, displayNumber: lesson.displayNumber ?? null, segment: lesson.segment,
    attentionCount: attention, detailCount: rows.length, detailLabel: 'Дети и подробности', actions, rows,
    metadata: [(lesson.teachers ?? []).join(', '), `${timeLabel(lesson.start)}–${timeLabel(lesson.end)}`].filter(Boolean) };
}

export function buildImportantView({ schedule, attendance, sources = {}, context = 'personal', canVcall = false, now = new Date(), expanded = false }) {
  const data = { schema: 1, serverTime: now.toISOString(), date: schoolDate.format(now), context,
    schoolAllowed: Boolean(schedule?.schoolAllowed || attendance?.schoolAllowed),
    children: schedule?.children ?? [], selectedChildId: schedule?.selectedChildId ?? null,
    clock: schedule?.clock ?? [], sources, items: [], daySummary: '', scheduleFingerprint: '', visible: true };
  const scheduleUsable = sources.schedule?.status === 'ready';
  const attendanceUsable = sources.attendance?.status === 'ready';
  const facts = new Map((attendanceUsable ? attendance?.students ?? [] : []).map(person => [id(person.id), person]));
  const lessons = (schedule?.lessons ?? []).filter(lesson => Number.isFinite(ms(lesson.start)) && ms(lesson.end) > ms(lesson.start));
  // Only a staff lesson's confirmed roster or source-confirmed assignments can bring a pupil into this view.
  const staff = (schedule?.roles ?? []).some(role => ['teacher', 'mentor', 'tutor', 'admin', 'staff'].includes(role));
  const primary = lessons.filter(lesson => lesson.own || lesson.contexts?.includes('child'));
  if (context === 'personal') {
    const current = primary.filter(lesson => ms(lesson.start) <= +now && ms(lesson.end) > +now);
    const future = primary.filter(lesson => ms(lesson.start) > +now).sort((a,b) => ms(a.start)-ms(b.start));
    const next = future.filter(lesson => !future.some(other => sameAudience(lesson, other) && ms(other.start) < ms(lesson.start)));
    for (const lesson of [...current, ...next]) {
      const roomAction = expanded && !lesson.own && lesson.contexts?.includes('child') ? false : canVcall;
      const item = lessonItem(lesson, facts, now, roomAction, staff && scheduleUsable && (lesson.own || lesson.contexts?.includes('assigned')));
      if (scheduleUsable && primary.some(other => other.key !== lesson.key && sameAudience(lesson, other) && overlaps(lesson, other))) {
        item.notes.unshift('В расписании есть пересекающееся занятие'); item.tone = 'attention';
      }
      data.items.push(item);
    }
    if (schedule?.state === 'unpublished') data.daySummary = 'Расписание на сегодня ещё не опубликовано';
    else if (scheduleUsable && schedule?.state === 'published') {
      const ownFlex=(schedule.events??[]).filter(event=>event.key?.startsWith('flex:teacher:') && Number.isFinite(ms(event.start)));
      const futureFlex=ownFlex.filter(event=>ms(event.start)>+now);
      const activeFlex=ownFlex.filter(event=>ms(event.start)<=+now && ms(event.end)>+now);
      const dayActivities=[...primary,...ownFlex];
      const remaining = future.length + futureFlex.length;
      const family = primary.some(lesson => !lesson.own && lesson.contexts?.includes('child'));
      const own = primary.some(lesson => lesson.own);
      const remainder = family && (own||ownFlex.length) ? `Сегодня далее: у вас ${future.filter(lesson=>lesson.own).length+futureFlex.length}, у ребёнка ${future.filter(lesson=>!lesson.own).length}`
        : `${family ? 'У ребёнка сегодня' : 'Сегодня'} осталось занятий: ${remaining}${current.length||activeFlex.length ? ' после текущего' : ''}`;
      data.daySummary = current.length || activeFlex.length || remaining ? remainder
        : dayActivities.length ? `Занятия по расписанию закончились в ${timeLabel(dayActivities.reduce((a,b) => ms(a.end)>ms(b.end)?a:b).end)}` : 'Сегодня собственных занятий по расписанию нет';
    }
    const assigned = new Map((schedule?.assignedStudents ?? []).map(person => [id(person.id), person]));
    // Attendance's assigned scope remains useful when the schedule service is unavailable.
    for (const studentId of attendance?.assignedIds ?? []) {
      const person = facts.get(id(studentId)); if (person) assigned.set(id(studentId), person);
    }
    if (assigned.size) {
      const checks = [], distribution = [];
      for (const [studentId, person] of assigned) {
        const own = lessons.filter(lesson => lesson.students?.some(student => id(student.id) === studentId));
        const onsite = own.filter(lesson => {
          const mode = lesson.students.find(student => id(student.id) === studentId)?.mode;
          return !lesson.online && !['online','mixed'].includes(mode) && (lesson.format !== 'mixed' || mode === 'onsite');
        });
        const first = onsite.reduce((a,b) => !a || ms(b.start)<ms(a.start) ? b : a, null);
        const relevant = onsite.filter(lesson => ms(lesson.end) > +now).sort((a,b) => ms(a.start)-ms(b.start));
        const fact = facts.get(studentId);
        const row = attendanceRow(person, fact, null, now);
        const absentNow = (fact?.absences ?? []).some(absence => ms(absence.start)<=+now && (!absence.end || ms(absence.end)>+now));
        if (scheduleUsable && relevant.length && !absentNow && row.physicalStatus !== 'conflict') {
          if (fact?.lastEvent?.type === 'departure') { row.needsAttention=true; row.annotations.push('По расписанию ещё есть очные занятия'); }
          if (!fact?.lastEvent && fact && first && +now >= ms(first.start)+5*minute) { row.needsAttention=true; row.annotations.push(`Первое очное занятие с ${timeLabel(first.start)}`); }
        }
        if (row.needsAttention) checks.push(row);
        const active = own.filter(lesson => ms(lesson.start)<=+now && ms(lesson.end)>+now);
        distribution.push({ ...row, needsAttention:false, description: !scheduleUsable ? 'Расписание не обновлено' : active.length
          ? active.map(lesson => `${lesson.subject} · ${lesson.online ? 'онлайн' : lesson.rooms?.join(', ') || 'кабинет не указан'}`).join('; ')
          : own.length ? 'Сейчас нет занятия по расписанию' : 'Нет данных о занятиях на сегодня' });
      }
      if (checks.length) data.items.push({ key:'assigned:checks',kind:'assigned',title:`У ваших подопечных требуют проверки: ${checks.length}`,subtitle:'По отметкам посещаемости',priority:20,tone:'attention',rows:checks,detailCount:checks.length,attentionCount:checks.length,detailLabel:'Посмотреть',actions:[] });
      if (scheduleUsable) data.items.push({ key:'assigned:distribution',kind:'distribution',title:'Подопечные сейчас по расписанию',subtitle:`Учеников: ${assigned.size}`,priority:70,tone:'neutral',rows:distribution,detailCount:distribution.length,detailLabel:'Где занятия',actions:[] });
    }
    if (attendance?.shift) {
      const shift = attendance.shift;
      data.items.push({key:'shift',kind:'shift',title:shift.status==='scheduled'?'Ваша смена':shift.status==='unpublished'?'График смен ещё не опубликован':'Сегодня смена не назначена',subtitle:shift.start?`${timeLabel(shift.start)}–${timeLabel(shift.end)}`:'',start:shift.start,end:shift.end,priority:60,tone:'neutral',actions:[{label:'Мой график',href:'https://stud.platoniks.ru/attendance/mentor-schedule?view=me'}]});
    }
  } else if (attendanceUsable) {
    for (const summary of attendance?.summary ?? []) if (summary.count > 0) data.items.push({key:`attendance:${summary.kind}`,kind:'attendance',title:summary.kind==='conflicts'?'Противоречащие отметки посещаемости':'Отсутствия требуют уточнения',subtitle:`Учеников: ${summary.count} · записей: ${summary.records}`,recordCount:summary.records,priority:20,tone:'attention',detailCount:summary.count,detailLabel:'Посмотреть',remoteDetail:summary.kind,actions:[{label:'Посещаемость',href:'https://stud.platoniks.ru/attendance'}]});
  }
  for (const event of scheduleUsable ? schedule?.events ?? [] : []) {
    if (event.end && ms(event.end) <= +now) continue;
    const {detailKey,before,after,studentId,...publicEvent}=event;
    if(event.key?.startsWith('flex:teacher:') && ms(event.start)<=+now && ms(event.end)>+now)publicEvent.priority=0;
    const informationalFlex = context === 'personal' && (event.key?.startsWith('flex:teacher:') || event.priority === 25 && event.kind === 'flex');
    data.items.push({...publicEvent,remoteScheduleDetail:detailKey,detailLabel:'Подробнее',subtitle:event.detail || (event.count ? `Записей: ${event.count}` : ''),tone:event.priority<=30&&!informationalFlex?'attention':'neutral',actions:[{label:'Открыть',href:safeLink(event.href,'https://rasp.platoniks.ru')}],rows:undefined});
  }
  const deduplicated = new Map();
  for (const item of data.items) if (!deduplicated.has(item.key)) deduplicated.set(item.key,item);
  data.items = [...deduplicated.values()].sort((a,b) => a.priority-b.priority || (ms(a.start)||0)-(ms(b.start)||0) || a.key.localeCompare(b.key));
  data.scheduleFingerprint = scheduleUsable ? crypto.createHash('sha256').update(JSON.stringify({ state:schedule?.state, lessons:schedule?.lessons, clock:schedule?.clock })).digest('hex') : '';
  if (!data.items.length && !primary.length && schedule?.state==='published' && !schedule?.roles?.some(role=>['teacher','student','parent','mentor','tutor','admin','report_viewer'].includes(role)) && !attendance?.shift) data.visible=false;
  return data;
}

function validateQuery(query) {
  const context = query.context ?? 'personal';
  if (!['personal','school'].includes(context)) throw Object.assign(new Error('invalid_context'),{status:400});
  const childId = query.childId == null || query.childId === '' ? null : Number(query.childId);
  if (childId !== null && (!Number.isSafeInteger(childId)||childId<=0)) throw Object.assign(new Error('invalid_child'),{status:400});
  return { context, childId };
}

async function addLessonContacts(items, schedule, loadContactContext) {
  const lessonItems = items.filter(item => item.kind === 'lesson');
  if (!lessonItems.length) return;
  const { classes = [], staffNames = [] } = await loadContactContext() ?? {};
  const namesById = new Map(classes.map(row => [Number(row.classId), row.name]));
  const lessons = new Map((schedule.lessons ?? []).map(lesson => [`lesson:${lesson.key}`, lesson]));
  const roles = schedule.roles ?? [];
  const canUsePlannedClasses = !roles.includes('student') && roles.some(role => ['teacher', 'mentor', 'tutor', 'admin', 'staff'].includes(role));
  for (const item of lessonItems) {
    const lesson = lessons.get(item.key);
    if (!lesson) continue;
    const classNames = (lesson.students ?? []).map(student => namesById.get(Number(student.classId)));
    if (canUsePlannedClasses && lesson.own) classNames.push(...(lesson.classes ?? []));
    const contacts = contactsForClasses(classNames, staffNames);
    if (Object.keys(contacts).length) item.contacts = contacts;
  }
}

export function createImportantService({
  env=process.env, fetchImpl=fetch, now=()=>new Date(), getRights, getClassContactContext, getFamilyScope,
  canUseVcall=async()=>false, getVcallLessonStatus, loadOrders,
}={}) {
  const cache = new Map();
  const pilotIds = new Set(String(env.IMPORTANT_EXPANDED_PILOT_IDS ?? '').split(',').map(value => value.trim()).filter(Boolean));
  const expandedFor = actorId => env.IMPORTANT_EXPANDED_ENABLED === '1' || pilotIds.has(String(actorId));
  let contactContext;
  function loadContactContext() {
    if (!contactContext || +now() >= contactContext.expires) {
      const value = Promise.resolve().then(getClassContactContext).catch(() => ({}));
      contactContext = { value, expires: +now() + 60_000 };
    }
    return contactContext.value;
  }
  async function sourceRequest(source, actorId, rightsKey, context, childId, studentIds=[], detail=null, offset=0, options={}) {
    const date = options.date ?? schoolDate.format(now());
    const sourceName = source.toUpperCase();
    const base = source==='schedule' ? env.MAINPORTAL_SCHEDULE_URL || 'http://127.0.0.1:3011'
      : source==='attendance' ? env.MAINPORTAL_ATTENDANCE_URL || 'http://127.0.0.1:789'
      : env[`MAINPORTAL_${sourceName}_URL`];
    const secret = source==='schedule' ? env.MAINPORTAL_SCHEDULE_TOKEN
      : source==='attendance' ? env.ATTENDANCE_MAINPORTAL_SERVICE_KEY : env[`MAINPORTAL_${sourceName}_KEY`];
    if (!secret || !base) return {status:'unconfigured',data:null,checkedAt:null};
    const { expanded, fresh, scheduleScope, lessonRefs, returns } = options;
    const key = JSON.stringify([source,actorId,rightsKey,date,context,childId,studentIds,detail,offset,
      Boolean(expanded),scheduleScope ?? null,lessonRefs ?? null,returns ?? null]);
    const entry = fresh ? null : cache.get(key);
    if (entry?.pending) return entry.pending;
    if (entry && +now()-entry.checked<5000) return entry.value;
    const pending = (async()=>{
      const headers = {Accept:'application/json'};
      if (entry?.etag && entry.value?.data) headers['If-None-Match']=entry.etag;
      let value, etag=entry?.etag;
      try {
        let url, body;
        if (source==='schedule') {
          url = new URL('/internal/integrations/mainportal/v1/context',base);
          url.search = new URLSearchParams({actor_id:String(actorId),date,context,...(childId?{child_id:String(childId)}:{}),
            ...(detail?{detail,offset:String(offset)}:{}),...(expanded?{expanded:'1'}:{})}).toString();
          headers.Authorization=`Bearer ${secret}`;
        } else {
          url = new URL('/internal/v1/mainportal/context',base);
          body=JSON.stringify(source==='attendance'
            ? {actorId,date,context,studentIds,...(detail?{detail,offset}:{}),...(expanded?{expanded:true,scheduleScope}: {})}
            : {schema:1,actorId,date,context,childId,lessonRefs:lessonRefs ?? [],returns:returns ?? []});
          const timestamp=String(+now());
          headers['Content-Type']='application/json';headers['x-service-name']='mainportal';headers['x-service-timestamp']=timestamp;
          headers['x-service-signature']=crypto.createHmac('sha256',secret).update(`${timestamp}\n${body}`).digest('hex');
        }
        const response=await fetchImpl(url,{method:body?'POST':'GET',headers,body,signal:AbortSignal.timeout(expanded?3000:6000),redirect:'error'});
        const checkedAt=now().toISOString();
        if (response.status===304 && entry?.value?.data) value={status:'ready',data:entry.value.data,checkedAt};
        else if ([401,403].includes(response.status)) {value={status:'forbidden',data:null,checkedAt};etag=null;}
        else if (!response.ok) throw new Error('source_unavailable');
        else {
          const data=await response.json();
          if (data?.schema!==1||data.date!==date) throw new Error('invalid_source_response');
          value={status:'ready',data,checkedAt};etag=response.headers.get('etag');
        }
      } catch {
        const previous=entry?.value;
        const stillRecent=!expanded && previous?.checkedAt && +now()-ms(previous.checkedAt)<=120000;
        value={status:'unavailable',data:stillRecent?previous.data:null,checkedAt:previous?.checkedAt ?? null};
      }
      if (!fresh) {
        if (cache.size>=250) cache.delete(cache.keys().next().value);
        cache.set(key,{value,etag,checked:+now()});
      }
      return value;
    })();
    if (!fresh) cache.set(key,{...entry,pending});
    return pending;
  }
  const rightsCacheKey = rights => JSON.stringify(rights.map(row => [Number(row.srv_id), Number(row.role_id)])
    .sort((a,b)=>a[0]-b[0]||a[1]-b[1]));
  async function extraContext(source, actorId, rightsKey, context, childId, options) {
    const response = await sourceRequest(source,actorId,rightsKey,context,childId,[],null,0,options);
    if (!childId || response.status !== 'forbidden' || context !== 'personal') return response;
    const fallback = await sourceRequest(source,actorId,rightsKey,context,null,[],null,0,options);
    if (fallback.status !== 'ready') return fallback;
    const data = fallback.data;
    return {...fallback,data:{...data,partial:true,
      events:(data.events ?? []).filter(event=>event.studentId==null),
      items:(data.items ?? []).filter(item=>item.audience!=='child' && item.kind!=='progress_published'),
    }};
  }
  function roomRole(lesson, actorId, capability, roles) {
    const online = lesson?.online || lesson?.format === 'mixed';
    if (!online || new Date(lesson.start).getTime() - +now() > 5 * minute || ms(lesson.end) <= +now()) return null;
    if (capability === 'host' && roles.includes('teacher') && lesson.own && lesson.teacherIds?.map(Number).includes(actorId)) return 'host';
    const at=Math.max(ms(lesson.start),+now());
    if (roles.includes('student') && lesson.own && lesson.students?.some(student => Number(student.id) === actorId &&
      (student.mode === 'online' || lesson.online && student.mode !== 'onsite') &&
      !releaseIntervals(student).some(period => ms(period.start) <= at && ms(period.end) > at))) return 'participant';
    return null;
  }
  async function load(session, query={}, { rooms = false } = {}) {
    if (!enabled(env)) throw Object.assign(new Error('disabled'),{status:404});
    const actorId=Number(session?.uid);
    if (!Number.isSafeInteger(actorId)||actorId<=0) throw Object.assign(new Error('authentication_required'),{status:401});
    const { context, childId: requestedChildId } = validateQuery(query);
    const [rights, family] = await Promise.all([
      getRights(actorId), context === 'personal' ? getFamilyScope?.(actorId) : null,
    ]);
    if (context === 'personal' && getFamilyScope && requestedChildId &&
        !family?.children.some(child => child.id === requestedChildId)) {
      throw Object.assign(new Error('child_forbidden'), { status: 403 });
    }
    const preference = session.familyChild?.parentId === actorId ? session.familyChild.childId : null;
    const selectedChildId = context === 'personal'
      ? requestedChildId ?? selectedFamilyChild(family?.children ?? [], preference)?.id ?? null
      : null;
    const sourceChild = source => getFamilyScope && !hasFamilyServiceRight(source, rights) ? null : selectedChildId;
    const childId = sourceChild('schedule');
    const rightsKey=rightsCacheKey(rights);
    const expanded=expandedFor(actorId);
    const date=schoolDate.format(now());
    const options={expanded,date,fresh:Boolean(family && !childId)};
    const schedule=await sourceRequest('schedule',actorId,rightsKey,context,childId,[],null,0,options);
    if (!getFamilyScope && childId && schedule.status==='forbidden') {
      throw Object.assign(new Error('child_forbidden'), { status: 403 });
    }
    const scheduleData = getFamilyScope && !childId && schedule.data?.selectedChildId
      ? { ...schedule.data, lessons: (schedule.data.lessons ?? []).filter(lesson => lesson.own || !lesson.contexts?.includes('child')),
        children: [], selectedChildId: null }
      : schedule.data;
    const staff=(scheduleData?.roles??[]).some(role=>['teacher','mentor','tutor','admin','staff'].includes(role));
    const allowed = new Set((staff ? scheduleData?.lessons??[]:[]).filter(lesson=>lesson.own||lesson.contexts?.includes('assigned')).flatMap(lesson=>(lesson.students??[]).map(person=>id(person.id))));
    for (const person of scheduleData?.assignedStudents??[]) allowed.add(id(person.id));
    const attendanceRoles=rights.filter(row=>Number(row.srv_id)===Number(env.ATTENDANCE_SSO_SERVICE_ID||13)).map(row=>Number(row.role_id));
    const denied={status:'forbidden',data:null,checkedAt:null};
    const scope=scheduleData?.attendanceScope;
    const requestedIds=expanded && !scope ? [] : [...allowed].sort().map(Number);
    const attendanceRequest=attendanceRoles.some(role=>[2,3,4,5].includes(role))
      ? sourceRequest('attendance',actorId,rightsKey,context,null,requestedIds,null,0,{...options,scheduleScope:scope})
      : denied;
    const extra = expanded ? Object.fromEntries(['calendar','progress'].map(source => [source,
      extraContext(source,actorId,rightsKey,context,sourceChild(source) ?? (getFamilyScope ? null : scheduleData?.selectedChildId) ?? null,options)])) : {};
    const ordersRequest = rooms && context === 'personal' && loadOrders &&
      rights.some(right => Number(right.srv_id) === 12 && Number(right.role_id) > 0)
      ? loadOrders(actorId) : null;
    const [attendance, capability, extraResponses, orders] = await Promise.all([
      attendanceRequest, canUseVcall({...session,right:rights},{expanded}),
      Promise.all(Object.entries(extra).map(async ([source, result]) => [source, await result])),
      ordersRequest,
    ]);
    if (context==='school' && schedule.status==='forbidden' && attendance.status==='forbidden' &&
        !extraResponses.some(([, result]) => result.data?.schoolAllowed === true && result.status === 'ready')) {
      throw Object.assign(new Error('school_forbidden'),{status:403});
    }
    let attendanceData = attendance.data;
    if (context==='personal' && attendance.data) {
      const sourceAssigned=new Set((attendance.data.assignedIds??[]).map(id));
      attendanceData={...attendance.data,students:(attendance.data.students??[]).filter(person=>allowed.has(id(person.id))||sourceAssigned.has(id(person.id)))};
    }
    const viewNow=now();
    const readySchedule=schedule.status === 'ready' ? scheduleData : null;
    const readyAttendance=attendance.status === 'ready' ? attendanceData : null;
    const requestDiary=expanded && context==='personal'
      ? sourceRequest('diary',actorId,rightsKey,context,sourceChild('diary') ?? (getFamilyScope ? null : scheduleData?.selectedChildId) ?? null,[],null,0,{
        ...options, lessonRefs:lessonReferences(readySchedule,viewNow),returns:returnPeriods(readySchedule,readyAttendance,viewNow),
      }) : null;
    const vcallTargets=expanded && rooms && context==='personal' && getVcallLessonStatus
      ? (readySchedule?.lessons ?? []).flatMap(lesson => {
        const kind=roomRole(lesson,actorId,capability,readySchedule.roles ?? []);
        return kind ? [{lesson,kind}] : [];
      }).slice(0,6) : [];
    const [diary, roomEntries] = await Promise.all([
      requestDiary, Promise.all(vcallTargets.map(async ({lesson,kind}) => [
        lesson.key, { key:lesson.key,kind,status:await getVcallLessonStatus(lesson).catch(()=>'unavailable') },
      ])),
    ]);
    const sourceResults={schedule,attendance,...Object.fromEntries(extraResponses),...(diary?{diary}:{})};
    if (getFamilyScope && context === 'personal') {
      for (const source of ['calendar', 'progress', 'diary']) {
        const result = sourceResults[source];
        if (!result?.data || sourceChild(source)) continue;
        sourceResults[source] = { ...result, data: { ...result.data,
          events: (result.data.events ?? []).filter(event => event.studentId == null),
          items: (result.data.items ?? []).filter(item => item.audience !== 'child' && item.kind !== 'progress_published'),
        } };
      }
    }
    const sources=Object.fromEntries(Object.entries(sourceResults).map(([key,value])=>[key,{
      status:value.status,checkedAt:value.checkedAt,label:sourceTitles[key],partial:Boolean(
        value.data?.partial === true || value.data?.unavailableFeatures?.some(feature=>!['history_truncated','weekly_coverage'].includes(feature)) ||
        value.data?.coverage?.complete===false),
    }]));
    const view=buildImportantView({schedule:scheduleData,attendance:attendanceData,sources,context,now:viewNow,canVcall:capability,expanded});
    if (getFamilyScope && family) {
      view.children = family.children;
      view.selectedChildId = selectedChildId;
    }
    if (schedule.status === 'forbidden' && attendance.status === 'forbidden' &&
        !Object.values(sources).some(source => source.status === 'ready')) view.visible = false;
    if (expanded) {
      const integrated=Object.fromEntries(Object.entries(sourceResults).filter(([key,value])=>key!=='schedule' && value.status==='ready')
        .map(([key,value])=>[key,value.data]));
      view.schoolAllowed ||= Object.values(integrated).some(source=>source?.schoolAllowed===true);
      expandImportantView(view,{schedule:readySchedule,attendance:readyAttendance,integrated,now:viewNow,vcallRooms:Object.fromEntries(roomEntries)});
    }
    if (orders?.items.length) {
      view.orders = orders;
      view.visible = true;
    }
    return {view,actorId,rightsKey,schedule:readySchedule,options,scope,childId};
  }
  return {
    enabled:()=>enabled(env),
    async previewSource(actorId, source, childId) {
      if (!['schedule', 'diary', 'attendance', 'calendar', 'progress'].includes(source)) {
        return { state: 'permissions_only' };
      }
      const date = schoolDate.format(now());
      const rights = await getRights(actorId);
      const rightsKey = rightsCacheKey(rights);
      if (source === 'attendance' && !rights.some(right =>
        Number(right.srv_id) === Number(env.ATTENDANCE_SSO_SERVICE_ID || 13) && [2, 3, 4, 5].includes(Number(right.role_id))
      )) return { state: 'permissions_only' };
      const options = { date, expanded: true, fresh: true };
      const request = (name, extra = {}, studentIds = []) => sourceRequest(name, actorId, rightsKey, 'personal',
        hasFamilyServiceRight(name, rights) ? childId : null, studentIds, null, 0, { ...options, ...extra });
      let schedule;
      if (source === 'diary' || source === 'attendance') {
        schedule = await request('schedule');
      }
      const attendanceScope = schedule?.data?.attendanceScope;
      const staffRoster = new Set();
      if (source === 'attendance' && attendanceScope) {
        const roster = (schedule.data.lessons ?? []).filter(lesson => lesson.own || lesson.contexts?.includes('assigned'))
          .flatMap(lesson => lesson.students ?? []);
        for (const student of [...roster, ...(schedule.data.assignedStudents ?? [])]) staffRoster.add(Number(student.id));
      }
      const result = await request(source, {
        lessonRefs: source === 'diary' ? lessonReferences(schedule?.data, now()) : undefined,
        scheduleScope: source === 'attendance' ? attendanceScope : undefined,
      }, [...staffRoster]);
      const payload = result.status === 'ready' ? result.data : null;
      if (!payload) return { state: result.status, date };
      const entries = (payload.items ?? []).map(item => ({ title: item.title, detail: item.subtitle }));
      if (source === 'schedule') {
        for (const lesson of payload.lessons ?? []) {
          entries.push({ title: lesson.subject || 'Занятие', detail: [
            timeLabel(lesson.start), (lesson.rooms ?? []).join(', '),
          ].filter(Boolean).join(' · ') });
        }
      } else if (source === 'calendar') {
        for (const event of payload.events ?? []) {
          entries.push({ title: event.title, detail: [event.start?.slice(0, 10), timeLabel(event.start)].filter(Boolean).join(' · ') });
        }
      } else if (source === 'diary') {
        const lessonNames = new Map((schedule?.data?.lessons ?? []).map(lesson => [String(lesson.key), lesson.subject]));
        for (const lesson of payload.lessons ?? []) {
          if (lesson.topic) entries.push({ title: lessonNames.get(String(lesson.key)) || 'Тема урока', detail: lesson.topic });
        }
      } else if (source === 'attendance') {
        if (payload.shift?.start) entries.push({ title: 'Смена', detail: timeLabel(payload.shift.start) });
        const assigned = new Set((payload.assignedIds ?? []).map(Number));
        for (const studentId of staffRoster) assigned.add(studentId);
        for (const student of (payload.students ?? []).filter(student => assigned.has(Number(student.id)))) {
          entries.push({ title: student.name, detail: attendanceRow(student, student, null, now()).description });
        }
      }
      return {
        state: 'ready',
        date,
        entries: entries.filter(item => typeof item.title === 'string' && item.title).slice(0, 30)
          .map(item => ({ title: item.title.slice(0, 240), detail: String(item.detail ?? '').slice(0, 300) })),
      };
    },
    async vcallLesson(session,key) {
      const actorId=Number(session?.uid);
      if (!Number.isSafeInteger(actorId)||actorId<=0) throw Object.assign(new Error('authentication_required'),{status:401});
      if (!enabled(env)||!expandedFor(actorId)) throw Object.assign(new Error('disabled'),{status:404});
      if (typeof key!=='string'||!key||key.length>500) throw Object.assign(new Error('invalid_lesson'),{status:400});
      const rights=await getRights(actorId);
      const [response, capability]=await Promise.all([
        sourceRequest('schedule',actorId,rightsCacheKey(rights),'personal',null,[],null,0,{expanded:true,fresh:true}),
        canUseVcall({...session,right:rights},{expanded:true}),
      ]);
      if (!['ready','forbidden'].includes(response.status)) throw Object.assign(new Error('schedule_unavailable'),{status:503});
      const lesson=response.data?.lessons?.find(item=>item.key===key);
      const kind=lesson && roomRole(lesson,actorId,capability,response.data.roles ?? []);
      if (!kind) throw Object.assign(new Error('lesson_forbidden'),{status:403});
      return {lesson,kind,actorId};
    },
    async summary(session,query) {
      const {view,schedule}=await load(session,query,{rooms:true});
      if (schedule && view.context === 'personal') {
        await addLessonContacts(view.items, schedule, loadContactContext);
      }
      const items = view.items.map(({rows,detailActions,remoteDetail,remoteScheduleDetail,...item}) => ({
        ...item,
        ...(item.singleStudent && detailActions?.length ? { actions: [...item.actions, ...detailActions] } : {}),
        remoteDetails: Boolean(remoteDetail || remoteScheduleDetail),
        detailRevision: crypto.createHash('sha256').update(JSON.stringify([rows ?? [], detailActions ?? []])).digest('hex'),
      }));
      return { ...view, items };
    },
    async details(session,query) {
      const offset=Number(query.offset??0);
      if (!Number.isSafeInteger(offset)||offset<0||offset>100000||typeof query.key!=='string'||query.key.length>1000) throw Object.assign(new Error('invalid_details'),{status:400});
      const {view,actorId,rightsKey,options,scope,childId}=await load(session,query);
      const item=view.items.find(item=>item.key===query.key);
      if (!item) throw Object.assign(new Error('item_not_found'),{status:404});
      let rows=item.rows??[],total;
      if (item.remoteScheduleDetail) {
        const { context } = view;
        const source=await sourceRequest('schedule',actorId,rightsKey,context,childId,[],item.remoteScheduleDetail,offset,options);
        if(source.status!=='ready') throw Object.assign(new Error('details_unavailable'),{status:503});
        rows=(source.data.detailRows??[]).map(row=>({...row,href:safeLink(row.href,'https://rasp.platoniks.ru')}));total=source.data.detailTotal??0;
      } else if (item.remoteDetail) {
        const source=await sourceRequest('attendance',actorId,rightsKey,'school',null,[],item.remoteDetail,offset,{...options,scheduleScope:scope});
        if(source.status!=='ready') throw Object.assign(new Error('details_unavailable'),{status:503});
        rows=(source.data.students??[]).map(person=>attendanceRow(person,person,null,now()));total=source.data.total;
      } else {
        const search=String(query.q??'').trim().toLocaleLowerCase('ru-RU').slice(0,100);
        if(query.filter==='attention')rows=rows.filter(row=>row.needsAttention);
        if(search)rows=rows.filter(row=>row.name.toLocaleLowerCase('ru-RU').includes(search));
        rows.sort((a,b)=>Number(b.needsAttention)-Number(a.needsAttention)||a.name.localeCompare(b.name,'ru'));
        total=rows.length;rows=rows.slice(offset,offset+50);
      }
      return {key:item.key,metadata:item.metadata??[],...(item.detailActions?.length?{actions:item.detailActions}:{}),
        rows,total,offset,nextOffset:rows.length===50 && offset+rows.length<total?offset+rows.length:null,serverTime:now().toISOString()};
    },
  };
}

export function registerImportantRoutes(app,service) {
  for(const [path,method] of [['/api/important','summary'],['/api/important/details','details']]) app.get(path,async(req,res)=>{
    res.set('Cache-Control','private, no-cache');res.set('Vary','Cookie');
    try {
      const data=await service[method](req.session,req.query);
      if (data.orders) res.set('Cache-Control','private, no-store');
      const etag=`"${crypto.createHash('sha256').update(JSON.stringify({...data,serverTime:undefined,sources:method==='summary'?Object.fromEntries(Object.entries(data.sources).map(([name,s])=>[name,{...s,checkedAt:undefined}])):undefined})).digest('hex')}"`;
      res.set('ETag',etag);res.set('X-Server-Time',data.serverTime);res.set('X-Checked-At',data.serverTime);
      if(req.headers['if-none-match']===etag)return res.status(304).end();
      return res.json(data);
    }catch(error){return res.status(error.status||503).json({error:error.status?error.message:'important_unavailable'});}
  });
}
