// Rasterises icons/logo.svg into the PNG sizes the web app manifest references.
// Run with: npm run icons
//
// logo.svg is the single source of truth. The maskable variant is derived from
// it here rather than kept as a second file, so the artwork cannot drift: the
// tile is scaled into the 80% safe zone on a solid ground, because a platform
// mask crops a maskable icon to a circle or squircle.

import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const logo = readFileSync(join(root, 'icons', 'logo.svg'), 'utf8');

// Colour of the tile's outer edge, so the padding reads as part of the icon.
const SAFE_GROUND = '#2a6392';
const inner = logo.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" role="img" aria-label="LogicQuot">
  <rect width="256" height="256" fill="${SAFE_GROUND}"/>
  <g transform="translate(128 128) scale(0.76) translate(-128 -128)">${inner}</g>
</svg>`;

const targets = [
  { svg: logo, out: 'icon-192.png', size: 192 },
  { svg: logo, out: 'icon-512.png', size: 512 },
  { svg: logo, out: 'icon-180.png', size: 180 },
  { svg: maskable, out: 'maskable-192.png', size: 192 },
  { svg: maskable, out: 'maskable-512.png', size: 512 },
];

const browser = await chromium.launch();
try {
  for (const t of targets) {
    const page = await browser.newPage({
      viewport: { width: t.size, height: t.size },
      deviceScaleFactor: 1,
    });
    await page.setContent(
      `<style>html,body{margin:0;padding:0;background:transparent}svg{display:block;width:${t.size}px;height:${t.size}px}</style>${t.svg}`,
      { waitUntil: 'load' },
    );
    writeFileSync(
      join(root, 'icons', t.out),
      await page.screenshot({ omitBackground: true, type: 'png' }),
    );
    await page.close();
    console.log(`icons/${t.out} (${t.size}x${t.size})`);
  }
} finally {
  await browser.close();
}
