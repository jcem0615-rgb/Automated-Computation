// Quotation math — a direct implementation of docs/calculation_rules.md.
// Pure functions only: no DOM, no formatting, no early rounding.

import { num } from './format.js';

export const VAT_RATE = 0.12;
export const VAT_STATUS = { NONE: 'Non-VAT', VAT12: '12% VAT' };

// 1. Per line item
export function computeLine(item) {
  const quantity = num(item?.qty);
  const unitCost = num(item?.unit_cost);
  const markupPct = num(item?.markup_pct);
  const rawTotal = quantity * unitCost;
  const finalPrice = rawTotal * (1 + markupPct / 100);
  return {
    description: item?.description ?? '',
    unit: item?.unit ?? '',
    qty: quantity,
    unitCost,
    markupPct,
    rawTotal,
    markupAmount: finalPrice - rawTotal,
    finalPrice,
  };
}

// 2. Materials subtotal — both the raw sum and the marked-up sum are kept so
// the client can verify the markup.
export function computeMaterials(materials = []) {
  const lines = (materials || []).map(computeLine);
  return {
    lines,
    totalRaw: lines.reduce((sum, l) => sum + l.rawTotal, 0),
    totalMarkedUp: lines.reduce((sum, l) => sum + l.finalPrice, 0),
  };
}

// 3. Labor — a flat fee, when given, replaces the daily-rate computation.
export function computeLabor(labor = {}) {
  const flatFee = labor?.flat_fee;
  const usesFlatFee = flatFee !== null && flatFee !== undefined && flatFee !== '';
  if (usesFlatFee) {
    return { usesFlatFee: true, workers: 0, dailyRate: 0, days: 0, total: num(flatFee) };
  }
  const workers = num(labor?.workers);
  const dailyRate = num(labor?.daily_rate);
  const days = num(labor?.days);
  return { usesFlatFee: false, workers, dailyRate, days, total: workers * dailyRate * days };
}

// 4. Direct project fees
export function computeDirectFees(fees = {}) {
  const mobilization = num(fees?.mobilization_delivery);
  const permits = num(fees?.permits_clearances);
  const equipment = num(fees?.equipment_rental);
  const other = (fees?.other || []).map((o) => ({
    label: o?.label ?? o?.description ?? 'Other Fee',
    amount: num(o?.amount),
  }));
  const otherTotal = other.reduce((sum, o) => sum + o.amount, 0);
  return {
    mobilization,
    permits,
    equipment,
    other,
    otherTotal,
    total: mobilization + permits + equipment + otherTotal,
  };
}

export function isVatable(vatStatus) {
  return String(vatStatus || '').trim() === VAT_STATUS.VAT12;
}

// 5-7. Subtotal, VAT, Grand Total, plus the payment schedule split.
export function computeQuotation(input = {}) {
  const materials = computeMaterials(input.materials);
  const labor = computeLabor(input.labor);
  const directFees = computeDirectFees(input.direct_fees);
  const terms = input.tax_and_terms || {};

  const subtotal = materials.totalMarkedUp + labor.total + directFees.total;
  const vatable = isVatable(terms.vat_status);
  const vat = vatable ? subtotal * VAT_RATE : 0;
  const grandTotal = subtotal + vat;

  const schedule = [
    { label: 'Downpayment', pct: num(terms.downpayment_pct) },
    { label: 'Progress Billing', pct: num(terms.progress_billing_pct) },
    { label: 'Final Turnover', pct: num(terms.final_pct) },
  ]
    .filter((s) => s.pct > 0)
    .map((s) => ({ ...s, amount: grandTotal * (s.pct / 100) }));

  return {
    materials,
    labor,
    directFees,
    subtotal,
    vatable,
    vat,
    grandTotal,
    schedule,
    schedulePctTotal: schedule.reduce((sum, s) => sum + s.pct, 0),
  };
}
