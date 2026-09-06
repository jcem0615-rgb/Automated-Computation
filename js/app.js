// LogicQuot application controller: routing, form binding, live totals,
// exports and PWA install/offline plumbing.

import { peso, num, isoToday } from './format.js';
import { computeQuotation, VAT_STATUS } from './calc.js';
import {
  emptyQuotation,
  emptyLineItem,
  normalizeQuotation,
  suggestReferenceNumber,
  contractorDefaults,
} from './model.js';
import {
  listQuotations,
  getQuotation,
  saveQuotation,
  deleteQuotation,
  duplicateQuotation,
  getSettings,
  saveSettings,
  getDraft,
  saveDraft,
  clearDraft,
  exportAll,
  importAll,
} from './storage.js';
import { checkCompleteness } from './validate.js';
import { quotationToMarkdown, markdownFileName } from './markdown.js';
import { renderQuotationHTML } from './preview.js';

const APP_VERSION = '1.0.0';
const ROUTES = ['quotations', 'build', 'preview', 'settings'];

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

let current = emptyQuotation();
let deferredInstallPrompt = null;

/* ------------------------------------------------------------------ */
/* Toast                                                               */
/* ------------------------------------------------------------------ */
let toastTimer = null;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, 2600);
}

/* ------------------------------------------------------------------ */
/* Theme                                                               */
/* ------------------------------------------------------------------ */
const THEME_ICONS = { system: '◐', light: '☀', dark: '☾' };

function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') {
    document.documentElement.setAttribute('data-theme', theme);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  const icon = $('#theme-icon');
  if (icon) icon.textContent = THEME_ICONS[theme] || THEME_ICONS.system;
}

function cycleTheme() {
  const order = ['system', 'light', 'dark'];
  const next = order[(order.indexOf(getSettings().theme) + 1) % order.length];
  saveSettings({ theme: next });
  applyTheme(next);
  toast(`Theme: ${next}`);
}

/* ------------------------------------------------------------------ */
/* Form <-> model binding                                              */
/* ------------------------------------------------------------------ */
const LIST_FIELDS = new Set(['tax_and_terms.payment_options', 'tax_and_terms.exclusions']);

function getPath(obj, path) {
  return path.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((acc, key) => {
    if (acc[key] === null || typeof acc[key] !== 'object') acc[key] = {};
    return acc[key];
  }, obj);
  target[last] = value;
}

const NUMERIC_PATHS = new Set([
  'labor.workers',
  'labor.daily_rate',
  'labor.days',
  'labor.flat_fee',
  'direct_fees.mobilization_delivery',
  'direct_fees.permits_clearances',
  'direct_fees.equipment_rental',
  'tax_and_terms.downpayment_pct',
  'tax_and_terms.progress_billing_pct',
  'tax_and_terms.final_pct',
]);

