# Benchmark Plan — Conversion Intelligence Engine

**Phase 71 deliverable — EXECUTED in Phase 72. This is the plan and
harness for the Stage 4 benchmark campaign. No production thresholds are
final; every proposed threshold below is DRAFT. No engine has been
selected.**

Companion documents: `docs/engine-candidates.md` (Phase 71 candidate audit,
licensing, decision), `docs/stage4-readiness.md` (Phase 70 readiness
matrix), and **`docs/benchmark-results-phase72.md`** (Phase 72 controlled
execution: full-corpus evidence, per-conversion GO/NO-GO decisions, and the
machine-readable artifact `docs/benchmark-results-phase72.json`).

## 1. Architecture (implemented in Phase 71)

```text
src/lib/benchmarks/
├─ types.ts                    BenchmarkEngine / BenchmarkFixture / BenchmarkRunResult (+ Phase 72 series/report types)
├─ applicability.ts            Phase 72 applicability matrix (data; tested)
├─ fixtures.ts                 Synthetic corpus (39 fixtures v2, in-memory, repo-owned, ground truth)
├─ metrics.ts                  Metric computation, OBJECTIVE/HEURISTIC labeled
├─ bounds.ts                   Phase 72 resource bounds (bytes/pages/iterations/budget)
├─ runner.ts                   runBenchmark(engine, fixture) → machine-readable result
├─ perf.ts                     Phase 72 series: warm-up, repeated runs, timing aggregation
├─ report.ts                   Phase 72 evidence report builder (privacy-enforced)
├─ engines/
│  ├─ current-adapter.ts       Wraps the CURRENT production engine adapters (no router)
│  ├─ pdfjs-candidate.ts       BENCHMARK-ONLY candidate (pdfjs-dist devDependency)
│  └─ pdfjs-table-signal.ts    BENCHMARK-ONLY component engine (positional table signal)
├─ benchmarks.test.ts          Harness + corpus ground-truth + metric tests
├─ applicability.test.ts       Applicability matrix tests
├─ perf.test.ts                Timing math + series behavior tests
├─ candidate.test.ts           Candidate cleanup + offline (no-network) proofs
├─ report.test.ts              Evidence report structure/privacy/serialization tests
└─ isolation.test.ts           Production-isolation proofs (Phase 71 + Phase 72)
```

Properties, enforced by tests:

- **Isolated**: no production module imports `@/lib/benchmarks` or
  `pdfjs-dist`; the live registry still contains exactly the 11 current
  engines; the router and `selectEngine()` are unchanged; `pdfjs-dist` is a
  devDependency only. The dependency direction is strictly
  benchmarks → production.
- **Deterministic**: identical (engine, fixture) pairs produce identical
  metrics apart from wall-clock and heap measurements (`comparableMetrics`
  strips exactly those).
- **Offline**: fixtures are generated in memory; no network, no downloads.
- **Privacy-safe**: results contain metrics, quality verdicts and
  reproducibility metadata only — a test asserts fixture content (anchors,
  markers) never appears in serialized results.
- **Uniform quality measurement**: the runner applies the *same* production
  `validateEngineResult` + `assessConversionQuality` code to every engine
  (current and candidate), so QualityGate verdicts are comparable; the
  independent benchmark metrics remain the primary evidence (the gate is
  not the sole truth).

Executing the harness: `npx vitest run src/lib/benchmarks`.

## 2. Fixture corpus (§10)

All fixtures are **synthetic, generated in memory by repository-owned
builders** (pdf-lib emission). No downloads, no copyrighted documents, no
customer documents, no personal data. Provenance is stated per fixture in
`fixtures.ts`; corpus version = `FIXTURE_VERSION` (**2** after the Phase 72
expansion: 39 fixtures across text, layout, pages, images, tables and edge
categories, each with machine-readable provenance and explicit ground
truth — see `docs/benchmark-results-phase72.md` §2 for the summary and the
known corpus limitations, e.g. no Tamil / no encrypted fixtures). The
original Phase 71 eight-fixture foundation is preserved unchanged in shape
(F-01…F-08).

