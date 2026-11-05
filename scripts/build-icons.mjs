import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PORTAL_DOMAINS } from '../vendor/nginxServices.mjs';

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

// Match the existing nginx-*.svg card illustrations: same canvas, scale and stroke.
const colors = [['#dbeafe', '#2563eb'], ['#dcfce7', '#16a34a'], ['#f3e8ff', '#9333ea'], ['#ffedd5', '#ea580c'], ['#ccfbf1', '#0d9488']];
for (const [index, service] of PORTAL_DOMAINS.entries()) {
  const match = sprite.match(new RegExp(`<symbol id="${service.icon}"[\\s\\S]*?</symbol>`));
  if (!match) throw new Error(`Missing domain icon: ${service.icon}`);
  const paths = match[0].replace(/^<symbol[^>]*>/, '').replace(/<\/symbol>$/, '').trim();
  const [background, stroke] = colors[index % colors.length];
  await writeFile(join(root, 'public', 'img', service.pic), `<!-- Icons: Lucide, ISC license -->\n<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">\n  <rect width="96" height="96" rx="24" fill="${background}"/>\n  <g transform="translate(22 22) scale(2.1667)" fill="none" stroke="${stroke}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">\n${paths}\n  </g>\n</svg>\n`);
}
