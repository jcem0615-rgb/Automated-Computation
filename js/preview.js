// Client-facing rendering of a quotation. Mirrors the Markdown output section
// for section, so the printed PDF and the .md file say the same thing.

import { peso, percent, qty as fmtQty, longDate } from './format.js';
import { computeQuotation } from './calc.js';

const esc = (v) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// Missing values are shown as a visible placeholder, never guessed.
const val = (value, placeholder) => {
  const s = value === null || value === undefined ? '' : String(value).trim();
  return s === ''
    ? `<span class="placeholder">[${esc(placeholder)}]</span>`
    : esc(s);
};

const partyRow = (label, value, placeholder) =>
  `<div><dt>${esc(label)}</dt><dd>${val(value, placeholder)}</dd></div>`;

export function renderQuotationHTML(q) {
  const t = computeQuotation(q);
  const meta = q.metadata || {};
  const client = q.client || {};
  const contractor = q.contractor || {};
  const terms = q.tax_and_terms || {};
  const lines = t.materials.lines.filter((l) => String(l.description).trim() !== '');

  const bomRows = lines.length
    ? lines
        .map(
          (l) => `<tr>
        <td>${esc(l.description)}</td>
        <td class="num">${esc(fmtQty(l.qty))}</td>
        <td>${val(l.unit, 'unit')}</td>
        <td class="num">${esc(peso(l.unitCost))}</td>
        <td class="num">${esc(peso(l.rawTotal))}</td>
        <td class="num">${esc(percent(l.markupPct))}</td>
        <td class="num">${esc(peso(l.finalPrice))}</td>
      </tr>`,
        )
        .join('')
    : `<tr><td colspan="7" class="placeholder">No line items added yet.</td></tr>`;

  const laborLine = t.labor.usesFlatFee
    ? `Flat Fee = <strong>${esc(peso(t.labor.total))}</strong>`
    : `${esc(fmtQty(t.labor.workers))} Workers × ${esc(peso(t.labor.dailyRate))}/day × ${esc(fmtQty(t.labor.days))} Days = <strong>${esc(peso(t.labor.total))}</strong>`;

  const otherFees = t.directFees.other
    .map((o) => `<li><strong>${esc(o.label)}:</strong> ${esc(peso(o.amount))}</li>`)
    .join('');

  const scheduleText = t.schedule.length
    ? t.schedule
        .map((s) => `${esc(percent(s.pct))} ${esc(s.label)} (${esc(peso(s.amount))})`)
        .join(', ')
    : '<span class="placeholder">[Payment schedule not set]</span>';

  const list = (items, placeholder) =>
    items && items.length
      ? `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`
      : `<p class="placeholder">[${esc(placeholder)}]</p>`;

  return `
  <h1>Project Cost Quotation</h1>
  <p class="paper__meta">
    <span><strong>Ref No.:</strong> ${val(meta.reference_number, 'Ref No.')}</span>
    <span><strong>Date Issued:</strong> ${val(longDate(meta.issue_date), 'Date')}</span>
    <span><strong>Validity:</strong> ${val(meta.validity_period, 'Validity Period')}</span>
  </p>

  <h2>1. Client &amp; Contractor Information</h2>
  <div class="paper__parties">
    <section class="paper__party">
      <h3>Client details</h3>
      <dl>
        ${partyRow('Client Name', client.client_name, 'Client Name')}
        ${partyRow('Company', client.company, 'Client Company')}
        ${partyRow('Contact No.', client.contact_number, 'Client Phone')}
        ${partyRow('Email', client.email, 'Client Email')}
        ${partyRow('Site Address', client.site_address, 'Project Location')}
      </dl>
    </section>
    <section class="paper__party">
      <h3>Contractor details</h3>
      <dl>
        ${partyRow('Company', contractor.company_name, 'Your Company Name')}
        ${partyRow('Prepared By', contractor.prepared_by, 'Your Name & Title')}
        ${partyRow('Contact No.', contractor.contact_number, 'Your Phone')}
        ${partyRow('Email', contractor.email, 'Your Email')}
        ${partyRow('TIN / Tax ID', contractor.tin, 'TIN Number')}
      </dl>
    </section>
  </div>

  <h2>2. Bill of Materials</h2>
  <table>
    <thead>
      <tr>
        <th scope="col">Item Description</th>
        <th scope="col" class="num">Qty</th>
        <th scope="col">Unit</th>
        <th scope="col" class="num">Unit Cost (₱)</th>
        <th scope="col" class="num">Raw Total (₱)</th>
        <th scope="col" class="num">Markup (%)</th>
        <th scope="col" class="num">Final Price (₱)</th>
      </tr>
    </thead>
    <tbody>${bomRows}</tbody>
    <tfoot>
      <tr>
        <th scope="row" colspan="4">Materials Subtotal</th>
        <td class="num">${esc(peso(t.materials.totalRaw))}</td>
        <td></td>
        <td class="num">${esc(peso(t.materials.totalMarkedUp))}</td>
      </tr>
    </tfoot>
  </table>

  <h2>3. Labor &amp; Implementation</h2>
  <ul><li><strong>Labor Cost:</strong> ${laborLine}</li></ul>

  <h2>4. Direct Project Fees &amp; Miscellaneous</h2>
  <ul>
    <li><strong>Mobilization / Delivery Fee:</strong> ${esc(peso(t.directFees.mobilization))}</li>
    <li><strong>Permits &amp; Local Clearances:</strong> ${esc(peso(t.directFees.permits))}</li>
    <li><strong>Equipment &amp; Tool Rental:</strong> ${esc(peso(t.directFees.equipment))}</li>
    ${otherFees}
    <li><strong>Total Direct Fees:</strong> <strong>${esc(peso(t.directFees.total))}</strong></li>
  </ul>

  <h2>5. Final Cost Summary</h2>
  <table class="totals">
    <tbody>
      <tr><td>Total Materials</td><td class="num">${esc(peso(t.materials.totalMarkedUp))}</td></tr>
      <tr><td>Total Labor Cost</td><td class="num">${esc(peso(t.labor.total))}</td></tr>
      <tr><td>Total Direct Project Fees</td><td class="num">${esc(peso(t.directFees.total))}</td></tr>
      <tr><td><strong>Subtotal</strong></td><td class="num"><strong>${esc(peso(t.subtotal))}</strong></td></tr>
      <tr><td>VAT ${t.vatable ? '(12%)' : '(Non-VAT)'}</td><td class="num">${esc(peso(t.vat))}</td></tr>
      <tr class="is-grand"><td>GRAND TOTAL</td><td class="num">${esc(peso(t.grandTotal))}</td></tr>
    </tbody>
  </table>

  <h2>6. Terms &amp; Conditions</h2>
  <p><strong>Payment Schedule:</strong> ${scheduleText}</p>
  <p><strong>Payment Options:</strong></p>
  ${list(terms.payment_options, 'e.g., Bank Transfer, GCash, Check')}
  <p><strong>Exclusions:</strong></p>
  ${list(terms.exclusions, 'e.g., Main power tapping fees, structural modifications, scope outside this document')}

  <p class="paper__foot">Prepared with LogicQuot. All amounts in Philippine Pesos (₱).</p>`;
}
