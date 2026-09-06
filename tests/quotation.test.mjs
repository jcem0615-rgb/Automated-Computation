import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeQuotation, computeLine } from '../js/calc.js';
import { normalizeQuotation } from '../js/model.js';
import { quotationToMarkdown, markdownFileName } from '../js/markdown.js';
import { checkCompleteness } from '../js/validate.js';
import { peso, percent } from '../js/format.js';

// Intermediates are deliberately unrounded (docs/calculation_rules.md), so
// compare at the cent level rather than bit-for-bit.
const closeTo = (actual, expected, label) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${label ?? 'value'}: ${actual} !== ${expected}`);

const sample = normalizeQuotation(
  JSON.parse(readFileSync(new URL('../examples/sample_input.json', import.meta.url), 'utf8')),
);

test('line item: raw total then markup', () => {
  const line = computeLine({ qty: 50, unit_cost: 260, markup_pct: 15 });
  assert.equal(line.rawTotal, 13000);
  closeTo(line.finalPrice, 14950, 'finalPrice');
});

test('sample input totals follow calculation_rules.md', () => {
  const t = computeQuotation(sample);
  // 50x260=13000 +15% = 14950 | 100x220=22000 +12% = 24640 | 800x13.50=10800 +10% = 11880
  closeTo(t.materials.totalRaw, 45800, 'totalRaw');
  closeTo(t.materials.totalMarkedUp, 51470, 'totalMarkedUp');
  closeTo(t.labor.total, 75000, 'labor'); // 5 x 750 x 20
  closeTo(t.directFees.total, 16500, 'directFees'); // 5000 + 3500 + 8000
  closeTo(t.subtotal, 142970, 'subtotal');
  assert.equal(t.vatable, true);
  closeTo(t.vat, 17156.4, 'vat');
  closeTo(t.grandTotal, 160126.4, 'grandTotal');
});

test('flat fee replaces the daily-rate labor computation', () => {
  const t = computeQuotation({ ...sample, labor: { workers: 5, daily_rate: 750, days: 20, flat_fee: 40000 } });
  assert.equal(t.labor.usesFlatFee, true);
  assert.equal(t.labor.total, 40000);
});

test('Non-VAT zeroes VAT but keeps the grand total intact', () => {
  const t = computeQuotation({
    ...sample,
    tax_and_terms: { ...sample.tax_and_terms, vat_status: 'Non-VAT' },
  });
  assert.equal(t.vat, 0);
  assert.equal(t.grandTotal, t.subtotal);
});

test('other direct fees roll into the direct fees total', () => {
  const t = computeQuotation({
    ...sample,
    direct_fees: { ...sample.direct_fees, other: [{ label: 'Site Fencing', amount: 2500 }] },
  });
  closeTo(t.directFees.total, 19000, 'directFees with other');
});

test('currency and percent formatting', () => {
  assert.equal(peso(125340.5), '₱125,340.50');
  assert.equal(peso(0), '₱0.00');
  assert.equal(percent(15), '15%');
  assert.equal(percent(12.5), '12.5%');
});

test('markdown keeps the template structure', () => {
  const md = quotationToMarkdown(sample);
  const required = [
    '# PROJECT COST QUOTATION',
    '### 1. Client & Contractor Information',
    '### 2. Bill of Materials (BOM)',
    '| Item Description | Qty | Unit | Unit Cost (₱) | Raw Total (₱) | Markup (%) | Final Price (₱) |',
    '### 3. Labor & Implementation',
    '### 4. Direct Project Fees & Miscellaneous',
    '### 5. Final Cost Summary',
    '| **VAT (12% - *if applicable*)** | ₱17,156.40 |',
    '| **GRAND TOTAL** | **₱160,126.40** |',
    '### 6. Terms & Conditions',
  ];
  for (const needle of required) assert.ok(md.includes(needle), `missing: ${needle}`);
  assert.ok(md.includes('5 Workers × ₱750.00/day × 20 Days = **₱75,000.00**'));
  assert.ok(md.includes('| **Materials Subtotal** | — | — | — | **₱45,800.00** | — | **₱51,470.00** |'));
});

test('unfilled fields keep their placeholder instead of being invented', () => {
  const md = quotationToMarkdown(normalizeQuotation({}));
  assert.ok(md.includes('[Ref No.]'));
  assert.ok(md.includes('[Client Name]'));
  assert.ok(md.includes('[TIN Number]'));
});

test('pipes in user text cannot break a table row', () => {
  const md = quotationToMarkdown(
    normalizeQuotation({ materials: [{ description: 'Pipe | 2in', qty: 1, unit: 'pc', unit_cost: 10, markup_pct: 0 }] }),
  );
  assert.ok(md.includes('Pipe \\| 2in'));
});

test('completeness check reports gaps and clears on the sample', () => {
  assert.equal(checkCompleteness(sample).complete, true);
  const blank = checkCompleteness(normalizeQuotation({}));
  assert.ok(blank.total > 0);
  assert.ok(blank.groups.some((g) => g.section === 'Client Details'));
});

test('normalize accepts the sample_input.json shape verbatim', () => {
  assert.equal(sample.materials.length, 3);
  assert.equal(sample.tax_and_terms.payment_options.length, 3);
  assert.equal(sample.labor.flat_fee, null);
});

test('file name is derived from the reference number', () => {
  assert.equal(markdownFileName(sample), 'quotation_QTN-2026-0091.md');
});
