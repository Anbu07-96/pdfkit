# pdfjs-text: the pdf-to-text alternative engine (Phase 73)

Status: **implemented, gated OFF by default, experimental.** `current-pdfium-text`
remains the default pdf-to-text engine. This document is the contract for the
second engine: what it is, how it is gated, where it diverges from the current
engine, and what is deliberately NOT implemented.

## 1. What was integrated

[pdfjs-dist](https://www.npmjs.com/package/pdfjs-dist) 6.3.289 (Apache-2.0,
pure JavaScript, zero runtime dependencies) as a **server-side** text
extraction engine:

- `src/lib/processing/pdfjs/positioned-text.ts` — the only production module
  importing `pdfjs-dist` (`pdfjs-dist/legacy/build/pdf.mjs`, the Node build).
  Loads documents with `disableFontFace: true`, `verbosity: 0`, and **no
  `cMapUrl` / `standardFontDataUrl`** — no network access, no CDN, no external
  worker (§19/§20). `extractPdfjsTextPages()` enforces the same page-count
  limit shape as the current engine **before** touching pages and a per-page
  item cap (`MAX_TEXT_ITEMS_PER_PAGE = 250_000`).
- `src/lib/processing/processors/pdf-to-text-pdfjs.ts` — a contract mirror of
  the pdfium pdf-to-text processor: identical input rules, identical
  `parsePdfToTextOptions`, identical page markers/placeholders/cleanup regex,
  identical meta keys and artifact naming. **No fallback** to the current
  engine, ever (§12).
- `src/lib/engines/adapters/pdfjs-text.ts` — engine adapter `pdfjs-text`
  (v0.1.0, in-process, Apache-2.0).
- Reading order: `reconstructPdfjsLines()` rebuilds lines from positioned
  items (y-bucket 2 units, x-sort, column split at 60-unit gaps), O(N log N),
  proven in Phase 72 benchmarks (1.00 reading-order accuracy on layout
  fixtures vs 0.00–0.44 for pdfium).

The engine is registered as an **alternative** (`registerAlternative()`), not a
default: `byConversion()` still returns only the 11 defaults, `selectEngine()`
without options is unchanged, and the registry enforces that alternatives can
never become defaults (§6/§7).

## 2. Gating and kill switch (§43)

One environment variable controls everything:

```
PDFKIT_PDF_TO_TEXT_ENGINE=pdfjs
```

- **Default OFF.** Unset (or any value other than exactly `pdfjs` after
  trim+lowercase) → `current-pdfium-text`, bit-for-bit Phase 72 behavior
  (§33).
- **Fail-closed.** Missing, `false`, `0`, empty, malformed, engine *ids*
  (`pdfjs-text`), other tools' names, arbitrary strings — all resolve to the
  current engine. There is no way to select an arbitrary engine by string.
- **Server-side only.** The variable is read in
  `src/lib/engines/processor.ts` — the single production call site with
  `honorConfiguredAlternative: true`. No query parameter, header, cookie,
  request body field, client state, or public API surface can influence
  engine selection (§37–§39, §43). No new metadata fields exist beyond the
  `engineId` already present in results (§35).
- **Kill switch scope.** Setting the variable back to any non-`pdfjs` value
  (or removing it) instantly returns pdf-to-text to the current engine. It
  affects **only pdf-to-text** — no other conversion consults it, and no
  other conversion can ever select `pdfjs-text` (the gate checks conversion
  id AND approved mode AND registry declaration AND availability).
- **Validation.** `src/lib/config/environment.ts` warns (does not error) on
  unrecognized values — an operator typo can never break startup.
- **attempt stays 1** for both engines: engine *selection* is not a retry
  (§36). There is no fallback, no QualityGate-triggered switching, no
  ranking, no content/performance-based routing (§13, absolute boundary).

## 3. Behavioral compatibility rules

### Rule A — micro sign µ → Greek mu μ: ACCEPTED ENGINE DIFFERENCE

