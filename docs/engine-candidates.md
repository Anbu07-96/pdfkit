# Engine Candidate Audit — Phase 71

**Status: discovery + audit + benchmark foundation. Phase 71 does NOT
implement a second production engine, fallback, retry, ranking or engine
switching. The production pipeline remains: Current Engine →
OutputValidator → QualityGate → result.**

This document answers: *what should the first alternative processing engine
be, where can it safely be used, and how will we objectively prove whether
it is better or worse than the current engine?*

Companion document: `docs/benchmark-plan.md` (benchmark architecture,
fixtures, metrics, DRAFT comparison rules). Prior context:
`docs/stage4-readiness.md` (Phase 70 readiness matrix).

## 1. Current engine matrix (verified from source, Phase 71 §1–2)

| Conversion | Current engine id | Underlying library | Runtime | FS / child proc / network | Known quality limitation |
| --- | --- | --- | --- | --- | --- |
| pdf-to-word | current-pdfium-docx | @hyzyla/pdfium (WASM) + docx | server, in-process, WASM+JS | none / none / none | text-only DOCX; no layout, fonts, images or tables preserved (disclosed in UI) |
| pdf-to-excel | current-pdfium-exceljs | pdfium text + whitespace heuristic + exceljs | server, in-process | none / none / none | tables without 2+-space alignment collapse to one cell |
| pdf-to-text | current-pdfium-text | pdfium `getText` per page | server, in-process | none / none / none | no reading-order/column reconstruction; content-stream order |
| extract-tables | current-pdfium-tables | pdfium text + heuristic + exceljs | server, in-process | none / none / none | same heuristic limits as pdf-to-excel |
| pdf-to-jpg | current-pdfium-jpeg | pdfium render + jpeg-js (q90) | server, in-process | none / none / none | raster only; no alternative exists |
| pdf-to-png | current-pdfium-png | pdfium render + in-house PNG encoder | server, in-process | none / none / none | raster only |
| extract-images | current-pdf-lib-extract-images | pdf-lib XObject walk + fflate | server, in-process | none / none / none | embedded XObjects only |
| images-to-pdf | current-pdf-lib-images | pdf-lib embedJpg/embedPng | server, in-process | none / none / none | — |
| png-to-pdf | current-pdf-lib-png | pdf-lib embedPng | server, in-process | none / none / none | — |
| compress-pdf | current-pdf-lib-compress | pdf-lib + fflate (+ pdfium raster for `high`) | server, in-process | none / none / none | raster pass is lossy (disclosed) |
| compare-documents | current-pdfium-compare | pdfium text + comparison | server, in-process | none / none / none | text-only comparison |

All current engines: permissively licensed (MIT/BSD-3), in-memory, no
temporary files, no child processes, no network — verified again in Phase 71
§1 from source. The shared pdfium WASM instance is a single serialized lane
(throughput ceiling).

**Where an alternative is genuinely needed** (from the Phase 66–70 quality
audits): text-extraction conversions (pdf-to-word/excel/text/tables) lose
column/reading-order structure because pdfium's plain line text carries no
positions; scanned inputs have no OCR path (honest diagnostics, but a gap).

## 2. Candidate discovery (§3)

Candidates considered across the conversion space:

