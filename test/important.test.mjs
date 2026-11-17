import assert from 'node:assert/strict';
import test from 'node:test';
import { attendanceRow, buildImportantView, createImportantService, registerImportantRoutes } from '../vendor/important.mjs';
import { contactsForClasses } from '../vendor/important-class-contacts.mjs';

const now = new Date('2026-11-17T09:05:00+03:00');
const sources = {schedule:{status:'ready'},attendance:{status:'ready'}};
const child = {id:11,name:'Тестовый ученик',classId:7,mode:'onsite'};
const lesson = {key:'one',subject:'Математика',displayNumber:0,start:'2026-11-17T09:00:00+03:00',end:'2026-11-17T09:40:00+03:00',own:true,contexts:['own'],students:[child],rooms:['204'],classes:['7-1'],rosterComplete:true,individual:true,href:'/schedule/my'};
const schedule = {schema:1,date:'2026-11-17',state:'published',roles:['teacher'],lessons:[lesson],assignedStudents:[],events:[]};
const attendance = {schema:1,date:'2026-11-17',students:[{...child,lastEvent:null,absences:[],conflicts:0}],assignedIds:[]};
const view = (s=schedule,a=attendance,extra={}) => buildImportantView({schedule:s,attendance:a,sources,now,...extra});

test('current individual preserves zero lesson number and offers a cautious check',()=>{
  const item=view().items[0];
  assert.equal(item.displayNumber,0);
  assert.equal(item.attentionCount,1);
  assert.match(item.notes.join(' '),/Приход в школу пока не отмечен/);
  assert.doesNotMatch(item.notes.join(' '),/прогул|отсутствует на уроке/);
});
test('preparation starts at ten minutes, not earlier',()=>{
  const future={...lesson,start:'2026-11-17T09:15:00+03:00',end:'2026-11-17T09:35:00+03:00'};
  assert.equal(view({...schedule,lessons:[future]}).items[0].attentionCount,1);
  assert.equal(view({...schedule,lessons:[{...future,start:'2026-11-17T09:16:00+03:00'}]}).items[0].attentionCount,0);
});
test('online and mixed participants do not generate physical absence alarms',()=>{
  for(const mode of ['online','mixed'])assert.equal(attendanceRow({...child,mode},attendance.students[0],lesson,now).needsAttention,false);
});
test('an overlapping absence suppresses a missing arrival, but not a contradiction',()=>{
  const fact={...attendance.students[0],absences:[{start:'2026-11-17T08:00:00+03:00',end:'2026-11-17T10:00:00+03:00'}]};
  assert.equal(attendanceRow(child,fact,lesson,now).needsAttention,false);
  const conflict=attendanceRow(child,{...fact,conflicts:1},lesson,now);
  assert.equal(conflict.needsAttention,true);assert.equal(conflict.physicalStatus,'conflict');
});
test('missing record and failed attendance request are unknown, not missing arrival',()=>{
  assert.equal(attendanceRow(child,null,lesson,now).needsAttention,false);
  const result=view(schedule,attendance,{sources:{...sources,attendance:{status:'unavailable'}}});
  assert.equal(result.items[0].attentionCount,0);
  assert.equal(result.items[0].rows[0].description,'Нет данных о посещаемости');
});
test('arrival and departure are physical observations, never lesson attendance',()=>{
  for(const type of ['arrival','departure']){
    const row=attendanceRow(child,{...attendance.students[0],lastEvent:{type,at:'2026-11-17T09:02:00+03:00'}},lesson,now);
    assert.doesNotMatch(row.description,/на уроке/);
    assert.equal(row.needsAttention,type==='departure');
  }
});
test('finished lesson checks disappear and unpublished differs from no lessons',()=>{
  assert.equal(view(schedule,attendance,{now:new Date('2026-11-17T10:00:00+03:00')}).items.length,0);
  assert.match(view({...schedule,state:'unpublished',lessons:[]}).daySummary,/не опубликовано/);
  assert.match(view({...schedule,lessons:[]}).daySummary,/занятий.*нет/);
});
test('teacher+mentor shares the lesson and deduplicates source events',()=>{
  const result=view({...schedule,roles:['teacher','mentor'],assignedStudents:[child],events:[{key:'x',title:'X',priority:25,href:'/schedule/my'},{key:'x',title:'X',priority:25,href:'/schedule/my'}]}, {...attendance,assignedIds:['11']});
  assert.equal(result.items.filter(item=>item.key==='x').length,1);
  assert.equal(result.items.find(item=>item.key==='assigned:checks').detailCount,1);
});
test('mentor missing-arrival checks wait until first onsite lesson plus five minutes',()=>{
  const s={...schedule,roles:['mentor'],lessons:[{...lesson,own:false,contexts:['assigned']}],assignedStudents:[child]};
  assert.equal(view(s,attendance,{now:new Date('2026-11-17T09:04:59+03:00')}).items.some(item=>item.key==='assigned:checks'),false);
  assert.equal(view(s).items.some(item=>item.key==='assigned:checks'),true);
});
test('student and parent receive no physical checks from broad accidental source data',()=>{
  for(const role of ['student','parent'])assert.equal(view({...schedule,roles:[role]}).items[0].attentionCount,0);
});
test('different publication content is detected without a publication ID change',()=>{
  assert.notEqual(view().scheduleFingerprint,view({...schedule,lessons:[{...lesson,rooms:['302']}]}).scheduleFingerprint);
});
test('school aggregates count pupils separately from records',()=>{
  const result=view(schedule,{...attendance,schoolAllowed:true,summary:[{kind:'conflicts',count:2,records:3}]},{context:'school'});
  assert.equal(result.items[0].subtitle,'Учеников: 2 · записей: 3');
  assert.equal(result.items[0].detailCount, 2);
  assert.equal(result.items[0].recordCount, 3);
});