pdfjs normalizes U+00B5 (MICRO SIGN) to U+03BC (GREEK SMALL LETTER MU) during
extraction; pdfium does not. Phase 72 measured this on the symbol fixture
(F-15) and Phase 73 reproduces it through the production engine. We
**accept** the difference: no Unicode normalization is forced on either
engine to manufacture byte-equality, and no claims of byte-identical output
are made. Consumers needing one specific codepoint must normalize in their
own pipeline.

### Rule B — off-page text: pdfium is the compatibility baseline

Text drawn fully or partially outside the page MediaBox: pdfium returns it;
pdfjs clips at the page boundary (Phase 72 F-39, reproduced in production
tests — the token is cut mid-run). pdfium is the baseline: this is
documented, tested, and we do **not** hack into pdfjs internals to reproduce
pdfium's behavior. Documents with significant off-page content should use the
default engine.

Both rules are enforced by production tests
(`src/lib/engines/pdfjs-text.engine.test.ts`) and the §24 corpus
(`src/lib/benchmarks/pdfjs-engine-parity.test.ts`), which additionally asserts
anchor preservation is 1.0 everywhere **except** the documented off-page
fixture, and the µ→μ divergence appears **only** on the symbol fixture.

## 4. DRAFT (NOT ACTIVE): technical-failure fallback policy (§41/§42)

Phase 73 implements **no automatic fallback of any kind**. Phase 74 (see
`docs/pdf-text-evidence.md`) added the measurement system — privacy-safe,
behavior-neutral engine diagnostics — that a future decision requires, and
**still no fallback exists**. The following is the draft policy for a
possible later phase, written down so the design constraints are on
record. **Nothing in this section is implemented.**

- **Trigger class: technical failure only.** Candidate triggers are typed
  processor errors from the *technical* taxonomy (e.g. `PROCESSING_ERROR`,
  `INVALID_PDF` where the current engine succeeded, timeouts). A
  `suspicious` QualityGate verdict is **never** a trigger: Phase 72 proved
  QualityGate `healthy` ≠ content preservation (F-39 pdfjs run was `healthy`
  at 0.75 anchor recall), so quality signals must remain observe-and-record
  only (§13).
- **Ordering:** default engine first (`current-pdfium-text`), alternative
  second (`pdfjs-text`). Max **2 engines / 2 attempts** total — attempt
  semantics must then become "engine slot", never an unbounded retry loop.
- **Accounting, limits, cleanup, and billing** must treat a fallback run as
  one conversion, not two (quota, rate limits, hardening envelope, upload
  lifetime unchanged).
- **Observability:** the result must record which engine produced the output
  (`engineId`) and that a fallback occurred — without exposing engine
  selection to the client as a control surface.
- **Exit criteria (Phase 74 instrumentation, `docs/pdf-text-evidence.md`
  §10):** enough real-world evidence that technical failures of the current
  engine are (a) measurable and (b) recoverable by pdfjs on the *same
  bytes* (manual operator replay, §8 there); otherwise the integration
  stays experimental. The evidence requirements are enumerated as ten
  conditions in the evidence document; all ten must hold before any
  fallback phase.

## 5. Character coverage, fonts, and honest boundaries

- **CID/CMap (§20/§25):** The engine extracts Type0/Identity-H fonts with
  **embedded ToUnicode maps** (tested with a genuine CID fixture: repo UI
  font Geist embedded as FontFile2 with a bfchar ToUnicode CMap — both
  engines decode it). pdfjs's network-hosted CMap directory is deliberately
  **not configured**; PDFs whose fonts rely on **predefined CMaps without
  an embedded ToUnicode map** (some CJK producers) are not covered, and
  extraction of those documents may degrade. This is documented, tested
  (the unverified-shape test records the boundary), and acceptable: bundled
  CMap resources would add network/file dependencies for an unproven need.
- **Tamil (§26):** **remains unverified.** The repository owns no
  Tamil-capable font and Phase 73 does not add font packages to fabricate
  coverage. No claim is made either way.
- **Encrypted PDFs (§28):** the engine maps pdfjs `PasswordException` to the
  existing typed `ENCRYPTED_PDF` error (static message, no content leak).
  The repository owns no encrypted fixture — pdf-lib cannot author
  encrypted PDFs — so this mapping, like the current engine's equivalent,
  is untested against a real encrypted file. No claim of verified behavior
  is made.
