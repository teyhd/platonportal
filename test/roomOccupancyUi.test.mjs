import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareSnapshot, roomStatus } from '../public/js/room-occupancy.js';

const instant = hm => Date.parse('2026-11-19T' + hm + ':00+03:00');
const span = [[instant('12:00'), instant('13:00')]];
test('availability changes at inclusive thresholds and exact lesson boundaries', () => {
  for (const [time, kind] of [['11:44','free'],['11:45','short'],['12:00','busy'],['12:45','soon'],['13:00','free']]) {
    assert.equal(roomStatus(span, instant(time)).kind, kind, time);
  }
  assert.equal(roomStatus(null,instant('12:00')).kind,'unknown');
});

test('adjoining intervals merge and malformed intervals produce unknown occupancy', () => {
  const iso = hm => new Date(instant(hm)).toISOString();
  const payload = { schema:1, state:'published', generatedAt:iso('10:00'), dayEnd:iso('23:59'), rooms:[
    { name:'12', floor:'2 этаж', intervals:[{ start:iso('11:00'),end:iso('12:00') }, {start:iso('10:00'),end:iso('11:00')}] },
    { name:'2', floor:'2 этаж', intervals:[{start:'invalid',end:iso('11:00')}] },
    { name:'Зал', floor:null, intervals:[] }
  ] };
  const {groups} = prepareSnapshot(payload);
  assert.deepEqual(groups.map(([label]) => label),['2 этаж',null]);
  const rooms = groups[0][1];
  assert.equal(rooms[0].name,'2');
  assert.equal(rooms[0].spans,null);
  assert.deepEqual(rooms[1].spans,[[instant('10:00'),instant('12:00')]]);
});
