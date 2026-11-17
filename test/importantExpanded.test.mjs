import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { buildImportantView, createImportantService } from '../vendor/important.mjs';
import { expandImportantView, lessonReferences, workdayPreview } from '../vendor/important-expanded.mjs';
import { createImportantVcall } from '../vendor/important-vcall.mjs';

const now = new Date('2026-11-17T08:00:00+03:00');
const date = '2026-11-17';
const tomorrow = '2026-11-18';
const at = (time, day = date) => `${day}T${time}:00+03:00`;
const planned = (day, begin, finish, href = '/schedule/my') =>
  ({ date: day, status: 'scheduled', start: at(begin, day), end: at(finish, day), href });
const lesson = {
  key: 'math:class', entryId: 17, versionId: 70, date, start: at('08:55'), end: at('09:35'),
  own: true, subject: 'Математика', rosterComplete: true, online: true,
  teacherIds: [42], subjectIds: [5], students: [{ id: 11, name: 'Ученик', mode: 'online' }],
  contexts: ['own'], href: '/schedule/my',
};

test('workday uses separately scoped shift and first lesson and rolls over in Moscow', () => {
  const schedule = { workday: [planned(date, '08:30', '15:00'), planned(tomorrow, '10:00', '15:00')] };
  const attendance = { workday: [planned(date, '09:00', '17:00', '/attendance/mentor-schedule'),
    planned(tomorrow, '09:00', '17:00', '/attendance/mentor-schedule')] };
  const [today, next] = workdayPreview(schedule, attendance, now);
  assert.deepEqual(today.entries.map(item => item.kind), ['lesson', 'shift']);
  assert.deepEqual(next.entries.map(item => item.kind), ['shift', 'lesson']);
  const [rolled] = workdayPreview(schedule, attendance, new Date('2026-11-17T21:00:00Z'));
  assert.equal(rolled.date, tomorrow);
  assert.equal(rolled.entries[0].start, at('09:00', tomorrow));
});

test('workday preserves unknown and ignores a wrongly dated source fact', () => {
  const schedule = { workday: [{ ...planned(date, '09:00', '17:00'), date: tomorrow }] };
  const attendance = { workday: [{ date, status: 'unavailable' }] };
  const [today, next] = workdayPreview(schedule, attendance, now);
  assert.deepEqual(today.pending, [{ kind: 'shift', status: 'unavailable' }]);
  assert.deepEqual(next.entries, []);
});

test('the first lesson uses its own time and links even when a shift or Flex starts earlier', () => {
  const firstLesson = {
    start: at('10:00',tomorrow), subject:'Математика', format:'onsite',
    classes:['5-1'], rooms:['204'], studentName:'Иванов Иван Иванович',
    href:'/schedule/my?date=2026-11-18&entry_id=17',
  };
  const schedule = { workday:[{ ...planned(tomorrow,'09:15','15:00'),
    firstLessons:[firstLesson,{ ...firstLesson,start:at('16:00',tomorrow) }] }] };
  const attendance = { workday:[planned(tomorrow,'09:00','17:00','/attendance/mentor-schedule')] };
  const [,next] = workdayPreview(schedule,attendance,now);
  assert.deepEqual(next.entries.map(item=>item.kind), ['shift','lesson']);
  assert.equal(next.entries[1].start,at('09:15',tomorrow));
  assert.deepEqual(next.entries[1].firstLessons,[{
    ...firstLesson, href:'https://rasp.platoniks.ru/schedule/my?date=2026-11-18&entry_id=17',
  }]);
});

test('weekly attendance renders known coverage without inferring lateness', () => {
  const view=buildImportantView({ now });
  const attendance={ weeklyCoverage:{ arrivalDays:63,coveredDays:0,complete:false } };
  expandImportantView(view,{ attendance,integrated:{ attendance },now });
  const weekly=view.items.find(item => item.kind==='weekly_attendance');
  assert.match(weekly.subtitle,/0 из 63/);
  assert.doesNotMatch(weekly.subtitle,/опоздан/);
});