test('simultaneous own and family lessons are separate contexts, not a conflict',()=>{
  const family={...lesson,key:'family',own:false,contexts:['child']};
  const result=view({...schedule,roles:['teacher','parent'],lessons:[lesson,family]});
  assert.equal(result.items.length,2);
  assert.ok(result.items.every(item=>!item.notes.includes('В расписании есть пересекающееся занятие')));
  assert.match(result.daySummary,/у вас 0, у ребёнка 0/);
  assert.equal(result.items.find(item=>item.key==='lesson:family').rows[0].description,'Участник по расписанию');
});

test('mixed lesson retains checks only for explicitly onsite students',()=>{
  const item=view({...schedule,lessons:[{...lesson,format:'mixed',students:[child,{...child,id:12,mode:'online'}]}]}, {...attendance,students:[attendance.students[0],{...attendance.students[0],id:12}]}).items[0];
  assert.equal(item.attentionCount,1);
  assert.deepEqual(item.rows.map(row=>row.needsAttention),[true,false]);
});

test('schedule drill-down ends on an empty page even when a source total has changed',async()=>{
  const {service,calls}=setup({sourceSchedule:{...schedule,schoolAllowed:true,lessons:[],events:[{key:'school:reports',kind:'reports',title:'Обращения',priority:30,detailKey:'reports',detailCount:60,href:'/workspace/week'}],detailTotal:60,detailRows:[]}});
  const result=await service.details({uid:42},{context:'school',key:'school:reports',offset:50});
  assert.equal(result.nextOffset,null);
  assert.ok(calls.some(call=>call.url.includes('detail=reports&offset=50')));
});

function setup({rights=[{srv_id:8,role_id:2},{srv_id:13,role_id:2}],sourceSchedule=schedule,sourceAttendance=attendance,getClassContactContext}={}){
  let time=+now;
  const calls=[];
  const service=createImportantService({env:{IMPORTANT_ENABLED:'1',MAINPORTAL_SCHEDULE_TOKEN:'test-schedule',ATTENDANCE_MAINPORTAL_SERVICE_KEY:'test-attendance'},now:()=>new Date(time),getRights:async()=>rights,getClassContactContext,fetchImpl:async(url,options)=>{
    calls.push({url:String(url),options});
    const body=String(url).includes('/integrations/')?sourceSchedule:sourceAttendance;
    return new Response(JSON.stringify(body),{status:200,headers:{'Content-Type':'application/json',ETag:'"version"'}});
  }});
  return {service,calls,advance:ms=>{time+=ms;}};
}
const contactDirectory = {
  classes: [{classId:7,name:'7-1'},{classId:8,name:'8-1'},{classId:9,name:'9-1'},{classId:99,name:'4'}],
  staffNames: ['Примеров Семён Семёнович','Примерова Мария Владимировна'],
};

test('teacher receives separate mentor and tutor contacts for the covered classes', async () => {
  const group = {...lesson, classes:['7-1','8-1','9-1'], students:[child,{...child,id:12,classId:8}]};
  const {service} = setup({sourceSchedule:{...schedule,lessons:[group]},getClassContactContext:async()=>contactDirectory});
  const payload = await service.summary({uid:42},{classIds:[99]});
  const {mentor,tutor} = payload.items[0].contacts;
  assert.deepEqual(mentor.map(person=>[person.href,person.classNames]),[
    ['https://t.me/semachos',['7-1','8-1']],
    ['https://t.me/marina_yunikova',['9-1']],
  ]);
  assert.equal(mentor[0].name, 'Примеров Семён Семёнович');
  assert.deepEqual(tutor.map(person=>[person.href,person.classNames]),[
    ['https://t.me/mariatsay',['7-1']],
    ['https://t.me/d120833',['8-1']],
  ]);
});

test('parent sees only contacts from the selected child roster even when the timetable includes several classes', async () => {
  const family = {...lesson, own:false, contexts:['child'], classes:['7-1','8-1','9-1'], students:[child]};
  const {service} = setup({sourceSchedule:{...schedule,roles:['parent'],lessons:[family]},getClassContactContext:async()=>contactDirectory});
  const payload = await service.summary({uid:42},{});
  assert.deepEqual(Object.values(payload.items[0].contacts).flat().map(person=>person.classNames),[['7-1'],['7-1']]);
});

