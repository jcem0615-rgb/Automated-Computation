# LogicQuot — project instructions

LogicQuot is an offline-first PWA that generates itemized Philippine Peso (₱)
project cost quotations. It is a port of the `ph-quotation-generator` Claude Code
project, so the domain rules were inherited, not invented — treat the documents
below as the specification and the code as an implementation of them.

## Source of truth

- `docs/calculation_rules.md` — the exact formulas and order of operations.
  `js/calc.js` implements these; change the doc first, then the code and tests.
- `docs/required_inputs.md` — the checklist a quotation must satisfy.
  `js/validate.js` implements it.
- `templates/quotation_template.md` — the fixed Markdown output layout.
  `js/markdown.js` fills in its bracketed placeholders. **Do not restructure the
  tables, section order or headers.**
- `examples/sample_input.json` — the canonical JSON shape. The app's import and
  export both speak exactly this schema, which is what lets files move between
  LogicQuot and the original Claude Code project.

## Rules that must hold

- **Never invent data.** A missing TIN, reference number, price or contact detail
  stays a visible `[placeholder]` in the output and shows up in the completeness
  check. The app asks; it does not guess.
- **No early rounding.** Intermediate values stay at full precision; rounding to
  two decimals happens only at display time, in `js/format.js`.
- **Currency is always** `₱` + comma thousands separator + 2 decimals.
- **Show the markup.** Both the raw total and the marked-up final price appear per
  line item, so a client can verify the arithmetic.
- **Non-VAT still shows the VAT row**, at ₱0.00.

## Architecture

Vanilla ES modules, no build step, no dependencies at runtime. Playwright is a
dev-only dependency used for icon generation and the browser smoke test.

- `js/calc.js`, `js/format.js`, `js/model.js`, `js/markdown.js`, `js/validate.js`
  are **pure** — no DOM access — which is what makes them unit-testable under
  `node --test`. Keep them that way.
- `js/app.js` owns all DOM wiring and is the only module that touches the form.
- `js/storage.js` is the only module that touches `localStorage`.
- There is no backend. Everything stays on the user's device.

## Working on it

```bash
npm start      # static server on :8080 (tools/serve.mjs, zero dependencies)
npm test       # unit tests (calculations, markdown layout, validation)
npm run e2e    # browser smoke test — needs the server running + npm install
npm run build  # single-file bundle -> dist/ (see tools/build-single.mjs)
npm run icons  # regenerate PNGs from icons/logo.svg
```

`npm start` and `npm test` must keep working on a bare clone with no
`npm install` — only the Playwright-backed scripts may require dependencies.

Both suites should pass before committing. `tests/quotation.test.mjs` pins the
sample project's figures (₱45,800.00 raw → ₱51,470.00 marked up → ₱142,970.00
subtotal → ₱160,126.40 grand total); if a change moves those numbers, that is a
calculation-rule change and needs the doc updated too.

Floating-point note: totals are compared with a tolerance, not `===`, precisely
because intermediates are deliberately unrounded.

`tools/build-single.mjs` inlines the modules by hand-maintained dependency
order and patches a few functions by exact source match. It throws rather than
emitting a broken bundle, so if you rename a module or edit `loadSample`,
`download`, `applyTheme` or the service-worker registration in `js/app.js`,
run `npm run build` and update the patch targets it reports.

`icons/logo.svg` is the only icon artwork. `npm run icons` rasterises it to
every PNG size and derives the maskable variant from it in-memory, padded into
the 80% safe zone — so edit the SVG, never the PNGs, and re-run the script.

## When adding or renaming files

Update the `PRECACHE` list in `sw.js` **and** bump `CACHE_VERSION`, or returning
users will keep the stale cached shell and the new file will 404 offline.
