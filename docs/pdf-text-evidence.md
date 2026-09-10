# PDF-to-Text Production Evidence & Technical-Failure Telemetry (Phase 74)

> **Phase 74 does not implement automatic fallback.** Nothing in this phase
> selects, switches, retries or ranks engines. The pdfjs-text alternative
> remains gated OFF by default behind the Phase 73 server-side variable.
> This phase adds exactly one thing: a privacy-preserving, behavior-neutral
> measurement system so the owner can decide — with production data —
> whether a future fallback phase is justified.

## 1. Current architecture (unchanged by Phase 74)

```text
Request
  ↓
hardening (rate limit, quota, concurrency — rejections never reach the engine)
  ↓
pdf-to-text processor (createEngineProcessor)
  ↓
engine selection  ←  PDFKIT_PDF_TO_TEXT_ENGINE=pdfjs is the ONLY override
  ↓                    (server-side, fail-closed, default current-pdfium-text)
current-pdfium-text
  ↓
OutputValidator (diagnostic only)
  ↓
QualityGate (diagnostic only: healthy | suspicious | insufficient | not-evaluated)
  ↓
diagnostic telemetry  ←  NEW in Phase 74 (this document)
  ↓
result (unchanged)
```

The telemetry hook lives in the shared processor→engine adapter
(`src/lib/engines/adapters/processor-engine.ts`), so **both engines are
measured through the identical path**. It fires once per engine run — and
since the attempt model stays 1, that is at most once per request. On the
failure path the original typed error propagates unchanged after recording;
there is no second engine attempt (test-enforced).

## 2. The event contract

New event in the existing Phase 63 telemetry model
(`src/lib/monitoring/telemetry-events.ts`) — Phase 74 extends the
established facade (`recordTelemetryEvent`), it does not create a competing
system:

```text
PdfTextEngineDiagnosticEvent (type: "pdf_text_engine_run")
  engineId         current-pdfium-text | pdfjs-text
  outcome          success | technical_failure | validation_failure
  failureCode      INVALID_PDF | ENCRYPTED_PDF | TOO_MANY_OUTPUTS |
                   PROCESSING_ERROR | VALIDATION_ERROR | INTERNAL_ERROR
                   (failures only; closed vocabulary)
  qualityState     healthy | suspicious | insufficient | not-evaluated
                   (success only; diagnostic, never a routing input)
  validationStatus passed | failed | not-evaluated (success only)
  durationBucket   lt-100ms | 100-500ms | 500ms-1s | 1-5s | gt-5s
  inputSizeBucket  0-100kb | 100kb-1mb | 1mb-5mb | 5mb-10mb | gt-10mb
  pageCountBucket  1 | 2-5 | 6-20 | 21-60 | gt-60 | unknown
```

Data flow:

```text
engine adapter (pdf-to-text only)
  → pdf-text-diagnostics.ts  (classify + bucket, swallow everything)
  → recordTelemetryEvent()   (Phase 63 facade, never throws)
  → in-memory metrics provider (bounded aggregates)
  → /api/admin/metrics snapshot section "pdfText" (pre-existing,
     token-gated, fail-closed endpoint — no new exposure)
```

The event is **metrics-only**: it produces no log line (one line per run
would double per-request log volume). Aggregates are strictly bounded —
fixed key sets, capped maps (hostile labels fold into `"other"`), no event
store, no raw values.

## 3. Failure taxonomy (§14 audit)

Every typed error the pdf-to-text path can produce, with its Phase 74
classification. "Fallback-recoverable" is a forward-looking annotation for
the DRAFT policy (§8) — it is not implemented anywhere.

