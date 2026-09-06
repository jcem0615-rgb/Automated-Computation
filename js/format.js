// Display formatting helpers.
// Currency rule (docs/calculation_rules.md): ₱ symbol, comma thousands
// separator, exactly 2 decimals. Never round before this point.

const pesoFormatter = new Intl.NumberFormat('en-PH', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function peso(value) {
  const n = Number(value);
  return `₱${pesoFormatter.format(Number.isFinite(n) ? n : 0)}`;
}

// Percentages: no decimals unless the user gave a fractional markup.
export function percent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0%';
  return `${Number(n.toFixed(4))}%`;
}

export function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function qty(value) {
  const n = num(value);
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(4)));
}

export function isoToday() {
  const d = new Date();
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// "2026-09-06" -> "September 6, 2026". Falls back to the raw string so a
// user-typed date is never silently mangled.
export function longDate(iso) {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso).trim());
  if (!m) return String(iso);
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('en-PH', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}
