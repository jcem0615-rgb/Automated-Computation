// Browser smoke test: drives the real app the way a user would, then checks
// that the totals, exports and offline caching all behave.
import { chromium } from 'playwright';

const BASE = process.env.LOGICQUOT_URL || 'http://127.0.0.1:8080';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();

const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });

// Sections collapse by default; a user expands them, so the test does too.
const openAllPanels = () =>
  page.$$eval('#builder-form details.panel', (els) => els.forEach((d) => { d.open = true; }));
// The segmented radios are visually hidden behind their label, as designed.
// The radio itself is the hit target (it overlays its label at opacity 0).
const pickSegment = async (name, value) => {
  const input = page.locator(`input[name="${name}"][value="${value}"]`);
  await input.scrollIntoViewIfNeeded();
  await input.check({ force: true });
  await input.dispatchEvent('change');
};

// 1. Boots on the quotations view with an empty state.
check('boots to the quotations list', await page.locator('#view-quotations').isVisible());
check('shows the empty state', await page.locator('.empty').isVisible());

// 2. Loading the sample populates the builder and computes the known totals.
await page.click('#load-sample');
await page.waitForSelector('#view-build:not([hidden])');
await openAllPanels();
await page.waitForFunction(() => document.querySelector('#sum-grand')?.textContent !== '₱0.00');

const grand = await page.locator('#sum-grand').textContent();
check('sample grand total matches the spec', grand.trim() === '₱160,126.40', grand.trim());
check('sample subtotal', (await page.locator('#sum-subtotal').textContent()).trim() === '₱142,970.00');
check('sample VAT', (await page.locator('#sum-vat').textContent()).trim() === '₱17,156.40');
check('materials marked-up', (await page.locator('#sum-materials').textContent()).trim() === '₱51,470.00');
check('BOM rows rendered', (await page.locator('#bom-body tr').count()) === 3);
check(
  'completeness clears on the sample',
  (await page.locator('#completeness .completeness__ok').count()) === 1,
);

// 3. Editing a quantity updates the totals live.
await page.fill('#bom-body tr:nth-child(1) [data-field="qty"]', '100');
await page.waitForFunction(() => document.querySelector('#sum-grand')?.textContent !== '₱160,126.40');
const afterEdit = (await page.locator('#sum-grand').textContent()).trim();
// +50 bags x ₱260 x 1.15 = ₱14,950 more materials, then 12% VAT on top.
check('live recalculation on edit', afterEdit === '₱176,870.40', afterEdit);
await page.fill('#bom-body tr:nth-child(1) [data-field="qty"]', '50');
await page.waitForFunction(() => document.querySelector('#sum-grand')?.textContent === '₱160,126.40');

// 4. Blanket markup rewrites every line.
await page.fill('#blanket-markup', '20');
await page.click('#apply-blanket');
await page.waitForFunction(
  () => document.querySelector('#bom-body tr [data-field="markup_pct"]')?.value === '20',
);
const markups = await page.$$eval('#bom-body [data-field="markup_pct"]', (els) => els.map((e) => e.value));
check('blanket markup applies to all rows', markups.every((m) => m === '20'), markups.join(','));

// 5. Adding and removing a line item.
const before = await page.locator('#bom-body tr').count();
await page.click('#add-item');
const added = await page.locator('#bom-body tr').count();
await page.click('#bom-body tr:last-child .row-remove');
const removed = await page.locator('#bom-body tr').count();
check('add / remove line item', added === before + 1 && removed === before, `${before}->${added}->${removed}`);

// 6. Flat-fee labor mode swaps the inputs and the maths.
await pickSegment('labor_mode', 'flat');
await page.fill('input[name="labor.flat_fee"]', '40000');
await page.waitForFunction(() => document.querySelector('#sum-labor')?.textContent === '₱40,000.00');
check('flat fee replaces daily-rate labor', true, '₱40,000.00');
check('daily-rate inputs hidden in flat mode', await page.locator('#labor-daily').isHidden());
await pickSegment('labor_mode', 'daily');
await page.fill('input[name="labor.workers"]', '5');
await page.fill('input[name="labor.daily_rate"]', '750');
await page.fill('input[name="labor.days"]', '20');
await page.fill('#blanket-markup', '');
await page.waitForFunction(() => document.querySelector('#sum-labor')?.textContent === '₱75,000.00');

// 7. Non-VAT zeroes the VAT row.
await pickSegment('tax_and_terms.vat_status', 'Non-VAT');
await page.waitForFunction(() => document.querySelector('#sum-vat')?.textContent === '₱0.00');
const nonVatGrand = (await page.locator('#sum-grand').textContent()).trim();
const nonVatSub = (await page.locator('#sum-subtotal').textContent()).trim();
check('Non-VAT: grand total equals subtotal', nonVatGrand === nonVatSub, nonVatGrand);
await pickSegment('tax_and_terms.vat_status', '12% VAT');

