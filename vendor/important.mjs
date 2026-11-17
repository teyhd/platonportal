import crypto from 'node:crypto';

const schoolDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow' });
const clock = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' });
const minute = 60_000;
const id = value => String(value ?? '');
const unique = values => [...new Set(values)];
const ms = value => value ? Date.parse(value) : NaN;
const timeLabel = value => Number.isFinite(ms(value)) ? clock.format(new Date(value)) : '';
const overlaps = (a, b) => ms(a.start) < ms(b.end) && ms(b.start) < ms(a.end);
const sameAudience = (a, b) => a.own && b.own || !a.own && !b.own && a.contexts?.includes('child') && b.contexts?.includes('child');
const enabled = env => env.IMPORTANT_ENABLED === '1';
const sourceTitles = { schedule: 'Расписание', attendance: 'Посещаемость' };
const safeLink = (value, origin) => {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return origin;
  const parsed = new URL(value, origin);
  return parsed.origin === new URL(origin).origin ? parsed.href : origin;
};

export function attendanceRow(person, fact, lesson, now) {
  const row = { id: id(person.id), name: person.name || 'Ученик', className: fact?.className || '', description: 'Нет данных о посещаемости', needsAttention: false, annotations: [] };
  if (!fact) return row;
  row.href = `https://stud.platoniks.ru/attendance?class=${encodeURIComponent(fact.classId || person.classId || '')}&student=${encodeURIComponent(person.id)}&date=${schoolDate.format(now)}`;
  const end = lesson?.end ?? `${schoolDate.format(now)}T23:59:59+03:00`;
  const at = lesson ? Math.max(+now, ms(lesson.start)) : +now;
  const absences = (fact.absences ?? []).filter(absence => ms(absence.start) < ms(end) && (!absence.end || ms(absence.end) > at));
  const currentAbsence = absences.some(absence => ms(absence.start) <= at && (!absence.end || ms(absence.end) > at));
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
  const attention = rows.filter(row => row.needsAttention).length;
  const current = ms(lesson.start) <= +now && ms(lesson.end) > +now;
  const child = lesson.contexts?.includes('child') && !lesson.own;
  const subtitle = [child ? 'У ребёнка' : '', lesson.individual ? 'Индивидуальное занятие' : (lesson.classes ?? []).join(', '),
    lesson.format === 'mixed' ? 'Смешанный формат' : lesson.online ? 'Онлайн' : (lesson.rooms?.length ? `Кабинет ${lesson.rooms.join(', ')}` : 'Кабинет не указан')].filter(Boolean).join(' · ');
  const notes = [];
  if (!lesson.rosterComplete) notes.push('Состав участников уточняется');
  if (attention && lesson.individual && !lesson.online && rows[0]?.physicalStatus === 'none') notes.push('Приход в школу пока не отмечен. Уточните, подключится ли ученик онлайн.');
  else if (attention) notes.push(`Требуют проверки: ${attention}`);
  const actions = [{ label: 'Расписание', href: safeLink(lesson.href, 'https://rasp.platoniks.ru') }];
  if (canVcall && (lesson.online || lesson.format === 'mixed' || attention && lesson.individual)) actions.unshift(canVcall === 'join' ? { label:'Открыть комнаты',href:'#room' } : { label: 'Открыть V.CALL', href: '#lesson' });
  return { key: `lesson:${lesson.key}`, kind: 'lesson', title: lesson.subject || 'Занятие', subtitle, notes,
    priority: current && lesson.own ? 0 : current ? 5 : 15, tone: attention ? 'attention' : current ? 'current' : 'neutral',
    start: lesson.start, end: lesson.end, displayNumber: lesson.displayNumber ?? null, segment: lesson.segment,
    attentionCount: attention, detailCount: rows.length, detailLabel: 'Дети и подробности', actions, rows,
    metadata: [(lesson.teachers ?? []).join(', '), `${timeLabel(lesson.start)}–${timeLabel(lesson.end)}`].filter(Boolean) };
}

