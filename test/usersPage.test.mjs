import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { compareUserValues, normalizeSearchText } from '../public/js/users.js';

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

test('users profile keeps primary and optional fields in their intended sections', async () => {
  const template = await readFile(new URL('../views/users.hbs', import.meta.url), 'utf8');
  const script = await readFile(new URL('../public/js/users.js', import.meta.url), 'utf8');
  const primaryStart = template.indexOf('<h4>Основное</h4>');
  const advancedStart = template.indexOf('<details class="users-advanced">');
  const displayNameField = template.indexOf('for="f-display-name-custom"');
  const messengerField = template.indexOf('for="f-messenger-username"');

  assert.ok(primaryStart >= 0 && advancedStart > primaryStart);
  assert.ok(displayNameField > primaryStart && displayNameField < advancedStart);
  assert.ok(messengerField > advancedStart);
  assert.equal(template.includes('id="f-email"'), false);
  assert.doesNotMatch(template, /SSO email/);
  assert.doesNotMatch(script, /#f-email/);
});
