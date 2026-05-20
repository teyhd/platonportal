import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ICONS = [
  'chart-column',
  'chart-no-axes-combined',
  'chevron-down',
  'arrow-right',
  'globe',
  'house',
  'info',
  'lock',
  'log-in',
  'log-out',
  'printer',
  'sparkles',
  'users',
  'video',
];

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const source = join(root, 'node_modules', 'lucide-static', 'sprite.svg');
const target = join(root, 'public', 'icons', 'lucide.svg');
const lucideAttrs = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

const sprite = await readFile(source, 'utf8');
const symbols = ICONS.map((id) => {
  const match = sprite.match(new RegExp(`<symbol id="${id}"[\\s\\S]*?</symbol>`));
  if (!match) throw new Error(`Missing Lucide icon: ${id}`);
  return match[0].replace(/<symbol id="([^"]+)" viewBox="([^"]+)">/, `<symbol id="$1" viewBox="$2" ${lucideAttrs}>`);
});

await mkdir(dirname(target), { recursive: true });
await writeFile(
  target,
  `<?xml version="1.0" encoding="utf-8"?>\n<!-- @license lucide-static v1.16.0 - ISC -->\n<svg xmlns="http://www.w3.org/2000/svg" version="1.1">\n  <defs>\n${symbols.map((symbol) => `    ${symbol.replace(/\n/g, '\n    ')}`).join('\n')}\n  </defs>\n</svg>\n`,
);
