# Phase 63 — Multi-User Load Validation Results

**What this is.** Measured results from the deterministic multi-user load
suite (`src/lib/hardening/multi-user.load.test.ts`) and the bulk-limit
validation suite (`src/lib/bulk/bulk-limits.validation.test.ts`), plus the
bulk scenarios from Phase 62 (`src/lib/bulk/runner.load.test.ts`).

**What this is NOT.** A production capacity claim. Every scenario below ran
in-process on a single development machine: no network stack, no TLS, no
PostgreSQL (in-memory usage repository), no Redis (in-memory limiter), one
Node process, synthetic documents. The numbers prove *correctness under
concurrency* (isolation, accounting, boundedness, honest failures) — not
production throughput.

---

## Verified facts (architecture behavior, machine-independent)

These hold regardless of hardware because they are enforced in code and
asserted by the tests:

| Property | Result |
| --- | --- |
| Cross-user data isolation | 10/25/50-user waves: every user received exactly their own document (verified by per-user page counts in response headers) |
| Quota accounting under concurrency | Every user metered exactly once per successful job; no drift in any scenario |
| Tier independence | anonymous 10/10 exhausted → 11th rejected; free 50/50 exhausted → 51st rejected; pro/business unaffected (3/500, 3/5000) |
| Concurrency cap | With `PDFKIT_MAX_CONCURRENT_JOBS=4`: max in-flight = 4 (never exceeded), 21/25 requests fail fast with honest 503 `SERVER_BUSY`, all succeed after sequential retries |
| Rate limiter (shared IP) | 60 requests admitted, 61st+ rejected with 429 + real `Retry-After` (60 s = remaining window); separate IPs unaffected |
| Request watchdog | Caller gets 504 after the timeout; the job keeps running privately; its slot is released only when it truly ends (no leak — `activeJobCount()` returns to 0); the private completion is still counted in metrics |
| Bulk concurrency | 5 users × 5 different bulk operations (41 files) ran simultaneously: no cross-batch file contamination, every per-file job carried its batch id, per-user quota exact |
| Batch budgets | 200 pages / 200 MB output / 400 images budgets stop batches honestly (Phase 62 suite, re-verified) |
| Runner discipline | Single-flight (max 1 in-flight request per batch), 1.1 s pacing between request starts, retry budgets (2× rate-limit, 3× busy, 1× network per file) — no request storms under sustained 429/503 |
| Metrics boundedness | After 10,000+ events: minute ring ≤ 61 buckets, hour ring ≤ 25, duration ring = 4,096 entries, key maps ≤ 128 keys. No unbounded growth by construction |
| Tier ceilings (from code) | files/batch 10/50/100/100, upload/batch 50/100/250/250 MB, derived as `min(tier ceiling, daily quota)` — a reduced env quota can only shrink a batch, never enlarge it |

## Local test results (single dev machine, in-process, synthetic)

Machine-dependent numbers — recorded for trend comparison only:

| Scenario | Measured (latest run) |
| --- | --- |
| A — 10 concurrent users, one PDF→Word job each | wall ≈ 350–390 ms; per-job p50 ≈ 225–235 ms, p95 ≈ 235–245 ms |
| B — 25 users, cap 4 | test wall ≈ 1.6 s (deliberate 60 ms/job test delay); maxInFlight = 4 |
| C — 50 concurrent users | wall ≈ 310–320 ms; p50 ≈ 285–300 ms, p95 ≈ 295–310 ms, p99 ≈ 304–311 ms; RSS delta ≈ 19–23 MB for the whole wave |
| D — 5 concurrent bulk batches (41 files) | all succeeded; ~780 ms wall |
| E — shared-IP saturation | 60 admitted / 2 rate-limited out of 62 sequential requests |

Observations (local only): 50 simultaneous small jobs completed inside ~320 ms
of wall time in one Node process; memory moved by ~20 MB for the wave and
returned to trend after GC (asserted upper bound in test: < 512 MB growth).
Single-job CPU cost dominates wall time at this scale (pdf-lib parse/save).

## Bottlenecks (measured or identified, not guessed)

| Bottleneck | Status after Phase 63 | Evidence / what production telemetry must confirm |
| --- | --- | --- |
| CPU (single Node process) | **Primary server-side bottleneck** for raster operations (PDF→JPG/PNG via pdfium WASM) | Local: jobs are CPU-bound; measure `jobs.duration.p95` per tool via `/api/admin/metrics` |
| Memory (in-memory processing) | Bounded per file (25 MB) and per request (100 MB); watch RSS | `system.rssBytes` / `system.heapUsedBytes` in the snapshot; alert thresholds TBD from real traffic |
| Browser-side ZIP assembly | **Primary bulk bottleneck** (Phase 61/62 conclusion, unchanged): all outputs held in browser RAM until download | `batch_budget_stopped{reason:"output"}` beacons + `batch_completed.elapsedMs`; no server metric can see this |
| Database (PostgreSQL) | Not exercised locally (in-memory repo). Prisma upsert per job is the write path | Readiness probe `database.latencyMs`; `request_timeout` events correlating with DB latency |
| Redis (distributed limiter/locks) | Not exercised locally (in-memory fallback) | Readiness probe `redis.latencyMs`; `rate_limited` retryAfterSeconds distribution |
| Rate limiter (60 req/min per IP) | **Binding constraint for bulk throughput by design**: a 100-file batch takes ≥ 110 s of pacing alone | `rate_limited` volume vs batch sizes; scenario E confirms exact behavior |
| Anonymous shared bucket | Pre-existing: all anonymous visitors share one quota bucket per instance | `quota.rejectionsByTier.anonymous` |

## Production requirements (before any capacity claim)

1. Run the same scenarios against a deployed instance with PostgreSQL and
   Redis configured (readiness probe must report `ok`, not `degraded`).
2. Collect ≥ 30 days of `/api/admin/metrics` snapshots (see
   `docs/bulk-limit-review.md` thresholds).
3. Re-measure under real network latency and TLS termination.
4. Only then revisit limits through the review mechanism — not before.

## Assumptions (explicit)

- "Simultaneous users" in these tests means concurrent in-process requests,
  not real client diversity (browsers, connections, payloads).
- The load suite's processors are the real ones, but documents are tiny
  synthetic PDFs (1–11 pages); large-document behavior is covered by the
  Phase 62 suite (25 MB files), not re-measured here.
- No claim is made about a specific number of concurrent production users.


---

## Phase 64 addendum — infrastructure validation is correctness, not capacity

Phase 64 validated the multi-instance behavior of the shared infrastructure
(real PostgreSQL 16 + Redis 7.2.5 + two production instances) with controlled
traffic: global 60/min IP budget, global concurrency cap with slot reclamation,
exact cross-instance quota accounting, and fail-closed outage behavior
(21/21 harness checks; evidence in
`docs/distributed-infrastructure-validation.md`).

These runs are **not** load measurements and add nothing to the Phase 63
capacity picture: traffic volumes were single-digit to low-double-digit
requests, chosen to prove invariants (exactness, globality, fail-safety), not
throughput. The Phase 63 statement stands unchanged: no production capacity
claim is made from in-process or sandbox tests.