test('Diary input distinguishes incomplete and empty roster', () => {
  const [known, unknown] = lessonReferences({ lessons: [{ ...lesson, students: [] }, { ...lesson, rosterComplete: false }] });
  assert.deepEqual(known.studentIds, []);
  assert.equal(unknown.studentIds, undefined);
});

test('Diary lesson budget is reserved for own and family lessons before mentee timetables', () => {
  const assigned = Array.from({ length:45 }, (_,index) => ({
    ...lesson, key:`assigned:${index}`, entryId:100+index, own:false, contexts:['assigned'],
  }));
  const family = { ...lesson, key:'family', own:false, contexts:['child'] };
  const refs = lessonReferences({ lessons:[...assigned,family,lesson] },now);
  assert.equal(refs.length,40);
  assert.deepEqual(refs.slice(0,2).map(ref=>ref.key),[lesson.key,family.key]);
});

test('own current and next lessons leave the third place for the most urgent action', () => {
  const own = { ...lesson, start:at('07:50'), end:at('08:40') };
  const ownNext = { ...lesson, key:'next', start:at('09:00'), end:at('09:45') };
  const family = { ...own, key:'family', own:false, contexts:['child'] };
  const familyNext = { ...ownNext, key:'family-next', own:false, contexts:['child'] };
  const schedule = { lessons:[own,family,ownNext,familyNext], state:'published' };
  const result=buildImportantView({ schedule, now, sources:{ schedule:{ status:'ready' } } });
  expandImportantView(result,{ schedule,now,integrated:{ progress:{ items:[
    { key:'tomorrow',kind:'progress_returned',title:'Доработать завтра',dueAt:at('12:00',tomorrow),actions:[{label:'Открыть',href:'/feedback?cardId=2'}] },
    { key:'today',kind:'progress_returned',title:'Доработать сегодня',dueAt:at('11:00'),actions:[{label:'Открыть',href:'/feedback?cardId=1'}] },
  ] } } });
  assert.deepEqual(result.items.slice(0,3).map(item=>item.key),[`lesson:${own.key}`,'lesson:next','progress:today']);
  assert.equal(result.items.find(item=>item.key==='lesson:family').audience,'child');
});

test('Progress groups drafts by exact due time with a direct link per report', () => {
  const drafts=Array.from({ length:160 }, (_,index)=>({
    key:`card:${index}`,kind:'progress_draft',title:'Ваш отчёт ждёт заполнения',
    subtitle:`Карточка ${index}`,dueAt:at('17:00'),actions:[{label:'Открыть',href:`/feedback?cardId=${index+1}`}],
  }));
  const separate={ ...drafts[0],key:'different',dueAt:at('18:00') };
  const result=buildImportantView({now});
  expandImportantView(result,{now,integrated:{progress:{items:[...drafts,drafts[0],separate]}}});
  const group = result.items.find(item=>item.kind==='progress_draft_group');
  assert.equal(group.detailCount,160);
  assert.equal(group.rows.at(-1).href,'https://rep.platoniks.ru/feedback?cardId=160');
  assert.match(group.subtitle,/17:00/);
  assert.equal(result.items.filter(item=>item.kind==='progress_draft').length,1);
});

test('schedule history shows verified room change without exposing source snapshots', () => {
  const before = { slotId:1, date, start:lesson.start, end:lesson.end, roomId:100, roomName:'204',
    teacherId:42, subjectId:5, studentIds:[11] };
  const after = { ...before, roomId:200, roomName:'318' };
  const schedule = { schema:1, date, state:'published', roles:['teacher'], lessons:[lesson],
    events:[{ key:'history:1', kind:'schedule_change', title:'Расписание изменено', changedAt:at('07:30'),
      before:[before], after:[after], href:'/schedule/my', priority:30 }] };
  const view = buildImportantView({ schedule, now, sources:{ schedule:{ status:'ready' } } });
  expandImportantView(view, { schedule, integrated:{}, now });
  const history = view.items.find(item => item.key === 'history:1');
  assert.equal(history.before, undefined);
  assert.equal(history.after, undefined);
  assert.match(history.notes[0], /204 → 318/);
  assert.equal(view.items[0].notes[0], 'Кабинет 204 → 318');
  assert.deepEqual(history.rows.map(row => row.name), ['Было', 'Стало']);
});

