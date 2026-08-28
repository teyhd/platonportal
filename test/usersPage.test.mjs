import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { compareUserValues, formatBirthDate, normalizeSearchText, normalizeUserDetailsPayload } from '../public/js/users.js';

test('users search normalizes whitespace, case and a leading messenger @', () => {
  assert.equal(normalizeSearchText('  @Иванов\tИВАН  '), 'иванов иван');
  assert.equal(normalizeSearchText('  A\u00a0B  '), 'a b');
});

test('users sort is numeric where values are numeric', () => {
  assert.equal(compareUserValues('20', '3', 'asc') > 0, true);
  assert.equal(compareUserValues('20', '3', 'desc') < 0, true);
});

test('users sort follows Russian alphabetical order for labels', () => {
  assert.equal(compareUserValues('Администратор', 'Учитель', 'asc') < 0, true);
  assert.equal(compareUserValues('Учитель', 'Администратор', 'desc') < 0, true);
});

test('users display ISO birth dates in a stable Russian format', () => {
  assert.equal(formatBirthDate('2010-09-02'), '2 сентября 2010 г.');
  assert.equal(formatBirthDate('2010-02-30'), '');
  assert.equal(formatBirthDate('not-a-date'), '');
});

test('user drawer accepts only complete user-detail responses', () => {
  const data = normalizeUserDetailsPayload({
    ok: true,
    user: { id: 42, name: 'Тестовый пользователь' },
    rights: [{ srv_id: 1, role_id: 1 }],
    logins: [{ srv_id: 2, login: 'user' }],
  });

  assert.deepEqual(data, {
    user: { id: 42, name: 'Тестовый пользователь' },
    rights: [{ srv_id: 1, role_id: 1 }],
    logins: [{ srv_id: 2, login: 'user' }],
  });
  assert.equal(normalizeUserDetailsPayload({ ok: true, user: {} }), null);
  assert.equal(normalizeUserDetailsPayload({ ok: false, user: { id: 42 } }), null);
});

test('users profile keeps primary and optional fields in their intended sections', async () => {
  const template = await readFile(new URL('../views/users.hbs', import.meta.url), 'utf8');
  const script = await readFile(new URL('../public/js/users.js', import.meta.url), 'utf8');
  const primaryStart = template.indexOf('<h4>Основное</h4>');
  const advancedStart = template.indexOf('<details class="users-advanced">');
  const displayNameField = template.indexOf('for="f-display-name-custom"');
  const birthDateField = template.indexOf('for="f-birth-date"');
  const messengerField = template.indexOf('for="f-messenger-username"');

  assert.ok(primaryStart >= 0 && advancedStart > primaryStart);
  assert.ok(displayNameField > primaryStart && displayNameField < advancedStart);
  assert.ok(birthDateField > primaryStart && birthDateField < advancedStart);
  assert.ok(messengerField > advancedStart);
  assert.equal(template.includes('id="f-email"'), false);
  assert.doesNotMatch(template, /SSO email/);
  assert.doesNotMatch(script, /#f-email/);
});