export function buildImportantView({ schedule, attendance, sources = {}, context = 'personal', canVcall = false, now = new Date() }) {
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
      const item = lessonItem(lesson, facts, now, canVcall, staff && scheduleUsable && (lesson.own || lesson.contexts?.includes('assigned')));
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
    for (const summary of attendance?.summary ?? []) if (summary.count > 0) data.items.push({key:`attendance:${summary.kind}`,kind:'attendance',title:summary.kind==='conflicts'?'Противоречащие отметки посещаемости':'Отсутствия требуют уточнения',subtitle:`Учеников: ${summary.count} · записей: ${summary.records}`,priority:20,tone:'attention',detailCount:summary.count,detailLabel:'Посмотреть',remoteDetail:summary.kind,actions:[{label:'Посещаемость',href:'https://stud.platoniks.ru/attendance'}]});
  }
  for (const event of scheduleUsable ? schedule?.events ?? [] : []) {
    if (event.end && ms(event.end) <= +now) continue;
    const {detailKey,...publicEvent}=event;
    if(event.key?.startsWith('flex:teacher:') && ms(event.start)<=+now && ms(event.end)>+now)publicEvent.priority=0;
    data.items.push({...publicEvent,remoteScheduleDetail:detailKey,detailLabel:'Подробнее',subtitle:event.detail || (event.count ? `Записей: ${event.count}` : ''),tone:event.priority<=30?'attention':'neutral',actions:[{label:'Открыть',href:safeLink(event.href,'https://rasp.platoniks.ru')}],rows:undefined});
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

export function createImportantService({ env=process.env, fetchImpl=fetch, now=()=>new Date(), getRights, canUseVcall=async()=>false }={}) {
  const cache = new Map();
  async function sourceRequest(source, actorId, rightsKey, context, childId, studentIds=[], detail=null, offset=0) {
    const date = schoolDate.format(now());
    const base = source==='schedule' ? env.MAINPORTAL_SCHEDULE_URL || 'http://127.0.0.1:3011' : env.MAINPORTAL_ATTENDANCE_URL || 'http://127.0.0.1:789';
    const secret = source==='schedule' ? env.MAINPORTAL_SCHEDULE_TOKEN : env.ATTENDANCE_MAINPORTAL_SERVICE_KEY;
    if (!secret) return {status:'unconfigured',data:null,checkedAt:null};
    const key = JSON.stringify([source,actorId,rightsKey,date,context,childId,studentIds,detail,offset]);
    const entry = cache.get(key);
    if (entry?.pending) return entry.pending;
    if (entry && +now()-entry.checked<5000) return entry.value;
    const pending = (async()=>{
      const headers = {Accept:'application/json'};
      let url, body;
      if (source==='schedule') {
        url = new URL('/internal/integrations/mainportal/v1/context',base);
        url.search = new URLSearchParams({actor_id:String(actorId),date,context,...(childId?{child_id:String(childId)}:{}),...(detail?{detail,offset:String(offset)}:{})}).toString();
        headers.Authorization=`Bearer ${secret}`;
      } else {
        url = new URL('/internal/v1/mainportal/context',base);
        body=JSON.stringify({actorId,date,context,studentIds,...(detail?{detail,offset}:{})});
        const timestamp=String(+now());
        headers['Content-Type']='application/json';headers['x-service-name']='mainportal';headers['x-service-timestamp']=timestamp;
        headers['x-service-signature']=crypto.createHmac('sha256',secret).update(`${timestamp}\n${body}`).digest('hex');
      }
      if (entry?.etag && entry.value?.data) headers['If-None-Match']=entry.etag;
      let value, etag=entry?.etag;
      try {
        const response=await fetchImpl(url,{method:body?'POST':'GET',headers,body,signal:AbortSignal.timeout(6000),redirect:'error'});
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
        const stillRecent=previous?.checkedAt && +now()-ms(previous.checkedAt)<=120000;
        value={status:'unavailable',data:stillRecent?previous.data:null,checkedAt:previous?.checkedAt ?? null};
      }
      if (cache.size>=250) cache.delete(cache.keys().next().value);
      cache.set(key,{value,etag,checked:+now()});
      return value;
    })();
    cache.set(key,{...entry,pending});
    return pending;
  }
  async function load(session, query={}) {
    if (!enabled(env)) throw Object.assign(new Error('disabled'),{status:404});
    const actorId=Number(session?.uid);
    if (!Number.isSafeInteger(actorId)||actorId<=0) throw Object.assign(new Error('authentication_required'),{status:401});
    const {context,childId}=validateQuery(query);
    const rights=await getRights(actorId);
    const rightsKey=JSON.stringify(rights.map(row=>[Number(row.srv_id),Number(row.role_id)]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]));
    const schedule=await sourceRequest('schedule',actorId,rightsKey,context,childId);
    if (childId && schedule.status==='forbidden') throw Object.assign(new Error('child_forbidden'),{status:403});
    const scheduleData=schedule.data;
    const staff=(scheduleData?.roles??[]).some(role=>['teacher','mentor','tutor','admin','staff'].includes(role));
    const allowed = new Set((staff ? scheduleData?.lessons??[]:[]).filter(lesson=>lesson.own||lesson.contexts?.includes('assigned')).flatMap(lesson=>(lesson.students??[]).map(person=>id(person.id))));
    for (const person of scheduleData?.assignedStudents??[]) allowed.add(id(person.id));
    const attendanceRoles=rights.filter(row=>Number(row.srv_id)===Number(env.ATTENDANCE_SSO_SERVICE_ID||13)).map(row=>Number(row.role_id));
    const attendance=attendanceRoles.some(role=>[2,3,4,5].includes(role))
      ? await sourceRequest('attendance',actorId,rightsKey,context,null,[...allowed].sort().map(Number))
      : {status:'forbidden',data:null,checkedAt:null};
    if (context==='school' && schedule.status==='forbidden' && attendance.status==='forbidden') throw Object.assign(new Error('school_forbidden'),{status:403});
    if (context==='personal' && attendance.data) {
      const sourceAssigned=new Set((attendance.data.assignedIds??[]).map(id));
      attendance.data={...attendance.data,students:(attendance.data.students??[]).filter(person=>allowed.has(id(person.id))||sourceAssigned.has(id(person.id)))};
    }
    const sources=Object.fromEntries(Object.entries({schedule,attendance}).map(([key,value])=>[key,{status:value.status,checkedAt:value.checkedAt,label:sourceTitles[key],partial:Boolean(value.data?.unavailableFeatures?.length)}]));
    const view=buildImportantView({schedule:scheduleData,attendance:attendance.data,sources,context,now:now(),canVcall:await canUseVcall({...session,right:rights})});
    if(schedule.status==='forbidden'&&attendance.status==='forbidden')view.visible=false;
    return {view,actorId,rightsKey,allowed};
  }
  return {
    enabled:()=>enabled(env),
    async summary(session,query) {
      const {view}=await load(session,query);
      return {...view,items:view.items.map(({rows,remoteDetail,remoteScheduleDetail,...item})=>({...item,remoteDetails:Boolean(remoteDetail||remoteScheduleDetail),detailRevision:crypto.createHash('sha256').update(JSON.stringify(rows??[])).digest('hex')}))};
    },
    async details(session,query) {
      const offset=Number(query.offset??0);
      if (!Number.isSafeInteger(offset)||offset<0||offset>100000||typeof query.key!=='string'||query.key.length>1000) throw Object.assign(new Error('invalid_details'),{status:400});
      const {view,actorId,rightsKey}=await load(session,query);
      const item=view.items.find(item=>item.key===query.key);
      if (!item) throw Object.assign(new Error('item_not_found'),{status:404});
      let rows=item.rows??[],total;
      if (item.remoteScheduleDetail) {
        const {context,childId}=validateQuery(query);
        const source=await sourceRequest('schedule',actorId,rightsKey,context,childId,[],item.remoteScheduleDetail,offset);
        if(source.status!=='ready') throw Object.assign(new Error('details_unavailable'),{status:503});
        rows=(source.data.detailRows??[]).map(row=>({...row,href:safeLink(row.href,'https://rasp.platoniks.ru')}));total=source.data.detailTotal??0;
      } else if (item.remoteDetail) {
        const source=await sourceRequest('attendance',actorId,rightsKey,'school',null,[],item.remoteDetail,offset);
        if(source.status!=='ready') throw Object.assign(new Error('details_unavailable'),{status:503});
        rows=(source.data.students??[]).map(person=>attendanceRow(person,person,null,now()));total=source.data.total;
      } else {
        const search=String(query.q??'').trim().toLocaleLowerCase('ru-RU').slice(0,100);
        if(query.filter==='attention')rows=rows.filter(row=>row.needsAttention);
        if(search)rows=rows.filter(row=>row.name.toLocaleLowerCase('ru-RU').includes(search));
        rows.sort((a,b)=>Number(b.needsAttention)-Number(a.needsAttention)||a.name.localeCompare(b.name,'ru'));
        total=rows.length;rows=rows.slice(offset,offset+50);
      }
      return {key:item.key,metadata:item.metadata??[],rows,total,offset,nextOffset:rows.length===50 && offset+rows.length<total?offset+rows.length:null,serverTime:now().toISOString()};
    },
  };
}

export function registerImportantRoutes(app,service) {
  for(const [path,method] of [['/api/important','summary'],['/api/important/details','details']]) app.get(path,async(req,res)=>{
    res.set('Cache-Control','private, no-cache');res.set('Vary','Cookie');
    try {
      const data=await service[method](req.session,req.query);
      const etag=`"${crypto.createHash('sha256').update(JSON.stringify({...data,serverTime:undefined,sources:method==='summary'?Object.fromEntries(Object.entries(data.sources).map(([name,s])=>[name,{...s,checkedAt:undefined}])):undefined})).digest('hex')}"`;
      res.set('ETag',etag);res.set('X-Server-Time',data.serverTime);res.set('X-Checked-At',data.serverTime);
      if(req.headers['if-none-match']===etag)return res.status(304).end();
      return res.json(data);
    }catch(error){return res.status(error.status||503).json({error:error.status?error.message:'important_unavailable'});}
  });
}