// 8. Reload the pristine sample so the export checks compare against the
// figures published in docs/calculation_rules.md.
await page.click('.tab[data-route="quotations"]');
await page.click('#load-sample');
await page.waitForSelector('#view-build:not([hidden])');
await openAllPanels();
await page.waitForFunction(() => document.querySelector('#sum-grand')?.textContent === '₱160,126.40');

// 9. Save, then confirm it shows up in the list.
await page.click('#save-quotation');
await page.click('.tab[data-route="quotations"]');
await page.waitForSelector('.qcard');
check('saved quotation appears in the list', (await page.locator('.qcard').count()) === 1);
check(
  'card shows the grand total',
  (await page.locator('.qcard__total').first().textContent()).includes('₱'),
);

// 10. Preview renders the full document.
await page.click('.tab[data-route="preview"]');
await page.waitForSelector('#quotation-paper h1');
const paper = await page.locator('#quotation-paper').textContent();
check('preview has all six sections', [
  '1. Client & Contractor Information',
  '2. Bill of Materials',
  '3. Labor & Implementation',
  '4. Direct Project Fees',
  '5. Final Cost Summary',
  '6. Terms & Conditions',
].every((s) => paper.includes(s)));
check('preview shows the grand total', paper.includes('₱160,126.40'));
check('no unfilled placeholders on a complete quotation', !paper.includes('['));

// 11. Markdown download produces the template layout.
const [mdDownload] = await Promise.all([
  page.waitForEvent('download'),
  page.click('#download-md'),
]);
const md = await (await mdDownload.createReadStream()).toArray();
const mdText = Buffer.concat(md).toString('utf8');
check('markdown filename from reference number', mdDownload.suggestedFilename() === 'quotation_QTN-2026-0091.md', mdDownload.suggestedFilename());
check('markdown keeps the template heading', mdText.startsWith('# PROJECT COST QUOTATION'));
check('markdown grand total row', mdText.includes('| **GRAND TOTAL** | **₱160,126.40** |'));

// 12. JSON download round-trips into the original schema.
const [jsonDownload] = await Promise.all([
  page.waitForEvent('download'),
  page.click('#download-json'),
]);
const jsonText = Buffer.concat(await (await jsonDownload.createReadStream()).toArray()).toString('utf8');
const parsed = JSON.parse(jsonText);
check(
  'JSON export matches sample_input.json shape',
  Boolean(parsed.contractor && parsed.client && parsed.metadata && parsed.materials && parsed.labor && parsed.direct_fees && parsed.tax_and_terms),
);
check('JSON export drops internal fields', !('id' in parsed) && !('updated_at' in parsed));

// 13. Draft survives a reload.
await page.reload({ waitUntil: 'networkidle' });
await page.click('.tab[data-route="build"]');
await openAllPanels();
await page.waitForFunction(() => document.querySelector('#sum-grand')?.textContent !== '₱0.00');
check(
  'draft restored after reload',
  (await page.locator('input[name="client.client_name"]').inputValue()) === 'Maria Santos',
);

// 14. Service worker registers and serves the app offline.
const swReady = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.ready;
  return Boolean(reg.active);
});
check('service worker is active', swReady);

await page.waitForTimeout(1200); // let the precache settle
await context.setOffline(true);
const offlinePage = await context.newPage();
const resp = await offlinePage.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
const offlineTitle = await offlinePage.title();
check('app loads with the network off', Boolean(resp) && offlineTitle.includes('LogicQuot'), offlineTitle);
const offlineTotals = await offlinePage.evaluate(() => {
  const el = document.querySelector('#sum-grand');
  return el ? el.textContent : null;
});
check('offline app boots its JS modules', offlineTotals !== null, String(offlineTotals));
check('offline badge shown', await offlinePage.locator('#offline-badge').isVisible());
await context.setOffline(false);
await offlinePage.close();

// 15. Completeness check catches an empty quotation.
await page.click('.tab[data-route="quotations"]');
await page.click('#new-quotation');
await page.waitForSelector('#view-build:not([hidden])');
await openAllPanels();
await page.waitForFunction(() => document.querySelector('#completeness')?.textContent.includes('still needed'));
check('empty quotation reports missing inputs', true);

// 16. Accessibility / structure basics.
check('single h1 per visible view', (await page.locator('h1:visible').count()) <= 1);
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exit(1);