function readInput(input) {
  const path = input.name;
  if (LIST_FIELDS.has(path)) {
    return input.value
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (NUMERIC_PATHS.has(path)) {
    return input.value === '' ? null : Number(input.value);
  }
  return input.value;
}

// Push the model into the form controls.
function fillForm(q) {
  $$('#builder-form [name]').forEach((input) => {
    const path = input.name;
    if (path === 'labor_mode' || path === 'tax_and_terms.vat_status') return;
    const value = getPath(q, path);
    if (LIST_FIELDS.has(path)) {
      input.value = Array.isArray(value) ? value.join('\n') : '';
    } else {
      input.value = value === null || value === undefined ? '' : String(value);
    }
  });

  const usesFlatFee = q.labor?.flat_fee !== null && q.labor?.flat_fee !== undefined;
  const mode = usesFlatFee ? 'flat' : 'daily';
  $$('input[name="labor_mode"]').forEach((r) => {
    r.checked = r.value === mode;
  });
  setLaborMode(mode);

  const vat = q.tax_and_terms?.vat_status === VAT_STATUS.VAT12 ? VAT_STATUS.VAT12 : VAT_STATUS.NONE;
  $$('input[name="tax_and_terms.vat_status"]').forEach((r) => {
    r.checked = r.value === vat;
  });

  renderBOM(q);
  renderOtherFees(q);
}

// Pull the form controls back into the model (BOM/fees handled separately).
function harvestForm() {
  $$('#builder-form [name]').forEach((input) => {
    const path = input.name;
    if (path === 'labor_mode') return;
    if (input.type === 'radio') {
      if (input.checked) setPath(current, path, input.value);
      return;
    }
    setPath(current, path, readInput(input));
  });

  // Whichever labor mode is inactive must not leak values into the math.
  const mode = $('input[name="labor_mode"]:checked')?.value || 'daily';
  if (mode === 'flat') {
    current.labor.workers = null;
    current.labor.days = null;
    current.labor.daily_rate = null;
  } else {
    current.labor.flat_fee = null;
  }
}

function setLaborMode(mode) {
  $('#labor-daily').hidden = mode === 'flat';
  $('#labor-flat').hidden = mode !== 'flat';
}

/* ------------------------------------------------------------------ */
/* Bill of materials rows                                              */
/* ------------------------------------------------------------------ */
function renderBOM(q) {
  const body = $('#bom-body');
  body.innerHTML = '';
  (q.materials || []).forEach((item, index) => {
    body.appendChild(buildBOMRow(item, index));
  });
  refreshBOMTotals();
}

function buildBOMRow(item, index) {
  const tr = document.createElement('tr');
  tr.dataset.index = String(index);
  // data-label drives the stacked card layout used on narrow screens.
  tr.innerHTML = `
    <td data-label="Item"><input type="text" data-field="description" placeholder="Portland Cement 40kg" aria-label="Item ${index + 1} description" /></td>
    <td data-label="Qty"><input type="number" data-field="qty" min="0" step="any" inputmode="decimal" class="num" aria-label="Item ${index + 1} quantity" /></td>
    <td data-label="Unit"><input type="text" data-field="unit" placeholder="pc" aria-label="Item ${index + 1} unit" /></td>
    <td data-label="Unit cost"><input type="number" data-field="unit_cost" min="0" step="0.01" inputmode="decimal" class="num" aria-label="Item ${index + 1} unit cost" /></td>
    <td data-label="Raw total" class="num" data-cell="raw">₱0.00</td>
    <td data-label="Markup %"><input type="number" data-field="markup_pct" min="0" step="0.01" inputmode="decimal" class="num" aria-label="Item ${index + 1} markup percent" /></td>
    <td data-label="Final price" class="num strong" data-cell="final">₱0.00</td>
    <td class="bom__remove"><button type="button" class="row-remove" aria-label="Remove item ${index + 1}">×</button></td>`;

  $$('[data-field]', tr).forEach((input) => {
    const value = item[input.dataset.field];
    input.value = value === null || value === undefined ? '' : String(value);
  });
  return tr;
}

function harvestBOM() {
  current.materials = $$('#bom-body tr').map((tr) => {
    const read = (field) => $(`[data-field="${field}"]`, tr).value;
    const numOrNull = (field) => (read(field) === '' ? null : Number(read(field)));
    return {
      description: read('description'),
      qty: numOrNull('qty'),
      unit: read('unit'),
      unit_cost: numOrNull('unit_cost'),
      markup_pct: numOrNull('markup_pct'),
    };
  });
  if (!current.materials.length) current.materials = [emptyLineItem()];
}

function refreshBOMTotals() {
  const totals = computeQuotation(current);
  $$('#bom-body tr').forEach((tr, i) => {
    const line = totals.materials.lines[i];
    if (!line) return;
    $('[data-cell="raw"]', tr).textContent = peso(line.rawTotal);
    $('[data-cell="final"]', tr).textContent = peso(line.finalPrice);
  });
  $('#bom-raw-total').textContent = peso(totals.materials.totalRaw);
  $('#bom-final-total').textContent = peso(totals.materials.totalMarkedUp);
}

/* ------------------------------------------------------------------ */
/* Extra direct fees                                                   */
/* ------------------------------------------------------------------ */
function renderOtherFees(q) {
  const wrap = $('#other-fees');
  wrap.innerHTML = '';
  (q.direct_fees?.other || []).forEach((fee, index) => {
    const row = document.createElement('div');
    row.className = 'fee-row';
    row.innerHTML = `
      <input type="text" data-fee="label" placeholder="Site fencing" aria-label="Fee ${index + 1} label" />
      <input type="number" data-fee="amount" min="0" step="0.01" inputmode="decimal" class="num" placeholder="0.00" aria-label="Fee ${index + 1} amount" />
      <button type="button" class="row-remove" aria-label="Remove fee ${index + 1}">×</button>`;
    $('[data-fee="label"]', row).value = fee.label ?? '';
    $('[data-fee="amount"]', row).value =
      fee.amount === null || fee.amount === undefined ? '' : String(fee.amount);
    wrap.appendChild(row);
  });
}

function harvestOtherFees() {
  current.direct_fees.other = $$('#other-fees .fee-row').map((row) => ({
    label: $('[data-fee="label"]', row).value || 'Other Fee',
    amount: $('[data-fee="amount"]', row).value === '' ? null : Number($('[data-fee="amount"]', row).value),
  }));
}

/* ------------------------------------------------------------------ */
/* Live recalculation                                                  */
/* ------------------------------------------------------------------ */
function recalc({ persistDraft = true } = {}) {
  harvestForm();
  harvestBOM();
  harvestOtherFees();

  const t = computeQuotation(current);
  refreshBOMTotals();

  $('#labor-total').textContent = peso(t.labor.total);
  $('#fees-total').textContent = peso(t.directFees.total);
  $('#sum-materials').textContent = peso(t.materials.totalMarkedUp);
  $('#sum-labor').textContent = peso(t.labor.total);
  $('#sum-fees').textContent = peso(t.directFees.total);
  $('#sum-subtotal').textContent = peso(t.subtotal);
  $('#sum-vat').textContent = peso(t.vat);
  $('#sum-vat-label').textContent = t.vatable ? 'VAT (12%)' : 'VAT (Non-VAT)';
  $('#sum-grand').textContent = peso(t.grandTotal);

  const hint = $('#schedule-hint');
  if (t.schedule.length) {
    const parts = t.schedule.map((s) => `${s.label}: ${peso(s.amount)}`).join(' · ');
    const off = Math.abs(t.schedulePctTotal - 100) > 0.001;
    hint.textContent = off
      ? `${parts} — heads up, these add up to ${Number(t.schedulePctTotal.toFixed(2))}%, not 100%.`
      : parts;
  } else {
    hint.textContent = '';
  }

  renderCompleteness();
  if (persistDraft) saveDraft(current);
}

function renderCompleteness() {
  const result = checkCompleteness(current);
  const box = $('#completeness');
  if (result.complete && !result.warnings.length) {
    box.innerHTML = '<span class="completeness__ok">✓ All required inputs provided.</span>';
    return;
  }
  const parts = [];
  if (!result.complete) {
    parts.push(
      `<span class="completeness__title">${result.total} item${result.total === 1 ? '' : 's'} still needed</span>`,
    );
    result.groups.forEach((g) => {
      parts.push(
        `<strong>${g.section}</strong><ul>${g.missing.map((m) => `<li>${escapeHTML(m)}</li>`).join('')}</ul>`,
      );
    });
  } else {
    parts.push('<span class="completeness__ok">✓ All required inputs provided.</span>');
  }
  if (result.warnings.length) {
    parts.push(
      `<ul>${result.warnings.map((w) => `<li>${escapeHTML(w)}</li>`).join('')}</ul>`,
    );
  }
  box.innerHTML = parts.join('');
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

/* ------------------------------------------------------------------ */
/* Quotation list                                                      */
/* ------------------------------------------------------------------ */
function renderList() {
  const wrap = $('#quotation-list');
  const rows = listQuotations();
  if (!rows.length) {
    wrap.innerHTML = `<div class="empty">
      <p><strong>No quotations yet.</strong></p>
      <p>Start a new one, or load the sample project to see how it works.</p>
    </div>`;
    return;
  }
  wrap.innerHTML = rows
    .map((q) => {
      const t = computeQuotation(q);
      const ref = q.metadata?.reference_number || 'No reference number';
      const client = q.client?.client_name || 'Untitled client';
      const updated = new Date(q.updated_at);
      const when = Number.isNaN(updated.getTime()) ? '' : updated.toLocaleString('en-PH');
      return `<article class="qcard">
        <span class="qcard__ref">${escapeHTML(ref)}</span>
        <span class="qcard__client">${escapeHTML(client)}</span>
        <span class="qcard__total">${escapeHTML(peso(t.grandTotal))}</span>
        <span class="qcard__meta">${escapeHTML(q.tax_and_terms?.vat_status || '')} · updated ${escapeHTML(when)}</span>
        <div class="qcard__actions">
          <button class="btn btn--sm" data-action="open" data-id="${escapeHTML(q.id)}">Open</button>
          <button class="btn btn--sm" data-action="duplicate" data-id="${escapeHTML(q.id)}">Duplicate</button>
          <button class="btn btn--sm btn--danger" data-action="delete" data-id="${escapeHTML(q.id)}">Delete</button>
        </div>
      </article>`;
    })
    .join('');
}

/* ------------------------------------------------------------------ */
/* Preview                                                             */
/* ------------------------------------------------------------------ */
function renderPreview() {
  $('#quotation-paper').innerHTML = renderQuotationHTML(current);
  const result = checkCompleteness(current);
  const box = $('#preview-warnings');
  if (result.complete) {
    box.innerHTML = '';
    return;
  }
  const items = result.groups
    .map((g) => `<li><strong>${escapeHTML(g.section)}:</strong> ${escapeHTML(g.missing.join(', '))}</li>`)
    .join('');
  box.innerHTML = `<div class="notice"><strong>Still missing — these show as placeholders below.</strong><ul>${items}</ul></div>`;
}

/* ------------------------------------------------------------------ */
/* Downloads                                                           */
/* ------------------------------------------------------------------ */
function download(filename, text, mime) {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Only the fields the original project's JSON schema carries — LogicQuot's own
// bookkeeping (id, timestamps) is dropped so the file imports cleanly anywhere.
const PORTABLE_KEYS = [
  'contractor',
  'client',
  'metadata',
  'materials',
  'labor',
  'direct_fees',
  'tax_and_terms',
];

function toPortableJSON(q) {
  const out = {};
  PORTABLE_KEYS.forEach((key) => {
    out[key] = q[key];
  });
  return JSON.stringify(out, null, 2);
}

/* ------------------------------------------------------------------ */
/* Routing                                                             */
/* ------------------------------------------------------------------ */
function currentRoute() {
  const raw = (location.hash || '').replace(/^#\/?/, '').split('?')[0];
  return ROUTES.includes(raw) ? raw : 'quotations';
}

function showRoute() {
  const route = currentRoute();
  ROUTES.forEach((r) => {
    $(`#view-${r}`).hidden = r !== route;
  });
  $$('.tab').forEach((tab) => {
    if (tab.dataset.route === route) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  });
  if (route === 'quotations') renderList();
  if (route === 'preview') {
    recalc();
    renderPreview();
  }
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function goto(route) {
  if (location.hash === `#/${route}`) showRoute();
  else location.hash = `#/${route}`;
}

/* ------------------------------------------------------------------ */
/* Loading quotations into the builder                                 */
/* ------------------------------------------------------------------ */
function loadIntoBuilder(q, { announce } = {}) {
  current = normalizeQuotation(q);
  fillForm(current);
  recalc();
  if (announce) toast(announce);
}

function startNewQuotation() {
  const fresh = emptyQuotation();
  const defaults = getSettings().contractor;
  if (defaults) fresh.contractor = { ...fresh.contractor, ...defaults };
  fresh.metadata.reference_number = suggestReferenceNumber(listQuotations());
  fresh.metadata.issue_date = isoToday();
  loadIntoBuilder(fresh);
  goto('build');
}

async function loadSample() {
  try {
    const res = await fetch('./examples/sample_input.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    loadIntoBuilder(data, { announce: 'Sample project loaded' });
    goto('build');
  } catch (err) {
    console.error(err);
    toast('Could not load the sample file.');
  }
}

/* ------------------------------------------------------------------ */
/* Event wiring                                                        */
/* ------------------------------------------------------------------ */
function wireEvents() {
  window.addEventListener('hashchange', showRoute);

  const form = $('#builder-form');
  form.addEventListener('input', (e) => {
    if (e.target.name === 'labor_mode') return;
    recalc();
  });
  form.addEventListener('change', (e) => {
    if (e.target.name === 'labor_mode') {
      setLaborMode(e.target.value);
    }
    recalc();
  });
  form.addEventListener('submit', (e) => e.preventDefault());

  $('#add-item').addEventListener('click', () => {
    current.materials.push(emptyLineItem());
    renderBOM(current);
    recalc();
    const last = $('#bom-body tr:last-child input');
    if (last) last.focus();
  });

  $('#bom-body').addEventListener('click', (e) => {
    const btn = e.target.closest('.row-remove');
    if (!btn) return;
    const rows = $$('#bom-body tr');
    const index = rows.indexOf(btn.closest('tr'));
    if (index < 0) return;
    harvestBOM();
    current.materials.splice(index, 1);
    if (!current.materials.length) current.materials = [emptyLineItem()];
    renderBOM(current);
    recalc();
  });

  $('#apply-blanket').addEventListener('click', () => {
    const value = $('#blanket-markup').value;
    if (value === '') {
      toast('Enter a markup % first.');
      return;
    }
    harvestBOM();
    current.materials = current.materials.map((m) => ({ ...m, markup_pct: Number(value) }));
    renderBOM(current);
    recalc();
    toast(`Applied ${num(value)}% to every line item.`);
  });

  $('#add-fee').addEventListener('click', () => {
    harvestOtherFees();
    current.direct_fees.other.push({ label: '', amount: null });
    renderOtherFees(current);
    recalc();
  });

  $('#other-fees').addEventListener('click', (e) => {
    const btn = e.target.closest('.row-remove');
    if (!btn) return;
    const rows = $$('#other-fees .fee-row');
    const index = rows.indexOf(btn.closest('.fee-row'));
    if (index < 0) return;
    harvestOtherFees();
    current.direct_fees.other.splice(index, 1);
    renderOtherFees(current);
    recalc();
  });

  $('#suggest-ref').addEventListener('click', () => {
    const input = $('input[name="metadata.reference_number"]');
    input.value = suggestReferenceNumber(listQuotations());
    recalc();
  });

  $('#save-contractor').addEventListener('click', () => {
    recalc();
    saveSettings({ contractor: contractorDefaults(current) });
    toast('Saved as your default contractor details.');
  });

  $('#apply-contractor').addEventListener('click', () => {
    const defaults = getSettings().contractor;
    if (!defaults) {
      toast('No default saved yet.');
      return;
    }
    current.contractor = { ...current.contractor, ...defaults };
    fillForm(current);
    recalc();
    toast('Default contractor details applied.');
  });

  $('#save-quotation').addEventListener('click', () => {
    recalc();
    const saved = saveQuotation(current);
    current.updated_at = saved.updated_at;
    clearDraft();
    const result = checkCompleteness(current);
    $('#save-status').textContent = result.complete
      ? `Saved ${new Date().toLocaleTimeString('en-PH')}.`
      : `Saved as a draft — ${result.total} required item${result.total === 1 ? '' : 's'} still missing.`;
    toast('Quotation saved on this device.');
  });

  $('#new-quotation').addEventListener('click', startNewQuotation);
  $('#load-sample').addEventListener('click', loadSample);

  $('#quotation-list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { action, id } = btn.dataset;
    if (action === 'open') {
      const q = getQuotation(id);
      if (!q) return toast('That quotation no longer exists.');
      loadIntoBuilder(q);
      goto('build');
    } else if (action === 'duplicate') {
      duplicateQuotation(id);
      renderList();
      toast('Duplicated. The copy needs a new reference number.');
    } else if (action === 'delete') {
      const q = getQuotation(id);
      const label = q?.metadata?.reference_number || q?.client?.client_name || 'this quotation';
      if (confirm(`Delete ${label}? This cannot be undone.`)) {
        deleteQuotation(id);
        renderList();
        toast('Deleted.');
      }
    }
  });

  $('#print-btn').addEventListener('click', () => window.print());

  $('#download-md').addEventListener('click', () => {
    recalc();
    download(markdownFileName(current), quotationToMarkdown(current), 'text/markdown');
  });

  $('#download-json').addEventListener('click', () => {
    recalc();
    download(markdownFileName(current).replace(/\.md$/, '.json'), toPortableJSON(current), 'application/json');
  });

  $('#copy-md').addEventListener('click', async () => {
    recalc();
    const md = quotationToMarkdown(current);
    try {
      await navigator.clipboard.writeText(md);
      toast('Markdown copied to clipboard.');
    } catch {
      download(markdownFileName(current), md, 'text/markdown');
      toast('Clipboard unavailable — downloaded the file instead.');
    }
  });

  $('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (Array.isArray(data?.quotations)) {
        const count = importAll(data);
        $('#import-status').textContent = `Imported ${count} quotation${count === 1 ? '' : 's'}.`;
        renderList();
        toast(`Imported ${count} quotation${count === 1 ? '' : 's'}.`);
      } else {
        loadIntoBuilder(data);
        $('#import-status').textContent = `Loaded ${file.name} into the builder.`;
        goto('build');
        toast('Loaded into the builder.');
      }
    } catch (err) {
      console.error(err);
      $('#import-status').textContent = 'That file is not valid JSON.';
      toast('Could not read that file.');
    } finally {
      e.target.value = '';
    }
  });

  $('#export-all').addEventListener('click', () => {
    const stamp = isoToday();
    download(`logicquot-backup-${stamp}.json`, JSON.stringify(exportAll(), null, 2), 'application/json');
  });

  $('#clear-all').addEventListener('click', () => {
    if (!confirm('Delete every quotation and setting stored on this device? This cannot be undone.')) return;
    listQuotations().forEach((q) => deleteQuotation(q.id));
    clearDraft();
    renderList();
    toast('All local data deleted.');
  });

  $('#theme-btn').addEventListener('click', cycleTheme);

  // Install prompt (Chromium). Safari/iOS users add to Home Screen manually.
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    $('#install-btn').hidden = false;
  });

  $('#install-btn').addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    $('#install-btn').hidden = true;
  });

  window.addEventListener('appinstalled', () => {
    $('#install-btn').hidden = true;
    toast('LogicQuot installed.');
  });

  const updateOnlineBadge = () => {
    $('#offline-badge').hidden = navigator.onLine;
  };
  window.addEventListener('online', updateOnlineBadge);
  window.addEventListener('offline', updateOnlineBadge);
  updateOnlineBadge();
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */
function boot() {
  applyTheme(getSettings().theme);
  $('#app-version').textContent = `v${APP_VERSION}`;

  const draft = getDraft();
  current = draft || emptyQuotation();
  if (!draft) {
    const defaults = getSettings().contractor;
    if (defaults) current.contractor = { ...current.contractor, ...defaults };
  }

  fillForm(current);
  wireEvents();
  recalc({ persistDraft: false });
  showRoute();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch((err) => {
        console.warn('LogicQuot: service worker registration failed', err);
      });
    });
  }
}

boot();