test('family Flex counts only for the selected child and family Calendar never occupies the adult', () => {
  const family = { ...lesson, key: 'child-lesson', own: false, contexts: ['child'],
    start: at('12:00'), end: at('13:00') };
  const schedule = { schema:1, date, state: 'published', roles: ['teacher', 'parent'], lessons: [lesson, family],
    selectedChildId: 11, children: [{ id: 11, name: 'Ученик' }],
    events: [
      { key:'flex1', kind:'flex', status:'assigned', studentId:11, start:at('15:00'), end:at('15:35') },
      { key:'flex2', kind:'flex', status:'assigned', studentId:12, start:at('16:00'), end:at('16:35') },
    ] };
  const calendar = { events: [
    { id: 1, relation:'participant', studentId:11, title:'Выезд', start:at('09:00'), end:at('09:20'), href:'/?event=1' },
    { id: 2, relation:'participant', studentId:11, title:'Выезд', start:at('12:15'), end:at('12:45'), href:'/?event=2' },
    { id: 3, relation:'responsible', studentId:null, title:'Встреча', start:at('09:15'), end:at('09:45'), href:'/?event=3' },
    { id: 4, relation:'responsible', studentId:null, title:'После урока', start:at('09:35'), end:at('09:45'), href:'/?event=4' },
  ] };
  const view = buildImportantView({ schedule, now, sources: { schedule: { status:'ready' } } });
  expandImportantView(view, { schedule, integrated:{ calendar }, now });
  assert.match(view.daySummary, /15:35/);
  assert.doesNotMatch(view.daySummary, /16:35/);
  assert.deepEqual(view.items.filter(item => item.kind === 'calendar_overlap').map(item => item.key),
    ['calendar:overlap:3:self', 'calendar:overlap:2:11']);
});

test('expanded sources sign exact JSON and remain off outside configured pilot IDs', async () => {
  const calls = [];
  const service = createImportantService({
    env: { IMPORTANT_ENABLED:'1', IMPORTANT_EXPANDED_PILOT_IDS:'42', MAINPORTAL_SCHEDULE_TOKEN:'schedule',
      ATTENDANCE_MAINPORTAL_SERVICE_KEY:'attendance', MAINPORTAL_DIARY_URL:'http://diary', MAINPORTAL_DIARY_KEY:'diary' },
    now: () => now, getRights: async () => [{ srv_id:13, role_id:2 }],
    fetchImpl: async (url, options) => {
      calls.push([url, options]);
      const data = url.pathname.includes('/integrations/') ? { schema:1, date, roles:['teacher'], lessons:[lesson],
        state:'published', attendanceScope:'scope', workday:[planned(date, '08:55', '09:35')] } :
        url.hostname === 'diary' ? { schema:1, date, lessons:[{ key:lesson.key, topic:'Циклы',
          materials:[{ label:'Материал', href:'/learning/homework' }, { label:'Чужой сайт', href:'https://example.org' }] }] } :
        { schema:1, date, students:[] };
      return Response.json(data);
    },
  });
  const ordinary = await service.summary({ uid:41 }, {});
  assert.equal(ordinary.workday, undefined);
  assert.equal(calls.some(([url]) => url.hostname === 'diary'), false);
  const pilot = await service.summary({ uid:42 }, {});
  assert.equal(pilot.workday[0].entries[0].start, at('08:55'));
  assert.match(pilot.items[0].notes.join(' '), /Циклы/);
  const diary = calls.find(([url]) => url.hostname === 'diary')[1];
  assert.equal(JSON.parse(diary.body).actorId, 42);
  assert.equal(diary.headers['x-service-signature'],
    createHmac('sha256','diary').update(`${diary.headers['x-service-timestamp']}\n${diary.body}`).digest('hex'));
  const attendance = calls.find(([url, option]) => url.port === '789' && JSON.parse(option.body).actorId === 42)[1];
  assert.equal(JSON.parse(attendance.body).scheduleScope, 'scope');
  const detail = await service.details({ uid:42 }, { key:`lesson:${lesson.key}` });
  assert.deepEqual(detail.actions, [{ label:'Материал', href:'https://diary.platoniks.ru/learning/homework' }]);
});

