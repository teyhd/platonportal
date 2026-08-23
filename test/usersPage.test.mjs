import assert from 'node:assert/strict';
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