- **Tagged PDFs (§25):** no tagged-PDF fixture exists (pdf-lib cannot author
  structure trees); the engine reads the content stream, not the tag tree.

## 6. Security, resources, and licensing (§27/§29/§30/§31/§32)

- **Errors:** all pdfjs exceptions are mapped to the typed taxonomy
  (`InvalidPDF`/`MissingPDF` → `INVALID_PDF`, `Password` → `ENCRYPTED_PDF`,
  anything else → `PROCESSING_ERROR`) with static messages — no stack
  traces, raw library messages, filenames, or document content escape.
- **Privacy (§29):** engine failures, QualityGate records, DocumentProfile,
  logs, and metadata contain no document content; anchor/marker names never
  appear. The raw text artifact is the only place extracted text exists, as
  before.
- **Cleanup (§30):** `withPdfjsDocument()` destroys the loading task in a
  `finally` block on success, failure, and rejected-load paths (tested with
  destroyed-counters), and the input buffer is copied (`bytes.slice()`) so
  pdfjs never detaches caller memory.
- **Concurrency (§18):** in-process, no worker threads, no global concurrency
  increase; the engine runs inside the existing per-conversion hardening
  envelope and limits.
- **Licensing (§31):** pdfjs-dist is Apache-2.0 (verified on the npm
  registry), consistent with the repository license. The promotion from
  devDependency to dependency was explicit (`npm install --save
  pdfjs-dist@6.3.289` after `npm uninstall --save-dev`); it adds no new
  transitive dependencies (pdfjs-dist has zero), and the advisory set is
  byte-identical before and after the promotion (differentially verified
  against the Phase 72 lockfile: 11 advisories, all in pre-existing
  toolchain packages — prisma/js-yaml/next/exceljs/sharp etc. — none
  touching pdfjs-dist or anything it installs).
- **Bundle (§32):** server-side only. The import lives exclusively in
  `src/lib/processing/pdfjs/positioned-text.ts` (statically asserted by the
  isolation tests). Any appearance of pdfjs code in the **client** bundle is
  a STOP condition; the Phase 73 bundle audit re-verified this.

## 7. Phase 74: production evidence instrumentation

`docs/pdf-text-evidence.md` is the Phase 74 contract: a
`pdf_text_engine_run` telemetry event (closed-vocabulary labels and buckets
only) recorded once per engine run through the Phase 63 telemetry facade,
aggregated into the bounded `pdfText` snapshot section, kill-switchable via
`PDFKIT_PDF_TEXT_DIAGNOSTICS`, provably behavior-neutral and
privacy-safe. It measures the current engine's real technical-failure rate
post-launch — the evidence a future fallback decision requires. It does
not select, switch, retry or rank anything.

## 8. Test coverage summary

- `src/lib/engines/pdfjs-text.engine.test.ts` — the §44 battery: parity on
  standard/multi-page/unicode/dense inputs, typed error equality, page-limit
  equality, blank/scanned honesty, Rules A and B, CID fixture, privacy
  tokens, gating/fail-closed/kill-switch, no-fallback, no QualityGate
  routing, no public surface.
- `src/lib/benchmarks/pdfjs-engine-parity.test.ts` — §23 differential
  parity (benchmark candidate ≡ production engine, page by page) and §24
  regression corpus (both engines across all Phase 72 fixtures, differences
  recorded only where documented).
- `src/lib/benchmarks/candidate.test.ts` — cleanup discipline (destroy on
  every path, no buffer detach), typed error mapping, page-limit ordering,
  repeated-failure bounding, offline (poisoned-fetch) runs.
- `src/lib/benchmarks/isolation.test.ts` — Phase 73 revision: pdfjs import
  allowlist (exactly one production module), 12-engine registry shape,
  router default purity with the env variable set, dependency
  classification, client/UI never imports engines, no fixture markers in
  production sources (§46).
- `src/lib/engines/engine-config.test.ts`, `registry.test.ts`,
  `router.test.ts` — 38 tests covering §6–§17 invariants and gating.