test('primary classes keep both mentor assignments while exact class assignments do not spill into parallel classes', () => {
  const primary = contactsForClasses(['1','2','3','4']);
  assert.deepEqual(primary.mentor.map(person=>person.classNames),[['1','2'],['3'],['4'],['1','2','3','4']]);
  assert.deepEqual(primary.tutor[0].classNames,['1','2','3','4']);
  const mixed = contactsForClasses(['8-1','8-2','10-1','10-2']);
  assert.deepEqual(mixed.mentor.map(person=>person.classNames),[['8-1','8-2'],['10-1']]);
  assert.deepEqual(mixed.tutor.map(person=>person.classNames),[['8-1']]);
  assert.deepEqual(contactsForClasses(['10-2','11']), {});
});

test('planned class contacts remain available without the directory', async () => {
  const {service} = setup({getClassContactContext:async ()=>{throw new Error('unavailable');}});
  const result = await service.summary({uid:42},{});
  assert.equal(result.items[0].contacts.mentor[0].name, 'Семен Семенович');
});

test('actor comes only from the session and browser cannot choose queried students',async()=>{
  const {service,calls}=setup();
  const summary=await service.summary({uid:42},{actorId:99,studentIds:[999]});
  assert.match(calls[0].url,/actor_id=42/);
  assert.deepEqual(JSON.parse(calls[1].options.body).studentIds,[11]);
  assert.equal(summary.items[0].rows,undefined);
  assert.ok(summary.items[0].detailRevision);
});
test('source returns broader attendance: unrelated children never enter details',async()=>{
  const {service}=setup({sourceAttendance:{...attendance,students:[...attendance.students,{id:999,name:'Unrelated'}]}});
  const payload=await service.details({uid:42},{key:'lesson:one'});
  assert.deepEqual(payload.rows.map(row=>row.id),['11']);
  await assert.rejects(service.details({uid:42},{key:'student:999'}),error=>error.status===404);
});
test('parent-only does not call Attendance',async()=>{
  const {service,calls}=setup({rights:[{srv_id:8,role_id:6}],sourceSchedule:{...schedule,roles:['parent']}});
  await service.summary({uid:42},{});
  assert.equal(calls.length,1);
});
test('unauthenticated, invalid child and disabled requests fail before source access',async()=>{
  const {service,calls}=setup();
  await assert.rejects(service.summary({},{}),error=>error.status===401);
  await assert.rejects(service.summary({uid:42},{childId:'-1'}),error=>error.status===400);
  await assert.rejects(createImportantService({env:{}}).summary({uid:42},{}),error=>error.status===404);
  assert.equal(calls.length,0);
});
test('cache is per actor and expires in five seconds',async()=>{
  const {service,calls,advance}=setup();
  await service.summary({uid:42},{});await service.summary({uid:42},{});assert.equal(calls.length,2);
  await service.summary({uid:43},{});assert.equal(calls.length,4);
  advance(5001);await service.summary({uid:42},{});assert.equal(calls.length,6);
});

test('source recovers after a long outage when its unchanged cached body has expired',async()=>{
  let time=+now,offline=false;
  const calls=[];
  const service=createImportantService({env:{IMPORTANT_ENABLED:'1',MAINPORTAL_SCHEDULE_TOKEN:'test-schedule'},now:()=>new Date(time),getRights:async()=>[{srv_id:8,role_id:2}],fetchImpl:async(url,{headers})=>{
    calls.push(headers);
    if(offline)throw new Error('offline');
    if(headers['If-None-Match'])return new Response(null,{status:304});
    return new Response(JSON.stringify(schedule),{headers:{ETag:'"same"'}});
  }});
  assert.equal((await service.summary({uid:42},{})).sources.schedule.status,'ready');
  offline=true;time+=6000;await service.summary({uid:42},{});
  time+=120001;assert.equal((await service.summary({uid:42},{})).items.length,0);
  offline=false;time+=6000;
  assert.equal((await service.summary({uid:42},{})).sources.schedule.status,'ready');
  assert.equal(calls.at(-1)['If-None-Match'],undefined);
});
test('route returns private conditional data and server time on 304',async()=>{
  const {service}=setup();const routes=new Map();registerImportantRoutes({get:(path,handler)=>routes.set(path,handler)},service);
  const invoke=async headers=>{
    const response={statusCode:200,headers:{},set(k,v){this.headers[k]=v;return this;},status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;},end(){return this;}};
    await routes.get('/api/important')({session:{uid:42},query:{},headers},response);return response;
  };
  const first=await invoke({}),second=await invoke({'if-none-match':first.headers.ETag});
  assert.equal(second.statusCode,304);assert.equal(second.headers['X-Server-Time'],now.toISOString());assert.match(second.headers['Cache-Control'],/private/);
});
