import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const view = readFileSync(new URL('../views/partials/cardsAdmin.hbs', import.meta.url), 'utf8');
const script = readFileSync(new URL('../public/js/cards-admin.js', import.meta.url), 'utf8');
const server = readFileSync(new URL('../platonportal.js', import.meta.url), 'utf8');

test('cards admin image field accepts generated upload paths', () => {
  assert.match(view, /data-card-pic maxlength="50"/);
  assert.match(server, /const CARD_IMAGE_PIC_MAX_LENGTH = 50;/);
  assert.match(server, /getLimitedString\(body\.pic, CARD_IMAGE_PIC_MAX_LENGTH\)/);
});

test('cards admin upload accepts common jpeg mime variants and extension fallback', () => {
  assert.match(script, /'image\/jpg'/);
  assert.match(script, /\\\.\(png\|jpe\?g\|webp\)\$/);
  assert.match(script, /isSupportedImageFile\(file\)/);
});

test('cards admin upload stores compact filenames', () => {
  assert.match(server, /slice\(0, 8\) \|\| 'card'/);
  assert.match(server, /Date\.now\(\)\.toString\(36\)/);
});
