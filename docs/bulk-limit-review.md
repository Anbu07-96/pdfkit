# Bulk Limits Review — Phase 62

**Purpose.** This document is the review mechanism for every bulk-processing
limit. Phase 62 deliberately changes **no numbers** — synthetic tests cannot
prove a raise is safe in production, and the phase's directive is explicit:
document, don't raise. Each entry records the current value, *why* it is what
it is, the metric to watch, the evidence threshold required to raise it, and
the condition under which it should be reduced.

Review cadence: after any incident touching a limit, and at least monthly once
production telemetry exists (Phase 40 logger + Phase 62 events).

---

## 1. Files per batch

| Tier | Current limit |
| --- | --- |
| Anonymous | 10 |
| Free | 50 |
| Pro | 100 |
| Business | 100 |

**Why conservative.** Concurrency is deliberately 1 (one file in flight per
browser). A 100-file batch at ~1.1 s pacing plus per-file processing time is a
multi-minute client-held session; the browser must keep every result blob in
memory until the ZIP download. Doubling files doubles peak client memory and
session duration — the two dimensions synthetic tests measure worst.

**Metric to observe.** `batch_done` job-log volume; p95 batch `elapsedMs` from
runner results; client-side "ZIP could not be created" toast frequency
(indirect, via feedback); quota rejections per batch (`quota_rejected` events
with `reason`).

**Raise threshold (100 → 200).** All of: ≥ 30 days of production data; p95
batch completion (not abandonment) above 80% for 100-file batches; no
correlated rise in `request_timeout` events; at least one manual 200-file
verification on the target hardware/browser matrix.

**Reduce condition.** Client memory reports (crashes, tab discards) or a rise
in `request_timeout` / abort rates that correlates with batch size.

---

## 2. Upload size per batch (and per file)

| Tier | Current limit |
| --- | --- |
| Anonymous | 50 MB |
| Free | 100 MB |
| Pro / Business | 250 MB |
| Per file (all tiers) | 25 MB |
| Per request | 100 MB |

**Why conservative.** The pipeline is fully in-memory by design (no native
binaries, no external services, no temp files). A 250 MB batch means the
server momentarily holds a decompressed working set of the largest file in it;
the per-file 25 MB cap bounds that working set. These limits protect the
single-process Node runtime from memory spikes far more than they protect
bandwidth.

**Metric to observe.** `QUOTA_EXCEEDED`/`TOTAL_SIZE_EXCEEDED` rejection counts
by tier (`quota_rejected` events carry `requestedBytes`); server RSS during
peak; OOM restarts.

**Raise threshold (250 MB → higher).** All of: sustained server memory
headroom demonstrated at the current cap (RSS p95 < 60% of container limit);
`TOTAL_SIZE_EXCEEDED` rejections exceeding ~5% of bulk attempts for 14 days;
no OOM events attributable to bulk.

**Reduce condition.** Any OOM or watchdog `request_timeout` cluster traced to
a large batch.

---

## 3. Result/output budget per batch

| Budget | Current limit |
| --- | --- |
| Output bytes per batch | 200 MB |
| Pages per batch (page-metered ops) | 200 |
| Extracted images per batch | 400 |
| Entries per archive result | 2,000 |
| Total entries per batch ZIP | 25,000 |

**Why conservative.** Results live in browser memory until download. The
entry caps (Phase 62) are archive-bomb defense-in-depth: a single hostile or
malformed PDF whose extraction yields thousands of entries must not expand
unboundedly into the client ZIP. 200 MB of held results is already near the
practical comfort zone of mobile Safari.

**Metric to observe.** Runner budget-stop rates (`batch-stopped` with
`budget-output` / `budget-pages` / `budget-images` reasons, mirrored in job
logs via batch correlation id); ZIP build failures.

**Raise threshold.** Budget-stop rates that exceed ~10% of completed batches
for 14 days *and* evidence that affected batches were legitimate (not
extraction-heavy outliers). Entry caps must not move without a dedicated
security review — they are protection, not quota.

**Reduce condition.** Any ZIP-build failure or client memory report at the
current output cap.

---

## 4. Rate limit & pacing

| Control | Current value |
| --- | --- |
| Requests per minute per IP | 60 |
| Client pacing between files | 1.1 s |
| 429 backoff | server `Retry-After`, else 60 s (clamped ≤ 120 s) |
| 429 retries per file | 2 |
| Busy (503) retries per file | 3 |
| Request timeout | 120 s |

**Why conservative.** 60 req/min is the blanket per-IP protection for the
whole site (single-file tools included); a bulk batch is a burst against the
same bucket. The 1.1 s pacing keeps a 100-file batch under the limit with
margin for the usage-refresh calls the workspace makes. The Retry-After
honoring (Phase 62) is honest: it waits exactly what the limiter reports, and
the retry budget prevents storms no matter what the header says.

**Metric to observe.** `rate_limited` events (now include
`retryAfterSeconds`); bulk batches that ended with failed files due to
`TOO_MANY_REQUESTS` after exhausting retries.

**Raise threshold.** Only together with the global rate limit review, and only
if `rate_limited` events show legitimate bulk users (not abuse) hitting the
cap repeatedly *and* the infrastructure shows spare capacity. Never raise the
retry budget instead of the rate limit — the budget exists to stop storms.

**Reduce condition.** Any evidence of retry storms (attempt counts above
1 + budget per file) or limiter saturation from bulk traffic displacing
single-file users.

---

## 5. Quota interaction

Bulk consumes the same daily job and byte quota as single-file tools, one job
per file, metered server-side on every request (Phase 61/62: the client's
caps/usage display is advisory only and never trusted for authorization).

**Why conservative.** A 100-file batch can consume a large share of a daily
quota in one action; the pre-flight warning and the per-file accounting keep
this visible, and the runner stops the batch the moment the server reports
`QUOTA_EXCEEDED` — no further files are attempted.

**Metric to observe.** `quota_rejected` events (`toolId`, `tier`, `reason`,
`requestedBytes`); share of batches ending in `quota` stops.

**Raise threshold.** Quota limits are plan economics, not load limits — they
change only through a plan/pricing decision, never through this load review.

**Reduce condition.** Not applicable (economics-driven).

---

## 6. What Phase 62 changed (and did not change)

Changed: observability around the limits (batch correlation ids, structured
`rate_limited` / `quota_rejected` / `request_timeout` events, tier on job
logs), honest Retry-After propagation, ZIP entry caps as protection, and this
review mechanism.

Not changed: every number in the tables above. They stay exactly as Phase 61
shipped them until production data justifies movement through this document.
