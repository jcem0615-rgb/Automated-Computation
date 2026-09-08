// The quotation data model. The on-disk shape is deliberately identical to
// examples/sample_input.json so files can be moved between LogicQuot and the
// original Claude Code project without translation.

import { isoToday } from './format.js';
import { VAT_STATUS } from './calc.js';

export function uid() {
  return `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function suggestReferenceNumber(existing = []) {
  const year = new Date().getFullYear();
  const prefix = `QTN-${year}-`;
  const highest = existing
    .map((q) => q?.metadata?.reference_number)
    .filter((ref) => typeof ref === 'string' && ref.startsWith(prefix))
    .map((ref) => parseInt(ref.slice(prefix.length), 10))
    .filter((n) => Number.isFinite(n))
    .reduce((max, n) => Math.max(max, n), 0);
  return `${prefix}${String(highest + 1).padStart(4, '0')}`;
}

export function emptyLineItem() {
  return { description: '', qty: null, unit: '', unit_cost: null, markup_pct: null };
}

export function emptyQuotation(overrides = {}) {
  return {
    id: uid(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    contractor: {
      company_name: '',
      prepared_by: '',
      contact_number: '',
      email: '',
      tin: '',
    },
    client: {
      client_name: '',
      company: '',
      contact_number: '',
      email: '',
      site_address: '',
    },
    metadata: {
      reference_number: '',
      issue_date: isoToday(),
      validity_period: '30 days from issue date',
    },
    materials: [emptyLineItem()],
    labor: { workers: null, daily_rate: null, days: null, flat_fee: null },
    direct_fees: {
      mobilization_delivery: null,
      permits_clearances: null,
      equipment_rental: null,
      other: [],
    },
    tax_and_terms: {
      vat_status: VAT_STATUS.NONE,
      downpayment_pct: null,
      progress_billing_pct: null,
      final_pct: null,
      payment_options: [],
      exclusions: [],
    },
    ...overrides,
  };
}

const toStr = (v) => (v === null || v === undefined ? '' : String(v));
const toNumOrNull = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const toList = (v) => {
  if (Array.isArray(v)) return v.map(toStr).filter(Boolean);
  if (typeof v === 'string') {
    return v
      .split(/\r?\n|,/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
};

// Accepts anything shaped roughly like sample_input.json (hand-written JSON
// included) and returns a fully-populated quotation.
export function normalizeQuotation(raw = {}, { keepId = true } = {}) {
  const base = emptyQuotation();
  const src = raw && typeof raw === 'object' ? raw : {};
  const materials = Array.isArray(src.materials) ? src.materials : [];
  const other = Array.isArray(src.direct_fees?.other) ? src.direct_fees.other : [];

  return {
    id: (keepId && toStr(src.id)) || base.id,
    created_at: toStr(src.created_at) || base.created_at,
    updated_at: toStr(src.updated_at) || base.updated_at,
    contractor: {
      company_name: toStr(src.contractor?.company_name),
      prepared_by: toStr(src.contractor?.prepared_by),
      contact_number: toStr(src.contractor?.contact_number),
      email: toStr(src.contractor?.email),
      tin: toStr(src.contractor?.tin),
    },
    client: {
      client_name: toStr(src.client?.client_name),
      company: toStr(src.client?.company),
      contact_number: toStr(src.client?.contact_number),
      email: toStr(src.client?.email),
      site_address: toStr(src.client?.site_address),
    },
    metadata: {
      reference_number: toStr(src.metadata?.reference_number),
      issue_date: toStr(src.metadata?.issue_date) || base.metadata.issue_date,
      validity_period: toStr(src.metadata?.validity_period),
    },
    materials: materials.length
      ? materials.map((m) => ({
          description: toStr(m?.description),
          qty: toNumOrNull(m?.qty),
          unit: toStr(m?.unit),
          unit_cost: toNumOrNull(m?.unit_cost),
          markup_pct: toNumOrNull(m?.markup_pct),
        }))
      : [emptyLineItem()],
    labor: {
      workers: toNumOrNull(src.labor?.workers),
      daily_rate: toNumOrNull(src.labor?.daily_rate),
      days: toNumOrNull(src.labor?.days),
      flat_fee: toNumOrNull(src.labor?.flat_fee),
    },
    direct_fees: {
      mobilization_delivery: toNumOrNull(src.direct_fees?.mobilization_delivery),
      permits_clearances: toNumOrNull(src.direct_fees?.permits_clearances),
      equipment_rental: toNumOrNull(src.direct_fees?.equipment_rental),
      other: other.map((o) => ({
        label: toStr(o?.label || o?.description) || 'Other Fee',
        amount: toNumOrNull(o?.amount),
      })),
    },
    tax_and_terms: {
      vat_status:
        toStr(src.tax_and_terms?.vat_status) === VAT_STATUS.VAT12
          ? VAT_STATUS.VAT12
          : VAT_STATUS.NONE,
      downpayment_pct: toNumOrNull(src.tax_and_terms?.downpayment_pct),
      progress_billing_pct: toNumOrNull(src.tax_and_terms?.progress_billing_pct),
      final_pct: toNumOrNull(src.tax_and_terms?.final_pct),
      payment_options: toList(src.tax_and_terms?.payment_options),
      exclusions: toList(src.tax_and_terms?.exclusions),
    },
  };
}

// The subset of a quotation worth remembering as "my company" defaults.
export function contractorDefaults(quotation) {
  return { ...emptyQuotation().contractor, ...(quotation?.contractor || {}) };
}