| Candidate | Conversions targeted | Language / runtime | License | Server-compatible | Verdict |
| --- | --- | --- | --- | --- | --- |
| **pdfjs-dist (Mozilla PDF.js)** | text extraction (pdf-to-text/word/excel/tables) | pure JS (legacy build for Node) | **Apache-2.0** | yes — in-process, no native binary, no child process | **PRIMARY CANDIDATE** (benchmark-only) |
| pdfium native bindings | raster/text (same engine, native speed) | C++ via native addon | BSD-3 + binding license | child process or native addon required | deferred — same engine, different packaging; adds native-deployment risk for little quality delta |
| @napi-rs/canvas (+ pdfjs render) | rasterization | Rust/Skia native module | MIT | native module in-process | deferred — native binary, deployment cost; raster quality already served by pdfium |
| MuPDF (incl. mupdf-js/WASM) | raster, text, quality | C / WASM | **AGPL-3.0** (commercial from ≈$1.5k–$50k+) | yes technically | **BLOCKED** — AGPL is incompatible with the closed-source SaaS model without a paid license |
| Ghostscript | rendering, compression | C | **AGPL-3.0** | native binary + child process | **BLOCKED** — AGPL + native process |
| Poppler (pdftotext/pdftoppm) | text, raster | C | **GPL-2+** (strong copyleft, Xpdf lineage) | native binary + child process | **BLOCKED** — GPL requires legal review for SaaS use; native process |
| pdf2docx | pdf-to-word layout | Python (PyMuPDF runtime) | MIT wrapper, **AGPL runtime** | separate Python service | **BLOCKED** — the runtime dependency is AGPL |
| qpdf | structural PDF ops (compress) | C++ | Apache-2.0 | native binary + child process | deferred — permissive but native-process; current compress is adequate |
| pdfcpu | structural PDF ops | Go | Apache-2.0 | native binary + child process | deferred — same shape as qpdf |
| LibreOffice | Office→PDF (future conversions) | C++ | MPL-2.0 | heavyweight process pool | deferred — no current conversion needs it (word/excel→PDF not implemented; MPL acceptable, process isolation required) |
| Commercial SDKs (Apryse, Foxit, Nutrient) | all | proprietary | commercial | varies | deferred — cost + vendor lock-in; not evaluated further without a decision to spend |
| Adobe PDF Services / SaaS OCR | all | external SaaS | commercial | external | **REJECTED** — conflicts with the privacy posture (documents would leave the server) |

## 3. Licensing audit (§4 — HARD GATE)

| Candidate | License | Commercial use | Copyleft / source disclosure | SaaS implication | Status |
| --- | --- | --- | --- | --- | --- |
| pdfjs-dist | Apache-2.0 (verified: npm registry, v6.3.289) | permitted | none; NOTICE/attribution on redistribution | none — safe for closed SaaS | **APPROVED for benchmarking** (devDependency; production adoption would re-verify at integration time) |
| MuPDF | AGPL-3.0 OR commercial (Artifex) | only with commercial license | full source disclosure of the combined work under AGPL | network use triggers AGPL §13 | BLOCKED unless a license is purchased |
| Ghostscript | AGPL-3.0 OR commercial | only with commercial license | as above | as above | BLOCKED |
| Poppler | GPL-2+ | permitted only under GPL terms | strong copyleft | separate-process use is legally arguable but unreviewed | LEGAL REVIEW REQUIRED — not pursued |
| pdf2docx | MIT (wrapper) but runtime PyMuPDF is AGPL/commercial | wrapper yes, runtime no | via runtime | via runtime | BLOCKED |
| qpdf / pdfcpu | Apache-2.0 | permitted | none | none | permissive — blocked on deployment (native process), not licensing |
| LibreOffice | MPL-2.0 | permitted | weak, file-level copyleft | acceptable with process isolation | permissive — deferred (no current need) |

No candidate proceeds with unclear licensing. "Open source = commercially
safe" was not assumed anywhere above.

## 4. Security audit of the primary candidate (§6)

pdfjs-dist (as the primary candidate):

- Designed since 2011 to parse **untrusted** PDFs in a browser sandbox;
  Mozilla ships it to hundreds of millions of users — the strongest
  untrusted-input pedigree among JS PDF parsers.
- Pure JavaScript in Node (legacy build): no shell, no child process, no
  filesystem writes, no network in the text-extraction path (network is
  opt-in for font fetching, which the benchmark adapter disables:
  `useSystemFonts`/`disableFontFace` discipline, `isEvalSupported: false`).
- Attack surface: PDF parser (CJS/JS) — historical CVEs exist (as with every
  parser, including pdfium); mitigations here: in-process execution under
  the app's existing limits, no eval, no worker, buffer copy before parse
  (detached-buffer safety), and the existing request-level quotas/timeouts
  would govern any production use.
- **No known issue found during audit** (npm reports 0 known vulnerabilities
  for 6.3.289); this is NOT a claim of "secure".

For blocked candidates, security review was not continued — licensing gates
first.

## 5. Deployment compatibility (§5)