| Error            | Where it comes from                                                        | Technical failure? | Telemetry                              | Client-safe | Fallback-recoverable (DRAFT view)                |
| ---------------- | -------------------------------------------------------------------------- | ------------------ | -------------------------------------- | ----------- | ------------------------------------------------ |
| VALIDATION_ERROR | Missing file / invalid `pages` option (processor, pre-parse)               | No — request error | `validation_failure` outcome           | Yes         | No — same request would fail on any engine       |
| INVALID_PDF      | pdfium: document won't open / no pages. pdfjs: InvalidPDF/MissingPDF       | Yes                | `technical_failure`, code INVALID_PDF  | Yes         | Possibly — the OTHER engine may parse the bytes  |
| ENCRYPTED_PDF    | pdfium: password-protected. pdfjs: PasswordException                       | Yes                | `technical_failure`, code ENCRYPTED_PDF | Yes        | No — encryption is engine-independent            |
| TOO_MANY_OUTPUTS | Source has more pages than `maxConversionPages` (50) — both engines        | Yes                | `technical_failure`, code TOO_MANY_OUTPUTS | Yes    | No — deterministic limit, engine-independent     |
| PROCESSING_ERROR | Engine-stage wrap of unexpected internal failures                         | Yes                | `technical_failure`, code PROCESSING_ERROR | Yes     | Possibly — engine-specific failure modes         |
| INTERNAL_ERROR   | Non-typed throw escaping an engine (recorded at the adapter, bounded label) | Yes               | `technical_failure`, code INTERNAL_ERROR | Yes      | Unknown until measured                           |
| — (success)      | Blank page / scanned / image-only PDF                                      | **No** — honest success with `suspicious`/`insufficient` QualityGate | `success` + qualityState | Yes | Must NOT trigger fallback (Phase 72 F-39 proved healthy ≠ content) |

Explicitly NOT engine failures (never classified as `technical_failure`):

- valid PDF with zero extractable text (blank/scanned/image-only) — a
  success with an honest QualityGate verdict;
- low-quality-but-valid output — QualityGate stays observe-and-record;
- policy/security rejections (rate limit, quota, concurrency, upload
  validation) — they happen BEFORE the engine and are already covered by
  the Phase 63 events (`quota_rejected`, `rate_limited`, `server_busy`);
  they never generate a `pdf_text_engine_run` event;
- user cancellation — no engine run, no event.

## 4. The denominator (§9)

```text
technical failure rate = technical failures / eligible attempts

eligible attempts = every pdf_text_engine_run event with outcome
                    success or technical_failure
                  = runs that reached the engine stage
```

Included: successes, technical failures. Excluded: validation failures
(never parsed a PDF), all pre-engine rejections (hardening, upload
validation — not engine behavior), QualityGate verdicts (not failures).
`technicalFailureRate` is computed by the provider with exactly this
denominator; `eligibleRuns` is exported next to it so the rate is always
auditable. Raw HTTP error rates must NOT be used as a proxy — they mix in
quota, rate-limit and validation rejections.

## 5. Privacy audit (§5)

The telemetry **can** contain: the engine id, the outcome category, the
typed failure code, the QualityGate/validator verdict labels, and the five
bucket dimensions listed in §2. Nothing else — no timestamps beyond the
provider's own aggregate clocks, no application version (the deployment
environment label in the existing snapshot serves this).

The telemetry **cannot** contain, by construction and by test:
PDF bytes; extracted text; page text; filenames; document titles; metadata
values; author/creator names; embedded URLs; email addresses; phone
numbers; IP addresses; cookies; authentication identifiers; user/session
ids; request ids; exception messages; stack traces; font names; raw page
dimensions; PDF object identifiers; raw durations, byte counts or page
counts (buckets only).

Mechanisms: the event type has no free-form fields; every label is checked
against a closed vocabulary before recording (unknown labels are dropped);
the provider sanitizes every map key (`sanitizeMetricsKey`) and folds
hostile labels into `"other"`; raw values are bucketed before the event
exists; the whole pipeline is double-swallowed (the diagnostics module and
the facade each catch everything). Tests plant PII in document content,
filename and PDF metadata, then assert none of it appears anywhere in the
serialized snapshot, and that a log-injection payload never survives as a
label.

## 6. Behavior preservation (§6)

Processing is byte-identical whether diagnostics are enabled, disabled,
unavailable, or throwing:

- the recording functions swallow every error, including their own;
- the failure path rethrows the ORIGINAL error object after recording;
- nothing reads back from telemetry: no routing, no limits, no QualityGate
  input, no output mutation;
- the kill switch `PDFKIT_PDF_TEXT_DIAGNOSTICS=off` stops recording only.

Tests run identical conversions with diagnostics on and off and assert
identical artifacts, errors, engine ids, attempts, validation and quality
verdicts; a metrics provider that throws on every call provably breaks
nothing. **Direction of failure, deliberately different from the engine
gate**: engine SELECTION fails closed (a typo must never change
processing), diagnostics fail OPEN (a typo keeps measuring — diagnostics
cannot affect processing, but losing the evidence record would defeat this
phase's purpose). Unrecognized values produce an environment-validation
warning naming the variable only.

## 7. Engine isolation & gate preservation (§10)

Default mode after a pdfium technical failure:

```text
pdfium failure → typed error → recorded → returned to the caller
                 (pdfjs NEVER invoked; attempt stays 1)
```

Test-enforced by spying on the pdfjs adapter through the real service path.
The Phase 73 gate is untouched: only the exact value `pdfjs` (after
trim+lowercase) of `PDFKIT_PDF_TO_TEXT_ENGINE` selects the alternative;
unset, `false`, `0`, random strings and engine ids all fail closed to
`current-pdfium-text`. QualityGate verdicts — all four — provably cannot
influence selection (runtime test for the producible states plus a
structural source assertion over router.ts / engine-config.ts /
processor.ts).

## 8. Same-bytes recovery evidence & the manual replay procedure (§11/§12)

The future fallback decision needs evidence of the shape
`pdfium technical failure AND pdfjs success on the SAME bytes`. Phase 74
does **not** fabricate this from synthetic fixtures and does **not** run
pdfjs automatically after failures. PDFKit never persists uploads (privacy
by design), so same-bytes evidence must be collected deliberately:

**Manual operator replay procedure (documented, NOT automated):**

1. A `technical_failure` shows up in the `pdfText` snapshot with its
   failure code (start with `INVALID_PDF` and `PROCESSING_ERROR` — the
   only plausibly recoverable classes; see §3).
2. The operator asks the reporting user for the original file (support
   channel), or re-uses a lawfully retained copy if one exists.
3. On a staging instance with `PDFKIT_PDF_TO_TEXT_ENGINE=pdfjs`, submit
   the same bytes; record: same failure code class for pdfium, pdfjs
   outcome, engine run duration bucket, size bucket (all from the same
   snapshot section — no new tooling needed).
4. Record the result in an operator-maintained evidence log (this document
   deliberately adds no storage for it — customer files must not enter any
   benchmark store).
5. Aggregate: recovery rate = pdfjs successes / replayed pdfium technical
   failures, per failure code.

A controlled pdfjs diagnostic mode (automatic parallel evaluation) was
evaluated and **rejected** for this phase: it would re-run engines over
user documents without consent, add resource cost, and complicate the
one-attempt invariant — unnecessary complexity for evidence that manual
replay collects safely. Revisit only if launch data shows the manual
procedure cannot keep up with the failure volume.

## 9. Evidence quality: synthetic vs production (§21)

**Synthetic evidence** (Phase 72/73 fixtures, `docs/benchmark-results-phase72.md`):
deterministic regression, engine comparison, known edge cases. It CANNOT
estimate production failure rates — the fixtures are hand-built and
deliberately hostile, not a traffic sample. It already answered: both
engines parse the same corpus; divergences are two, documented, accepted
(µ→μ; off-page clipping).

**Production evidence** (this phase's telemetry, after launch): the actual
technical-failure rate, real document diversity, duration/size/page
distributions, and — via §8 replay — same-byte recoverability. The two
kinds of evidence are never aggregated into one number; the snapshot's
`pdfText` section is production-only by construction (test runs use their
own process-local provider).

## 10. Evidence required before any future fallback phase

A future fallback phase (Phase 75/76) should require ALL of:

1. a meaningful number of real production attempts (eligible runs, §4);
2. a measurable current-engine technical-failure rate (not zero, not
   dominated by one pathological upload);
3. failures distributed across real document types, not one producer;
4. repeated cases where pdfjs successfully processes the same bytes (§8
   replay log);
5. acceptable pdfjs resource usage (Phase 72 measured ~2× typical, 12.5×
   worst-case on 30-page documents — must be re-checked against real
   traffic);
6. no unacceptable privacy/security regression;
7. evidence that fallback materially improves successful processing;
8. a clear maximum-attempt policy (the DRAFT below fixes 2);
9. deterministic routing behavior (fallback eligibility by failure code
   only — never by content, quality score or performance);
10. explicit handling of `suspicious`/`insufficient` QualityGate results:
    they are NOT triggers (Phase 72 F-39: a `healthy` verdict coexisted
    with 0.75 anchor recall — quality signals cannot detect the failure
    mode a fallback would target).

## 11. DRAFT future fallback policy — NOT ACTIVE

Written down for the record; **nothing is implemented** and this phase's
telemetry must not be read as its trigger:

```text
Attempt 1: current-pdfium-text

If and only if:
    typed technical failure
    AND the failure code is fallback-eligible (§3 table: INVALID_PDF and
    PROCESSING_ERROR candidates; ENCRYPTED_PDF and TOO_MANY_OUTPUTS never)

then a future policy MAY:
    Attempt 2: pdfjs-text

Maximum: 2 total engine attempts. One conversion = one quota unit, one
cleanup envelope, one billing event. The result records engineId and the
attempt count honestly.
```

`suspicious`, `insufficient` and `not-evaluated` are NEVER fallback
triggers. Valid-but-empty extraction is NEVER a fallback trigger unless
production evidence specifically establishes it as a recoverable engine
failure (§10.10).

## 12. Security audit summary (§16)

- **Log injection**: labels are closed-vocabulary, whitespace-free
  (tested); provider keys sanitized; no free-form strings exist in the
  event type.
- **PII/content leakage**: no content-derived field exists; planted-PII
  tests cover content, filename and PDF metadata on success and failure
  paths.
- **High-cardinality attacks**: every dimension is a closed set (≤6
  values); maps cap at 8/128 keys and fold into `"other"`; engine ids come
  from the registry, not the request.
- **Oversized events**: no variable-size fields; hostile 10k-char labels
  fold safely (tested).
- **Amplification/DoS**: at most one event per request (attempt = 1);
  recording is O(1) map bumps — microseconds, no parsing, no I/O; the
  telemetry performs no PDF work of its own (§17: it reuses facts the run
  already produced: duration, meta page count, request byte lengths).
- **Client control**: no client-facing code imports the diagnostics or the
  telemetry facade (statically tested); no query/header/cookie/body field
  can influence any event field.

## 13. How to operate

- Default: diagnostics ON (in-process aggregates only).
- Kill switch: `PDFKIT_PDF_TEXT_DIAGNOSTICS=off` (also `0`, `false`,
  `disabled`). Unrecognized values keep diagnostics ON and warn.
- Read evidence: authenticated `GET /api/admin/metrics` (requires
  `PDFKIT_ADMIN_METRICS_TOKEN`; the endpoint answers 404 when the token is
  unset) → `pdfText` section. In-process aggregates reset on restart —
  they are a live operational view, not a data warehouse; persist via the
  operator's own scraping of the gated endpoint if history is needed.
- The metrics provider remains pluggable (Phase 63 facade): a
  PostgreSQL/Redis-backed provider can be added later WITHOUT touching
  engine or processing code.

## 14. Recommendation

**1 — Collect production evidence first.** Every remaining question
(failure rate, document diversity, same-byte recoverability, real resource
usage) is a launch-data question. The telemetry in this phase is the
instrument that answers it; the decision framework in §10/§11 is the
yardstick. Do not design automatic fallback before the numbers exist.