| ID | Category | Purpose | Expected |
| --- | --- | --- | --- |
| F-01-text-single | text | baseline single-page extraction | 1 page, 1 anchor |
| F-02-text-multi | text | multi-page coverage | 5 pages, 5 anchors |
| F-03-table-aligned | table | aligned-column rows | 1 page, 4 rows |
| F-04-multicolumn | multicolumn | reading-order reconstruction (right column drawn first — content order ≠ reading order) | 5 L/R anchor pairs |
| F-05-mixed-text-image | mixed | text page + image-only page | 2 pages, 1 anchor, page 2 image-only |
| F-06-scanned | scanned | image-only pages; no OCR exists | 2 pages, 0 anchors |
| F-07-large | large | 30-page state and coverage | 30 pages, 3 anchors |
| F-08-malformed | malformed | failure behavior | typed failure expected |

Stage 4 campaign extensions (documented, not built): higher page counts,
more column layouts, rotated pages, encrypted inputs, real-world-shaped
documents — still synthetic or permissively licensed.

## 3. Metrics (§11)

Defined in `src/lib/benchmarks/metrics.ts`; labels are part of the metric
contract:

| Metric id | Label | Definition |
| --- | --- | --- |
| output.exists / output.count / output.bytes | OBJECTIVE | artifacts produced |
| text.characterCount | OBJECTIVE | characters in text/* outputs |
| text.anchorPreservation | OBJECTIVE | planted synthetic anchors present (0–1) |
| text.pageCoverage | OBJECTIVE | page markers found / expected pages (0–1) |
| text.columnOrderPreserved | OBJECTIVE (convention documented) | left anchor precedes its right anchor per planted pair (0–1); the L-before-R convention is defined by the fixture, the comparison is mechanical |
| table.rowsExtracted | OBJECTIVE | rows reported by engine meta |
| images.extracted | OBJECTIVE | images reported by engine meta |
| failure.errorCategory | OBJECTIVE | typed error code on failure |
| performance.wallClockMs | OBJECTIVE (a measurement, not a quality claim) | wall time |
| performance.heapDeltaBytes | HEURISTIC | heap delta — noisy, indicative only |

No metric is called "fidelity". Text-loss ratios against a reference
extraction are HEURISTIC and deferred to the campaign (they require a
reference extraction definition).

## 4. Reproducibility (§13)

Every `BenchmarkRunResult` records: `benchmarkVersion` (1), `fixtureVersion`
(per fixture), fixture id, engine id + version string, conversion, success,
metrics, quality verdict, error category, and runtime metadata
(`process.version`, `process.platform`, wall clock). Engine versions are
read from the packages at load time (e.g. `pdfjs-dist/package.json`).
Results carry no document content. Re-run with the same versions on the
same platform reproduces all non-timing metrics (tested).

## 5. Comparison rules for the Stage 4 campaign (§15 — DRAFT only)

**Hard failures** (a candidate loses regardless of other metrics):

- output cannot be structurally validated (OutputValidator `failed`)
- missing expected pages / page coverage < 1 on well-formed fixtures
- catastrophic text loss (DRAFT: anchorPreservation < 1.0 on text fixtures)
- missing expected images on image fixtures (DRAFT: extracted = planted)
- crash, non-typed error, timeout, or resource exhaustion on well-formed
  fixtures

**Soft differences** (recorded, not disqualifying):

- metadata differences, compression-ratio differences, minor formatting
  differences, acceptable layout variation, output size differences

**DRAFT thresholds** (NOT policy — to be calibrated by the campaign results
before any Stage 4 decision): anchorPreservation = 1.0 required on
well-formed text fixtures; pageCoverage = 1.0; columnOrderPreserved ≥ 0.9
for positioned-text engines; wall-clock within 2× of the current engine on
the large fixture; no heap growth trend across the corpus.

## 6. What Phase 71 did NOT do

- No production integration of any candidate (isolation proven by test).
- No full-corpus campaign: the evidence in `docs/engine-candidates.md` §8 is
  fixture-level only.
- No engine selection, ranking, fallback, retry or kill-switch design
  activation.
- No benchmark results persisted outside test runs (results are test
  artifacts by design).
