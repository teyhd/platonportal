import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const view = readFileSync(new URL('../views/new.hbs', import.meta.url), 'utf8');
const server = readFileSync(new URL('../platonportal.js', import.meta.url), 'utf8');

test('cards admin image field accepts generated upload paths', () => {
  assert.match(view, /data-card-pic maxlength="255"/);
  assert.match(server, /const CARD_IMAGE_PIC_MAX_LENGTH = 255;/);
  assert.match(server, /getLimitedString\(body\.pic, CARD_IMAGE_PIC_MAX_LENGTH\)/);
});

test('cards admin upload accepts common jpeg mime variants and extension fallback', () => {
  assert.match(view, /'image\/jpg'/);
  assert.match(view, /\\\.\(png\|jpe\?g\|webp\)\$/);
  assert.match(view, /isSupportedImageFile\(file\)/);
});

test('cards admin upload stores compact filenames', () => {
  assert.match(server, /slice\(0, 8\) \|\| 'card'/);
  assert.match(server, /Date\.now\(\)\.toString\(36\)/);
});
