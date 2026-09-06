// localStorage persistence. Everything stays on the device — LogicQuot has no
// backend, which is also what lets it work fully offline.

import { normalizeQuotation, emptyQuotation } from './model.js';

const KEYS = {
  quotations: 'logicquot.quotations.v1',
  settings: 'logicquot.settings.v1',
  draft: 'logicquot.draft.v1',
};

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    console.warn('LogicQuot: could not save to localStorage', err);
    return false;
  }
}

export function listQuotations() {
  const rows = readJSON(KEYS.quotations, []);
  if (!Array.isArray(rows)) return [];
  return rows
    .map((r) => normalizeQuotation(r))
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
}

export function getQuotation(id) {
  return listQuotations().find((q) => q.id === id) || null;
}

export function saveQuotation(quotation) {
  const rows = readJSON(KEYS.quotations, []);
  const list = Array.isArray(rows) ? rows : [];
  const record = { ...quotation, updated_at: new Date().toISOString() };
  const idx = list.findIndex((q) => q?.id === record.id);
  if (idx >= 0) list[idx] = record;
  else list.unshift(record);
  writeJSON(KEYS.quotations, list);
  return record;
}

export function deleteQuotation(id) {
  const rows = readJSON(KEYS.quotations, []);
  const list = (Array.isArray(rows) ? rows : []).filter((q) => q?.id !== id);
  writeJSON(KEYS.quotations, list);
}

export function duplicateQuotation(id) {
  const source = getQuotation(id);
  if (!source) return null;
  const copy = normalizeQuotation(source, { keepId: false });
  copy.id = emptyQuotation().id;
  copy.created_at = new Date().toISOString();
  copy.updated_at = copy.created_at;
  copy.metadata.reference_number = '';
  return saveQuotation(copy);
}

export function getSettings() {
  const s = readJSON(KEYS.settings, {});
  return {
    theme: s?.theme === 'light' || s?.theme === 'dark' ? s.theme : 'system',
    contractor: s?.contractor || null,
    ...s,
  };
}

export function saveSettings(patch) {
  const next = { ...getSettings(), ...patch };
  writeJSON(KEYS.settings, next);
  return next;
}

export function getDraft() {
  const d = readJSON(KEYS.draft, null);
  return d ? normalizeQuotation(d) : null;
}

export function saveDraft(quotation) {
  writeJSON(KEYS.draft, quotation);
}

export function clearDraft() {
  try {
    localStorage.removeItem(KEYS.draft);
  } catch {
    /* nothing to clean up */
  }
}

export function exportAll() {
  return {
    app: 'LogicQuot',
    exported_at: new Date().toISOString(),
    quotations: listQuotations(),
    settings: getSettings(),
  };
}

// Merges an export back in; existing ids are overwritten, new ones appended.
export function importAll(payload) {
  const incoming = Array.isArray(payload?.quotations)
    ? payload.quotations
    : Array.isArray(payload)
      ? payload
      : [];
  let count = 0;
  incoming.forEach((q) => {
    saveQuotation(normalizeQuotation(q));
    count += 1;
  });
  return count;
}
