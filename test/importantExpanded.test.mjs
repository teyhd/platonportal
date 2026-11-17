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

test('Diary input distinguishes incomplete and empty roster', () => {
  const [known, unknown] = lessonReferences({ lessons: [{ ...lesson, students: [] }, { ...lesson, rosterComplete: false }] });
  assert.deepEqual(known.studentIds, []);
  assert.equal(unknown.studentIds, undefined);
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
