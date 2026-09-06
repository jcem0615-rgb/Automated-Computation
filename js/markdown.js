// Renders a quotation into the exact layout of templates/quotation_template.md.
// Section order, table columns and headers are fixed — only the bracketed
// placeholders get filled in. Anything the user has not supplied keeps its
// original placeholder so a gap is visible rather than invented.

import { peso, percent, qty as fmtQty, longDate } from './format.js';
import { computeQuotation } from './calc.js';

const fill = (value, placeholder) => {
  const s = value === null || value === undefined ? '' : String(value).trim();
  return s === '' ? `[${placeholder}]` : s;
};

// Table cells must not break the pipe-delimited row.
const cell = (value) => String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

export function quotationToMarkdown(q) {
  const totals = computeQuotation(q);
  const meta = q.metadata || {};
  const client = q.client || {};
  const contractor = q.contractor || {};
  const terms = q.tax_and_terms || {};
  const L = [];

  L.push('# PROJECT COST QUOTATION');
  L.push('');
  L.push(`Quotation Ref No.: ${fill(meta.reference_number, 'Ref No.')}`);
  L.push(`Date Issued: ${fill(longDate(meta.issue_date), 'Date')}`);
  L.push(`Validity: ${fill(meta.validity_period, 'Validity Period')}`);
  L.push('');
  L.push('### 1. Client & Contractor Information');
  L.push('');
  L.push('| Client Details | Contractor Details |');
  L.push('| :--- | :--- |');
  L.push(
    `| **Client Name:** ${cell(fill(client.client_name, 'Client Name'))} | **Company:** ${cell(fill(contractor.company_name, 'Your Company Name'))} |`,
  );
  L.push(
    `| **Company:** ${cell(fill(client.company, 'Client Company'))} | **Prepared By:** ${cell(fill(contractor.prepared_by, 'Your Name & Title'))} |`,
  );
  L.push(
    `| **Contact No.:** ${cell(fill(client.contact_number, 'Client Phone'))} | **Contact No.:** ${cell(fill(contractor.contact_number, 'Your Phone'))} |`,
  );
  L.push(
    `| **Email:** ${cell(fill(client.email, 'Client Email'))} | **Email:** ${cell(fill(contractor.email, 'Your Email'))} |`,
  );
  L.push(
    `| **Site Address:** ${cell(fill(client.site_address, 'Project Location'))} | **TIN / Tax ID:** ${cell(fill(contractor.tin, 'TIN Number'))} |`,
  );
  L.push('');
  L.push('---');
  L.push('');
  L.push('### 2. Bill of Materials (BOM)');
  L.push('');
  L.push('| Item Description | Qty | Unit | Unit Cost (₱) | Raw Total (₱) | Markup (%) | Final Price (₱) |');
  L.push('| :--- | :--- | :--- | :--- | :--- | :--- | :--- |');
  const lines = totals.materials.lines.filter((l) => String(l.description).trim() !== '');
  if (lines.length === 0) {
    L.push('| [Item 1] | [Qty] | [Unit] | ₱[Cost] | ₱[Raw Total] | [X%] | ₱[Final Price] |');
  } else {
    lines.forEach((l) => {
      L.push(
        `| ${cell(l.description)} | ${fmtQty(l.qty)} | ${cell(fill(l.unit, 'Unit'))} | ${peso(l.unitCost)} | ${peso(l.rawTotal)} | ${percent(l.markupPct)} | ${peso(l.finalPrice)} |`,
      );
    });
  }
  L.push(
    `| **Materials Subtotal** | — | — | — | **${peso(totals.materials.totalRaw)}** | — | **${peso(totals.materials.totalMarkedUp)}** |`,
  );
  L.push('');
  L.push('---');
  L.push('');
  L.push('### 3. Labor & Implementation');
  L.push('');
  if (totals.labor.usesFlatFee) {
    L.push(`* **Labor Cost:** Flat Fee = **${peso(totals.labor.total)}**`);
  } else {
    L.push(
      `* **Labor Cost:** ${fmtQty(totals.labor.workers)} Workers × ${peso(totals.labor.dailyRate)}/day × ${fmtQty(totals.labor.days)} Days = **${peso(totals.labor.total)}**`,
    );
  }
  L.push('');
  L.push('---');
  L.push('');
  L.push('### 4. Direct Project Fees & Miscellaneous');
  L.push('');
  L.push(`* **Mobilization / Delivery Fee:** ${peso(totals.directFees.mobilization)}`);
  L.push(`* **Permits & Local Clearances:** ${peso(totals.directFees.permits)}`);
  L.push(`* **Equipment & Tool Rental:** ${peso(totals.directFees.equipment)}`);
  totals.directFees.other.forEach((o) => {
    L.push(`* **${o.label}:** ${peso(o.amount)}`);
  });
  L.push(`* **Total Direct Fees:** **${peso(totals.directFees.total)}**`);
  L.push('');
  L.push('---');
  L.push('');
  L.push('### 5. Final Cost Summary');
  L.push('');
  L.push('| Description | Amount (₱) |');
  L.push('| :--- | :--- |');
  L.push(`| **Total Materials (Marked-Up)** | ${peso(totals.materials.totalMarkedUp)} |`);
  L.push(`| **Total Labor Cost** | ${peso(totals.labor.total)} |`);
  L.push(`| **Total Direct Project Fees** | ${peso(totals.directFees.total)} |`);
  L.push(`| **Subtotal** | **${peso(totals.subtotal)}** |`);
  L.push(
    `| **VAT (12% - *if applicable*)** | ${totals.vatable ? peso(totals.vat) : `${peso(0)} (Non-VAT)`} |`,
  );
  L.push(`| **GRAND TOTAL** | **${peso(totals.grandTotal)}** |`);
  L.push('');
  L.push('---');
  L.push('');
  L.push('### 6. Terms & Conditions');
  L.push('');
  L.push(`* **Payment Schedule:** ${paymentSchedule(totals)}`);
  L.push(
    `* **Payment Options:** ${(terms.payment_options || []).join(', ') || '[e.g., Bank Transfer, GCash, Check]'}`,
  );
  L.push(
    `* **Exclusions:** ${(terms.exclusions || []).join('; ') || '[e.g., Main power tapping fees, structural modifications, scope outside this document]'}`,
  );
  L.push('');
  return L.join('\n');
}

function paymentSchedule(totals) {
  if (!totals.schedule.length) {
    return '[e.g., 50% Downpayment, 40% Progress Billing, 10% Final Turnover]';
  }
  return totals.schedule
    .map((s) => `${percent(s.pct)} ${s.label} (${peso(s.amount)})`)
    .join(', ');
}

export function markdownFileName(q) {
  const ref = String(q?.metadata?.reference_number || '').trim();
  const safe = (ref || 'quotation').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return `quotation_${safe || 'draft'}.md`;
}
