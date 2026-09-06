// Rasterises icons/favicon.svg and icons/maskable.svg into the PNG sizes the
// web app manifest references. Run with: npm run icons
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const targets = [
  { svg: 'favicon.svg', out: 'icon-192.png', size: 192 },
  { svg: 'favicon.svg', out: 'icon-512.png', size: 512 },
  { svg: 'favicon.svg', out: 'icon-180.png', size: 180 },
  { svg: 'maskable.svg', out: 'maskable-192.png', size: 192 },
  { svg: 'maskable.svg', out: 'maskable-512.png', size: 512 },
];

const browser = await chromium.launch();
try {
  for (const t of targets) {
    const svg = readFileSync(join(root, 'icons', t.svg), 'utf8');
    const page = await browser.newPage({
      viewport: { width: t.size, height: t.size },
      deviceScaleFactor: 1,
    });
    await page.setContent(
      `<style>html,body{margin:0;padding:0;background:transparent}svg{display:block;width:${t.size}px;height:${t.size}px}</style>${svg}`,
      { waitUntil: 'load' },
    );
    const buffer = await page.screenshot({ omitBackground: true, type: 'png' });
    writeFileSync(join(root, 'icons', t.out), buffer);
    await page.close();
    console.log(`icons/${t.out} (${t.size}x${t.size})`);
  }
} finally {
  await browser.close();
}
