import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHmac } from 'node:crypto';
import express from 'express';
import { createImportantGamification, importantGamificationPath, registerImportantGamification } from '../vendor/important-gamification.mjs';

const key = 'demo-key-demo-key-demo-key-demo-key';
const idempotencyKey = 'c8570883-821a-473b-be9a-215c220b7fd6';
const mark = { scopeId:2, studentId:3, criterionId:4, periodId:5, version:0, score:3, actorId:777 };
const env = { POINTS_MAINPORTAL_KEY:key, POINTS_MAINPORTAL_ORIGIN:'https://platoniks.ru' };

test('signs the verified actor, rechecks roles, and invalidates the queue after confirmation', async () => {
  let roles = [2];
  const calls = [];
  const service = createImportantGamification({env, getRoles:async id => {
    assert.equal(id, 9);
    return roles;
  }, fetchImpl:async (url, options) => {
    const { method, headers, body = '' } = options;
    const actor = headers['X-Portal-Actor'];
    assert.deepEqual(JSON.parse(Buffer.from(actor, 'base64url')), { id:9, roles:[2] });
    const expected = createHmac('sha256', key)
      .update([method,url.pathname,headers['X-Portal-Timestamp'],actor,headers['Idempotency-Key'] || '',body].join('\n')).digest('hex');
    assert.equal(headers['X-Portal-Signature'], expected);
    calls.push(method);
    if (method === 'GET') return Response.json({tasks:calls.includes('POST') ? [] : [{}]});
    assert.equal(headers['Idempotency-Key'], idempotencyKey);
    assert.deepEqual(JSON.parse(body), {scopeId:2,mutations:[{studentId:3,criterionId:4,periodIds:[5],version:0,value:3,source:'manual'}]});
    return Response.json({cells:[{studentId:3,criterionId:4,version:1}]});
  }});
  const session = {uid:9};
  assert.equal(await service.count(session), 1);
  assert.equal((await service.pending(session)).count, 1);
  await assert.rejects(service.confirm(session, {...mark, score:0},idempotencyKey), /invalid_grade/);
  assert.deepEqual(await service.confirm(session, mark,idempotencyKey), {version:1});
  assert.equal(await service.count(session), 0);
  roles = [];
  assert.equal(await service.count(session), null);
  assert.deepEqual(calls, ['GET','POST','GET']);
});

test('same-origin assessment route rejects foreign web requests and role-preview mutations', async t => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.rolePreview = req.get('X-Test-Preview') === '1';
    next();
  });
  registerImportantGamification(app, {
    origin: env.POINTS_MAINPORTAL_ORIGIN,
    confirm() { return { version:1 }; },
  });
  const server = app.listen(0, '127.0.0.1');
  t.after(() => server.close());
  await new Promise(resolve => server.once('listening', resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}${importantGamificationPath}`;
  for (const headers of [{ Origin:'https://other.example' }, { Origin:env.POINTS_MAINPORTAL_ORIGIN, 'X-Test-Preview':'1' }]) {
    const response = await fetch(endpoint, {method:'POST', headers:{...headers, 'Content-Type':'application/json'}, body:'{}'});
    assert.equal(response.status, 403);
  }
});
