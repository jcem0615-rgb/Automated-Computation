// Completeness check — the app-side equivalent of the "check completeness
// first" workflow rule, driven by docs/required_inputs.md.
// Nothing here invents a value: it only reports what is still missing.

import { num } from './format.js';

const blank = (v) => v === null || v === undefined || String(v).trim() === '';

export function checkCompleteness(q = {}) {
  const groups = [];
  const add = (section, items) => {
    const missing = items.filter(Boolean);
    if (missing.length) groups.push({ section, missing });
  };

  add('Contractor Details', [
    blank(q.contractor?.company_name) && 'Company Name',
    blank(q.contractor?.prepared_by) && 'Prepared By (Name & Title)',
    blank(q.contractor?.contact_number) && 'Contact Number',
    blank(q.contractor?.email) && 'Email',
  ]);

  add('Client Details', [
    blank(q.client?.client_name) && 'Client Name',
    blank(q.client?.contact_number) && 'Contact Number',
    blank(q.client?.email) && 'Email',
    blank(q.client?.site_address) && 'Project Site Address',
  ]);

  add('Quotation Metadata', [
    blank(q.metadata?.reference_number) && 'Reference Number',
    blank(q.metadata?.issue_date) && 'Issue Date',
    blank(q.metadata?.validity_period) && 'Validity Period',
  ]);

  const materials = Array.isArray(q.materials) ? q.materials : [];
  const usable = materials.filter((m) => !blank(m?.description));
  const materialIssues = [];
  if (!usable.length) {
    materialIssues.push('At least one item (description, qty, unit, unit cost, markup %)');
  }
  usable.forEach((m, i) => {
    const label = m.description || `Item ${i + 1}`;
    const gaps = [
      blank(m.qty) && 'quantity',
      blank(m.unit) && 'unit',
      blank(m.unit_cost) && 'unit cost',
      blank(m.markup_pct) && 'markup %',
    ].filter(Boolean);
    if (gaps.length) materialIssues.push(`${label}: ${gaps.join(', ')}`);
  });
  add('Materials & Items', materialIssues);

  const labor = q.labor || {};
  const usesFlatFee = !blank(labor.flat_fee);
  const laborIssues = [];
  if (!usesFlatFee) {
    if (blank(labor.workers) && blank(labor.daily_rate) && blank(labor.days)) {
      laborIssues.push('Workers × Daily Rate × Days, or a Flat Fee');
    } else {
      if (blank(labor.workers)) laborIssues.push('Number of Workers');
      if (blank(labor.daily_rate)) laborIssues.push('Daily Rate');
      if (blank(labor.days)) laborIssues.push('Number of Days');
    }
  }
  add('Labor Breakdown', laborIssues);

  add('Tax & Payment Terms', [
    blank(q.tax_and_terms?.vat_status) && 'VAT status (Non-VAT or 12% VAT)',
    blank(q.tax_and_terms?.downpayment_pct) && 'Downpayment %',
    blank(q.tax_and_terms?.progress_billing_pct) && 'Progress Billing %',
    !(q.tax_and_terms?.payment_options || []).length && 'Payment options',
  ]);

  const total = groups.reduce((sum, g) => sum + g.missing.length, 0);
  return { groups, total, complete: total === 0, warnings: collectWarnings(q) };
}

// Soft advisories — worth flagging, never blocking.
function collectWarnings(q) {
  const warnings = [];
  const t = q.tax_and_terms || {};
  const pct = num(t.downpayment_pct) + num(t.progress_billing_pct) + num(t.final_pct);
  if (pct > 0 && Math.abs(pct - 100) > 0.001) {
    warnings.push(`Payment schedule adds up to ${Number(pct.toFixed(2))}%, not 100%.`);
  }
  if (String(t.vat_status).trim() === '12% VAT' && blank(q.contractor?.tin)) {
    warnings.push('VAT quotations normally carry the contractor TIN / Tax ID.');
  }
  if (!(t.exclusions || []).length) {
    warnings.push('No exclusions listed — clients often expect these spelled out.');
  }
  const fees = q.direct_fees || {};
  const anyFee =
    !blank(fees.mobilization_delivery) ||
    !blank(fees.permits_clearances) ||
    !blank(fees.equipment_rental) ||
    (fees.other || []).length > 0;
  if (!anyFee) warnings.push('No direct project fees entered — confirm none apply.');
  return warnings;
}
