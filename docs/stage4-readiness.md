# Stage 4 Readiness — Conversion Intelligence Engine

**Phase 70 audit artifact. Status: audit only. Stage 4 (retry / fallback /
second engine / ranking) is NOT implemented by Phase 70 and is NOT active in
this repository.**

The current architecture remains:

```text
Engine (the one current implementation per conversion)
  → OutputValidator (structural, Phase 68)
  → QualityGate (diagnostic-only, Phase 69)
  → verdict recorded on EngineResult.quality
  → result returned unchanged
```

QualityGate is an **observer, not a controller**. Nothing in the codebase
consumes a quality verdict to select, retry or reject anything.

## 1. Readiness matrix (factual)

| Requirement | Current State | Ready? | Evidence / Missing Work |
| --- | --- | :-: | --- |
| Quality verdict (healthy/suspicious/insufficient) | Present on every successful engine run (`EngineResult.quality`) | YES | `src/lib/engines/quality.ts`; 35 Phase 69 tests + 38 Phase 70 hardening tests |
| Quality versioning | `qualityVersion: 1` on every assessment | YES | Version constant + carried on results; version bump policy documented |
| Deterministic scoring | Pure function; proven stable under `Math.random`/`Date.now`/env stubs | YES | Phase 70 determinism tests (byte-identical repeat assessments, stable check order) |
| Privacy-safe diagnostics | Counts/ratios/check ids only; PII leak-proof | YES | Phase 70 privacy tests (names, addresses, phones, emails, invoice numbers, filenames) |
| Bounded scanning | Marker scan ≤ 1 MiB inclusive, text/* only, linear regexes | YES | Phase 70 boundary + adversarial tests (threshold edges, 10k markers, malformed markers, Unicode) |
| Structural validation | Per-artifact structural verdicts (Phase 68) | YES | `src/lib/engines/validation.ts` + tests |
| Second engine | **Not implemented** — no alternative engine exists for any conversion | NO | Requires: candidate selection by benchmark (§2), licensing review, integration as a new adapter |
| Multi-engine registry | Registry **deliberately rejects** a second engine per conversion type | NO | `registry.ts` throws on duplicate primary registration; multi-engine needs explicit ranking design first |
| Engine ranking | Not implemented | NO | Needs benchmark evidence + ranking policy (per conversion type, not global) |
| Fallback policy | Not implemented; QualityGate is diagnostic-only by design | NO | Needs: which verdicts/error codes trigger a switch, per-tool policy, switch caps |
| Retry policy | Not implemented; every conversion is single-attempt | NO | Needs: transient-vs-deterministic failure taxonomy, backoff rules respecting the 60/min rate limits |
| Attempt cap | Not implemented | NO | `EngineResult.attempt` is always 1 (honest); caps come with retry |
| Kill switch | Not implemented | NO | Planned shape: `PDFKIT_ENGINE_<CONVERSION>` config defaulting to the current engine; must fail safe to current behavior |
| Benchmark corpus | Not built | NO | Design below (§2); corpus must live outside the repo, PII-free |
| Benchmark methodology | Designed (this document), not executed | NO | §2; no engine may be selected without executed benchmarks |
| Per-tool fallback policy | Not implemented | NO | Each conversion type needs its own policy (e.g. text conversions vs raster conversions differ) |
| Failure taxonomy | Partial: 35+ typed `ProcessingErrorCode`s exist and map to HTTP; technical-vs-quality distinction exists conceptually | PARTIAL | Needs explicit transient/deterministic classification + quality-verdict triggers |
| Observability | Quality verdicts exist in-process only; existing telemetry (`job_*` events) records counts, not quality | PARTIAL | Surfacing quality states through the existing privacy-safe telemetry is future work (requires approval; no new external services) |
| Security review (engine layer) | Done for Phases 67–70 (no network, no fs, no subprocess, no content leakage) | YES | Phase 70 security/privacy test evidence; a second engine would need its own review |
| Performance evidence | Overhead measured within noise (±1 ms) on a 2-page conversion; no duplicate parsing (1 pdfium pass per conversion, spied) | YES | Phase 70 performance test + no-duplicate-parsing test |

**Conclusion: the diagnostic foundation is ready. Stage 4 is blocked on the
engine side, not the quality side** — there is no second engine to fall back
to, no benchmark evidence to select one, and no approved fallback/retry
policy. Those are deliberate gaps, not oversights.

## 2. Benchmark design (DESIGN ONLY — nothing executed, nothing installed)

Before any engine is selected (current or future) for any conversion type, a
benchmark must run on a purpose-built corpus. No engine may be chosen on
popularity, assumption or vendor claims.

### 2.1 Corpus requirements (stored outside the repository, PII-free)

Text-only PDFs; complex multi-column reports; table-heavy financial
documents; invoices; forms (AcroForm); scanned pages (200/300/600 DPI);
image-only documents; image-heavy digital documents; unusual/rotated pages;
>100-page documents; malformed/damaged PDFs; RC4-encrypted and AES-encrypted
files; documents with unusual fonts; empty-text-overlay files. Every fixture
must be synthetic or scrubbed; no user documents.

### 2.2 Metrics

| Metric | What is measured | Why it matters | Success | Failure | Type |
| --- | --- | --- | --- | --- | --- |
| Text preservation | Character/word overlap between source text layer and extracted output | Text products must not silently lose content | High overlap on text-bearing pages | Substantial loss on text-bearing pages | Objective (overlap), heuristic (what "matters") |
| Page preservation | Output page count / expected pages (incl. breaks) | Lost pages are silent data loss | Every page represented | Missing/extra pages | Objective |
| Image preservation | Extracted image count vs embedded image XObjects; decode success | Extract Images must not drop images | All bounded-range images extracted | Missing or undecodable images | Objective |
| Table preservation | Detected table rows vs visually apparent rows on table fixtures | Excel output must carry the data | Rows present and correctly columned for aligned tables | Collapsed or missing rows | Heuristic (no ground-truth parser exists) |
| Layout preservation | Column/reading-order signals (Phase 68+ profile signals where available) | Multi-column text must not interleave | Order preserved on fixtures | Interleaved columns | Heuristic |
| Metadata behavior | Producer/creation stamps, encryption state | Security and honesty of outputs | No unintended metadata leakage; declared behavior | Undeclared information loss/gain | Objective |
| Output validity | Structural validation verdicts (Phase 68 validator) | Outputs must be openable | 100% structural pass | Any structural fail | Objective |
| Corrupted-input handling | Typed error vs crash on malformed fixtures | Failures must be safe and structured | Typed `ProcessingError`, no hang, no crash | Crash, hang, or generic 500 | Objective |
| Scanned-document behavior | Verdict + output on scanned corpus (no OCR exists) | Must not claim false success | Honest marker-only/suspicious diagnostics | Pretending text was extracted | Heuristic |
| Image-only documents | As above for image-only inputs | Same | Same | Same | Heuristic |
| Large documents | Success within limits at 50–200 pages | Limits must hold | Completion within request timeout budget | Timeout or limit violation | Objective |
| Performance | Wall time per page, per conversion | Throughput and UX | Within budget vs current engine baseline | Material regression | Objective |
| Memory behavior | Peak RSS during conversion | Server safety | Bounded, no growth across run | Unbounded growth | Objective |
| Failure rate | Technical failure rate across the corpus | Reliability | Lower than or equal to current | Higher | Objective |

### 2.3 Method

1. Baseline the current engine on the corpus (no production change — the
   harness runs the same adapters offline).
2. Run each candidate engine under evaluation on the identical corpus in the
   same environment.
3. Compare per metric; select per conversion type only where a candidate is
   measurably better on that type's primary metrics without regressing
   safety, licensing or performance.
4. Record results in a dated report artifact before any integration decision.

Licensing is a hard gate before benchmarking: AGPL-family engines (MuPDF,
Ghostscript, pdf2docx-via-PyMuPDF) and external SaaS conflict with the
product's closed-source, document-privacy posture unless separately resolved.

## 3. What Phase 70 changed

- `src/lib/engines/quality.hardening.test.ts` — 38 tests: determinism
  (incl. Math.random/Date.now/env-independence), boundary semantics (50%
  evidence strictness, score edges, malformed profiles, NaN safety, zero/
  one/many outputs), marker-only adversarial cases (threshold edges
  inclusive at 1 MiB, 10k markers, malformed markers, Unicode, binary
  non-decode, PII), per-policy audit matrix for all 11 conversions,
  structural-vs-quality separation cases A–E (with the documented v1
  invariant: an evaluated structural verdict makes `insufficient`
  unreachable), behavioral equivalence (byte-identical outputs, suspicious
  verdict leaves artifacts untouched, exactly one pdfium pass per
  conversion, router unchanged, failures unchanged), privacy (PII-proof
  serialisations, zero console output), performance (measured overhead
  within noise).
- `src/lib/engines/adapters/current.ts` — exported the existing
  `MARKER_SCAN_MAX_BYTES` constant for boundary tests (no behavior change).
- `docs/stage4-readiness.md` — this document.
- `ARCHITECTURE.md` — pointer to this document in §5z.

No production behavior, API, UI, dependency, schema or security-pipeline
change.