test('an unavailable linked child in Progress preserves employee tasks with a partial status', async () => {
  const service = createImportantService({
    env: { IMPORTANT_ENABLED:'1', IMPORTANT_EXPANDED_ENABLED:'1', MAINPORTAL_SCHEDULE_TOKEN:'schedule',
      MAINPORTAL_PROGRESS_URL:'http://progress', MAINPORTAL_PROGRESS_KEY:'progress' },
    now:()=>now, getRights:async()=>[],
    fetchImpl:async (url, options) => {
      if (url.hostname !== 'progress') return Response.json({schema:1,date,roles:['teacher','parent'],
        selectedChildId:11,children:[{id:11,name:'Выбранный ребёнок'}],lessons:[],state:'published'});
      if (JSON.parse(options.body).childId) return Response.json({}, { status:403 });
      return Response.json({ schema:1, date, items:[
        {key:'task1',kind:'progress_returned',title:'Свой отчёт',studentId:12},
        {key:'family2',kind:'progress_published',title:'Другой ребёнок',studentId:30},
      ] });
    },
  });
  const response=await service.summary({ uid:42 },{ childId:11 });
  assert.equal(response.sources.progress.status,'ready');
  assert.equal(response.sources.progress.partial,true);
  assert.deepEqual(response.items.map(item=>item.title),['Свой отчёт']);
});

test('room creation is per lesson and validates live occurrence and owner', async () => {
  const rooms = new Map();
  const joins = [];
  let creates = 0;
  const service = createImportantVcall({
    get_active_room: async id => rooms.get(id),
    readRoomAccess: info => info,
    create_room: async (id, _name, access) => {
      creates++;
      rooms.set(id, { room_info: { owner:access.portal_owner, occurrence:access.portal_occurrence, pub:access.pub, need_auth:access.need_auth } });
    },
    get_link: async (id, _name, actorId, admin) => { joins.push({ id, actorId, admin }); return { link:'https://meet.platoniks.ru/' }; },
  });
  const teacher = { uid: 42, name: 'Педагог' };
  const student = { uid: 11, name: 'Ученик' };
  assert.equal(await service.status(lesson), 'closed');
  assert.equal(await service.open(lesson, student), false);
  assert.deepEqual(await Promise.all([service.open(lesson, teacher), service.open(lesson, teacher)]), [true, true]);
  assert.equal(creates, 1);
  assert.equal(await service.status(lesson), 'active');
  assert.ok(await service.join(lesson, student, 'participant'));
  assert.equal(joins[0].admin, false);
  assert.equal(await service.join({ ...lesson, start:at('09:00') }, student, 'participant'), null);
  assert.equal(await service.join(lesson, student, 'host'), null);
  rooms.values().next().value.room_info.owner = 99;
  assert.equal(await service.status(lesson), 'unavailable');
});

test('scheduled room uses expanded capabilities and denies family-only or released participation', async () => {
  const released = { ...lesson, own:true, students:[{ ...lesson.students[0], releaseIntervals:[{start:at('08:50'),end:at('09:05')}] }] };
  let actorRoles = ['teacher','parent'];
  let activeLesson = lesson;
  const service = createImportantService({
    env:{ IMPORTANT_ENABLED:'1', IMPORTANT_EXPANDED_ENABLED:'1', MAINPORTAL_SCHEDULE_TOKEN:'schedule' },
    now:()=>new Date(at('08:52')), getRights:async()=>[],
    canUseVcall:async (_, capabilities)=>capabilities.expanded ? 'host' : false,
    fetchImpl:async()=>Response.json({schema:1,date,roles:actorRoles,lessons:[activeLesson]}),
  });
  assert.equal((await service.vcallLesson({uid:42},lesson.key)).kind,'host');
  actorRoles = ['parent'];
  activeLesson = { ...lesson, own:false, contexts:['child'] };
  await assert.rejects(service.vcallLesson({uid:21},lesson.key), {status:403});
  actorRoles = ['student'];
  activeLesson = released;
  await assert.rejects(service.vcallLesson({uid:11},lesson.key), {status:403});
});