| Candidate | Node | Serverless | Native binary | Child process | Memory / size | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| pdfjs-dist | ✅ legacy build | ✅ | ❌ not needed | ❌ not needed | ~35 MB install, pure JS; one-time module load | **compatible with the current in-process model** |
| pdfium native / @napi-rs/canvas | ✅ | ⚠️ layer sizing | ✅ required | optional | native binaries per platform | deployment cost; deferred |
| qpdf / pdfcpu / Poppler / Ghostscript / LibreOffice | via child process | ⚠️ container/layer | ✅ required | ✅ required | process pool + sandboxing design | architecture change; deferred/blocked |

## 6. Candidate scoring for EVALUATION PRIORITY (§7 — not production ranking)

Scores 1–5 (higher = better). This ranks candidates for **benchmark
evaluation order**, NOT for production use; production ranking is Stage 4
work and requires executed benchmarks.

| Candidate | Quality potential | Licensing | Deployment | Security posture | Performance potential | Maintenance maturity | Privacy | Implementation complexity | Priority |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| pdfjs-dist | 4 (positioned text) | 5 (Apache-2.0) | 5 (in-process JS) | 4 (untrusted-input pedigree) | 3 (JS vs WASM, unmeasured) | 5 (Mozilla) | 5 (local) | 3 (adapter + line reconstruction) | **1** |
| qpdf | 2 (structural only) | 5 | 2 (native proc) | 3 | 4 | 5 | 5 | 2 | 2 |
| @napi-rs/canvas + pdfjs | 3 (raster parity) | 5 | 3 (native module) | 3 | 4 | 4 | 5 | 3 | 3 |
| pdfium native | 3 (parity) | 5 | 2 (native) | 4 | 4 | 4 | 5 | 2 | 4 |
| LibreOffice | 5 (Office fidelity) | 4 (MPL) | 1 (process pool) | 2 | 2 | 4 | 5 | 5 (large) | deferred (no current conversion) |

## 7. Candidate decision (§8)

- **Primary candidate: pdfjs-dist (Mozilla PDF.js) 6.3.289 — for the
  text-extraction conversions, beginning with pdf-to-text.**
  Evidence basis: permissive Apache-2.0 license; pure-JS in-process runtime
  that matches the current security model exactly (no child process, no
  native binary, no network); the only serious candidate that requires **no
  architectural change**; and a concrete, measurable quality hypothesis —
  its positioned text items (x/y transforms) can reconstruct reading order
  and columns, which the current engine's plain line text cannot.
- **Backup candidate: qpdf (Apache-2.0)** for structural PDF operations —
  only if the primary hits an unresolved blocker; requires a child-process
  architecture that must be designed and approved separately.
- **Blocked candidates** (AGPL/GPL/runtime-AGPL/external SaaS): MuPDF,
  Ghostscript, Poppler, pdf2docx, Adobe/SaaS — see §3.
- The candidate is integrated **nowhere in production**: it exists only as a
  benchmark adapter (`src/lib/benchmarks/engines/pdfjs-candidate.ts`) over a
  devDependency. Isolation is enforced by tests (see
  `src/lib/benchmarks/isolation.test.ts`).

## 8. First benchmark evidence (fixture-level, NOT selection)

Collected with the Phase 71 harness (see `docs/benchmark-plan.md`), single
run, in-sandbox, Node 22:

| Fixture | Metric | current-pdfium-text | candidate-pdfjs-text |
| --- | --- | --- | --- |
| F-04-multicolumn | anchorPreservation | 1.0 | 1.0 |
| F-04-multicolumn | columnOrderPreserved | **0.0** | **1.0** |
| F-02-text-multi | anchorPreservation / chars | 1.0 / 163 | 1.0 / 163 |
| F-06-scanned | behavior | marker-only output (honest) | marker-only output (honest) |

Reading: on this synthetic fixture the current engine preserves every
anchor but returns columns in content-stream order (right column first),
while the positioned-text candidate reconstructs the left-before-right
reading order. Parity on simple text; parity on honest scanned handling.
**This is fixture-level evidence only** — the full-corpus campaign
(performance, memory, all categories, repeated runs) is the Stage 4
prerequisite and has NOT been executed. No engine is selected.

## 9. Stage 4 boundary

Phase 71 delivers: this audit, the benchmark foundation, and fixture-level
evidence. **It does not implement a second production engine, fallback,
retry, ranking or engine switching, and no production code path can reach
the candidate.**
