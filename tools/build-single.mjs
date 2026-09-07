// Bundles LogicQuot into one self-contained HTML file.
//
//   node tools/build-single.mjs [outfile]
//
// Used for the hosted browser preview. Three things the real app does cannot
// work in a sandboxed single page, and are adapted rather than left broken:
//   - a service worker and manifest (no offline, no install)
//   - file downloads (replaced with an on-screen, copyable export panel)
//   - fetching examples/sample_input.json (inlined instead)
// Everything else — the calculations, validation, Markdown rendering and
// localStorage persistence — is the same code the real app runs.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] || join(ROOT, 'dist', 'logicquot-preview.html');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

/* ---------- 1. Flatten the ES modules into one script ---------- */

// Dependency order: each module only depends on those listed before it.
const MODULES = [
  'js/format.js',
  'js/calc.js',
  'js/model.js',
  'js/validate.js',
  'js/markdown.js',
  'js/preview.js',
  'js/storage.js',
  'js/app.js',
];

const IMPORT_RE = /^import\s+[^;]*?from\s+['"][^'"]*['"];?[ \t]*$/gms;
const aliases = new Map();

const bodies = MODULES.map((path) => {
  const source = read(path);

  // `qty as fmtQty` would dangle once the import statement is stripped, so
  // record it and re-declare it as a plain const below.
  for (const stmt of source.match(IMPORT_RE) || []) {
    for (const [, original, alias] of stmt.matchAll(/([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)/g)) {
      aliases.set(alias, original);
    }
  }

  return `/* ===== ${path} ===== */\n${source
    .replace(IMPORT_RE, '')
    .replace(/^export\s+/gm, '')
    .trim()}`;
});

const aliasDecls = [...aliases]
  .map(([alias, original]) => `const ${alias} = ${original};`)
  .join('\n');

let script = [aliasDecls, ...bodies].filter(Boolean).join('\n\n');

/* ---------- 2. Adapt the parts the sandbox cannot run ---------- */

const patch = (find, replaceWith, label) => {
  if (!script.includes(find)) throw new Error(`build-single: could not patch ${label}`);
  script = script.replace(find, replaceWith);
};

// The sample ships inline instead of being fetched.
patch(
  `async function loadSample() {
  try {
    const res = await fetch('./examples/sample_input.json');
    if (!res.ok) throw new Error(\`HTTP \${res.status}\`);
    const data = await res.json();
    loadIntoBuilder(data, { announce: 'Sample project loaded' });
    goto('build');
  } catch (err) {
    console.error(err);
    toast('Could not load the sample file.');
  }
}`,
  `const SAMPLE_PROJECT = ${read('examples/sample_input.json').trim()};

function loadSample() {
  loadIntoBuilder(SAMPLE_PROJECT, { announce: 'Sample project loaded' });
  goto('build');
}`,
  'loadSample',
);

// Downloads are inert in the sandbox, so route every export to a panel the
// viewer can read and copy instead of silently doing nothing.
patch(
  `function download(filename, text, mime) {
  const blob = new Blob([text], { type: \`\${mime};charset=utf-8\` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}`,
  `function download(filename, text) {
  $('#export-name').textContent = filename;
  $('#export-text').value = text;
  $('#export-panel').hidden = false;
  $('#export-text').focus();
  $('#export-text').select();
}`,
  'download',
);

// No service worker in a sandboxed page.
patch(
  `  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch((err) => {
        console.warn('LogicQuot: service worker registration failed', err);
      });
    });
  }`,
  `  seedPreview();`,
  'service worker registration',
);

// The host stamps data-theme on <html> for its own light/dark setting.
// "System" must hand that stamp back rather than deleting it.
patch(
  `function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') {
    document.documentElement.setAttribute('data-theme', theme);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }`,
  `const HOST_THEME = document.documentElement.getAttribute('data-theme');

function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') {
    document.documentElement.setAttribute('data-theme', theme);
  } else if (HOST_THEME) {
    document.documentElement.setAttribute('data-theme', HOST_THEME);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }`,
  'applyTheme',
);

// Open on a working quotation rather than an empty shell.
script += `

/* ===== preview-only additions ===== */

// First visit lands on a filled-in quotation so the app shows what it does.
// A returning viewer keeps whatever they were working on.
function seedPreview() {
  if (listQuotations().length || getDraft()) return;
  const seeded = saveQuotation(normalizeQuotation(SAMPLE_PROJECT));
  loadIntoBuilder(seeded);
  goto('build');
}

$('#export-close').addEventListener('click', () => {
  $('#export-panel').hidden = true;
});

$('#export-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('#export-text').value);
    toast('Copied to clipboard.');
  } catch {
    $('#export-text').select();
    toast('Press Ctrl/Cmd+C to copy the selected text.');
  }
});
`;

/* ---------- 3. Assemble the page ---------- */

const html = read('index.html');
const body = html.slice(html.indexOf('<body>') + '<body>'.length, html.lastIndexOf('</body>'));

const logo = `data:image/svg+xml;base64,${Buffer.from(read('icons/logo.svg')).toString('base64')}`;

// The artifact runtime supplies <head>; the page must not set color-scheme
// only in <meta>, so it is declared on the token blocks instead.
const css = read('css/styles.css')
  .replace('--app-bar-h: 57px;', 'color-scheme: light;\n  --app-bar-h: 57px;')
  .replace(
    /(:root\[data-theme="dark"\] \{\n)/,
    '$1  color-scheme: dark;\n',
  )
  .replace(
    /(@media \(prefers-color-scheme: dark\) \{\n  :root:not\(\[data-theme="light"\]\) \{\n)/,
    '$1    color-scheme: dark;\n',
  );

let page = body
  .replace(/\s*<script type="module" src="\.\/js\/app\.js"><\/script>/, '')
  .replace(/src="\.\/icons\/logo\.svg"/g, `src="${logo}"`)
  // Downloads cannot leave the sandbox, so the labels promise what happens.
  .replace('>Download .md<', '>Show Markdown<')
  .replace('>Download .json<', '>Show JSON<')
  .replace('>Export all<', '>Show backup JSON<');

if (page.includes('Download .md') || page.includes('src="./icons/')) {
  throw new Error('build-single: an asset reference or download label was missed');
}

// A note about what differs here, and the export panel downloads are replaced by.
page = page.replace(
  '<main id="main" class="app-main">',
  `<p class="preview-note">
  Browser preview of LogicQuot. The calculations, validation and Markdown output
  are the real app's; installing, offline use and file downloads need the
  <a href="https://github.com/jcem0615-rgb/Automated-Computation/tree/claude/logicquot-pwa-app-ma2mb2">full version</a>.
  Your quotations are saved in this browser only.
</p>

<main id="main" class="app-main">`,
);

page = page.replace(
  '<div id="toast"',
  `<section id="export-panel" class="export-panel no-print" hidden aria-label="Export">
  <div class="export-panel__head">
    <h2 id="export-name">Export</h2>
    <button id="export-copy" class="btn btn--sm" type="button">Copy</button>
    <button id="export-close" class="btn btn--sm" type="button">Close</button>
  </div>
  <textarea id="export-text" readonly spellcheck="false" aria-label="Export contents"></textarea>
</section>

<div id="toast"`,
);

const extraCSS = `
/* ---------- Preview-only chrome ---------- */
.preview-note {
  margin: 0; padding: .55rem clamp(.75rem, 3vw, 1.5rem);
  background: var(--brand-soft); color: var(--brand-strong);
  font-size: .82rem; line-height: 1.45; border-bottom: 1px solid var(--border);
}
.preview-note a { color: inherit; font-weight: 700; }
:root[data-theme="dark"] .preview-note { color: var(--brand); }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .preview-note { color: var(--brand); }
}

.export-panel {
  position: fixed; inset: auto 0 0 0; z-index: 40;
  max-height: min(70vh, 640px);
  display: flex; flex-direction: column; gap: .6rem;
  padding: .85rem clamp(.75rem, 3vw, 1.5rem) calc(.85rem + env(safe-area-inset-bottom));
  background: var(--surface); border-top: 1px solid var(--border-strong);
  box-shadow: 0 -8px 32px rgba(0, 0, 0, .18);
}
.export-panel__head { display: flex; align-items: center; gap: .5rem; }
.export-panel__head h2 {
  margin: 0; flex: 1 1 auto; min-width: 0;
  font-family: var(--mono); font-size: .82rem; font-weight: 600;
  color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
#export-text {
  flex: 1 1 auto; min-height: 220px; resize: none;
  font-family: var(--mono); font-size: .78rem; line-height: 1.5;
  white-space: pre; overflow: auto;
}
@media (max-width: 999px) {
  /* Clear the fixed cost-summary bar underneath. */
  .export-panel { bottom: 0; max-height: 60vh; }
}
`;

const doc = `<title>LogicQuot</title>
<style>
${css}
${extraCSS}
</style>
${page.trim()}

<script type="module">
${script}
</script>
`;

writeFileSync(out, doc);
console.log(`${out}  (${(doc.length / 1024).toFixed(0)} KB)`);
