# Distributed Infrastructure Validation (Phase 64)

How PDFKit's shared-infrastructure behavior was validated against **real
PostgreSQL and real Redis in this sandbox**, what the invariants are, how to
re-run everything, and what honestly remains open. Companion guide:
docs/staging-deployment.md (operational how-to).

---

## A. Environment notes (sandbox-specific, reproducibility)

### A1. What ran here

| Component | How obtained | Notes |
| --- | --- | --- |
| Node 22.22.3 | sandbox image | — |
| PostgreSQL 16.13 | `embedded-postgres@16.13.0-beta.16` (npm) | native server binaries distributed via npm — no apt/docker (both unavailable: package mirrors blocked) |
| Redis 7.2.5 | compiled from the official GitHub release tarball (`make MALLOC=libc`) | download.redis.io blocked; source build instead. Any Redis 6+ works identically for the two Lua scripts used |
| Prisma 6.16.2 | npm | WASM query compiler (`engineType = "client"`), pure-JS `pg` adapter — **zero engine binaries executed** |

### A2. Offline `prisma generate` workaround

Upstream bug (prisma/prisma#27236): the 6.16 CLI attempts an engine-binary
download even when the schema uses the WASM compiler. In a network-restricted
environment, generate with placeholder paths that are never executed:

```bash
PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1 \
PRISMA_QUERY_ENGINE_LIBRARY=/path/to/any/file \
PRISMA_SCHEMA_ENGINE_BINARY=/path/to/any/file \
npx prisma generate
```

On staging with normal network access, plain `npx prisma generate` works.
Either way the generated client is engine-free (verified: `engineType:
"client"` in the generated code, driver adapter required at runtime).

### A3. embedded-postgres locale fix

`initialise()` hard-codes `--lc-messages=en_US.UTF-8` which fails on systems
without that locale. The harness (`scripts/infra/postgres.mjs`) calls `initdb`
directly with `--lc-messages=C` and a temp pwfile (`/dev/stdin` is unreadable
when stdin is closed — non-interactive CI/sandboxes).

---

## B. What was validated, and how

### B1. Real-PostgreSQL integration tests (10/10 passing)

`src/lib/usage/postgres.integration.test.ts` — runs only with
`PDFKIT_TEST_DATABASE_URL` (skipped otherwise; never mocked):

1. real connection + empty unique-lookup round trip,
2. account persistence incl. verification-token lookup,
3. atomic usage increments (upsert + `increment`),
4. **concurrency**: 25 parallel `+4` increments → exactly 100 (no lost updates),
5. **concurrency**: 12 simultaneous same-account jobs → each accounted exactly
   once, one account row (no duplicates),
6. **FK regression**: anonymous usage persists (parent `UserAccount` row is
   ensured for every identity — previously crashed on real PG; the in-memory
   repository masked it),
7. **quota boundary**: preflight read-then-check is documented TOCTOU — the
   invariant tested is *exact accounting*: `stored == seeded + admitted`,
   never a lost increment,
8. daily period rollover separation,
9. Razorpay webhook idempotency (duplicate insert fails, never double-counts),
10. **fail-safe**: dead DB in production mode → `ProcessingError
    USAGE_SERVICE_UNAVAILABLE`, message never echoes the connection string.

### B2. Real-Redis integration tests (9/9 passing)

`src/lib/hardening/redis.integration.test.ts` — runs only with
`PDFKIT_TEST_REDIS_URL`; two module instances simulate two processes sharing
one Redis:

1. connectivity + latency ping,
2. **shared budget**: alternating 30+30 requests across two instances → the
   61st is 429 on either instance (global 60/min, NOT 120), different IP unaffected,
3. **Retry-After consistency** across instances (same window, ±1s),
4. **TTL**: rate key expires → window resets, both instances see the reset,
5. **shared cap**: slots are global (2 slots across both instances; release on
   one frees capacity observed by the other),
6. **watchdog**: un-released slots expire via lease TTL,
7. release never drives the counter below zero,
8. **outage**: unreachable Redis → readiness `failed` (visible); dev fallback
   stays bounded (429 after 1/min) — never unlimited,
9. **key hygiene**: only `pdfkit:`-namespaced keys, hashed tokens, no raw IPs.

**Real defect found and fixed by these tests**: with `lazyConnect +
enableOfflineQueue:false`, a cold client's first rate-limit command rejected
and silently fell back to per-process state — the first requests after a
deploy/reconnect bypassed the global budget. Fix: bounded connection-readiness
wait (`ensureRedisReady`) before the first eval in
`checkRateLimit`/`tryAcquireDistributedSlot`/`releaseDistributedSlot`.

### B3. Multi-instance harness (21/21 checks passing)

`scripts/infra/multi-instance-validate.mjs` — boots embedded PostgreSQL +
Redis, runs `next build`, starts **two production `next start` instances**
(3101/3102) sharing both, `PDFKIT_REDIS_REQUIRED=true`,
`PDFKIT_MAX_CONCURRENT_JOBS=2`, `PDFKIT_RATE_LIMIT_PER_MINUTE=60`, then drives
controlled real HTTP traffic:

| Check | Result | What it proves |
| --- | --- | --- |
| startup | ✔ | readiness `ok` (db+redis ok) on both instances, sanitized environment label |
| C.slot-cap | ✔ | Redis concurrency counter = 2 while two heavy jobs run |
| C.third-rejected | ✔ | third concurrent job → 503 `SERVER_BUSY` |
| C.heavy-done | ✔ | both heavy jobs complete (200) |
| C.no-leak | ✔ | counter returns to 0 after completion |
| B.global-60 | ✔ | alternating instances: exactly 60 admitted, then 429 — **not 120** |
| B.reject-detail | ✔ | 429 body code `TOO_MANY_REQUESTS` |
| D.retry-after | ✔ | both instances report the same window (±1s) |
| E.readiness-visible | ✔ | Redis outage → 503 readiness with `redis:failed` on both |
| E.fail-closed | ✔ | processing request during outage → 503, never unlimited |
| E.metrics-fail-closed | ✔ | admin metrics 503 for everyone during outage (no bypass) |
| E.recovery | ✔ | Redis restart → readiness recovers on both |
| E.metrics-token-after-recovery | ✔ | 401 without / 200 with token after recovery |
| A.quota-fill | ✔ | 8 alternating jobs succeed (10/10 total) |
| A.quota-reject | ✔ | 11th job → `QUOTA_EXCEEDED` on both instances |
| A.exact-usage | ✔ | **database truth: exactly 10** jobs for the anonymous user — no lost increments across instances |
| A.anon-account | ✔ | anonymous parent account exists (tier=anonymous, email=null) — FK regression stays fixed |
| F.readiness-visible | ✔ | DB outage → 503 readiness with `database:failed` on both |
| F.fail-safe | ✔ | job during DB outage → 503 `USAGE_SERVICE_UNAVAILABLE`, no false success |
| F.recovery | ✔ | DB restart → readiness recovers |
| F.no-false-accounting | ✔ | after outage+recovery usage is still exactly 10 — nothing phantom-recorded |

Harness details worth knowing:

- Heavy concurrency jobs use a 50-page PDF through `pdf-to-jpg` (the
  `maxConversionPages` limit is 50 — an 80-page fixture was correctly
  rejected with 413 during harness development, confirming the limit works).
- Quota-boundary requests are sequential on purpose: the preflight is a
  documented read-then-check; racing it would overshoot by one (bounded,
  exactly-once accounting still holds — covered by B1 #7).
- Anonymous quota is 10 jobs/day, so scenario order is C (2 heavy jobs),
  B/D (invalid files — no quota), E (outage), A (fills the remaining 8), F.

### B4. Staging smoke (7/7 + windowed re-run)

`scripts/staging-smoke.mjs` (also `npm run smoke:staging`) verified against a
production-mode instance with real PG+Redis: liveness, readiness, a real merge
job, invalid PDF → 422 `INVALID_PDF`, metrics 401/200, rate-limit visible with
honest `Retry-After`. The script tolerates an already-active rate window
(fresh window from a previous run → skip token checks with an explicit note
instead of false-failing).

### B5. Fail-closed unit coverage (always runs, no infra needed)

- `src/lib/hardening/distributed-protection.required.test.ts` (6 tests):
  `PDFKIT_REDIS_REQUIRED=true` + failing/unconfigured Redis → visible 503 /
  slot denied, no silent per-process fallback; flag unset → documented
  fallback retained; Redis path 429 keeps honest Retry-After.
- `src/lib/usage/repository.stub-guard.test.ts` (3 tests): stub client +
  `DATABASE_URL` → refuses with actionable error (no connection-string echo);
  real client → constructs with the driver adapter; no `DATABASE_URL` →
  in-memory repository.
- `src/lib/config/environment.test.ts` (22 tests): every env rule, including
  script/module parity and "values never echoed" assertions.
- `src/app/api/health/ready/route.test.ts` (10 tests): verdict matrix incl.
  required-Redis semantics and environment sanitization.
- `src/lib/usage/usage.test.ts` (18 tests incl. 3 new): anonymous parent-row
  regression, idempotent anon account, authenticated metadata not clobbered.

Full suite: **1616 passed + 19 integration-skipped (1635 total)**; gates:
lint 0 errors (2 pre-existing warnings preserved), typecheck clean, build
clean, `npx prisma validate` clean, real `npx prisma generate` verified.

## C. Security review of the new infrastructure (Step 12)

| Area | Finding / fix | Regression test |
| --- | --- | --- |
| Redis key collisions | fixed `pdfkit:` namespace + scopes; hashed 16-char IP tokens (daily salt) | B2 #9 |
| User-controlled keys | keys built only from hashes/fixed scopes; IP format sanitized before hashing | B2 #9 |
| Unbounded key creation | every key has a TTL; rate keys expire with the window; concurrency leases expire (10 min) | B2 #4, #6 |
| In-memory fallback growth | fallback map now prunes expired windows above 5k entries, hard cap 10k (was append-only forever) | code review + bounded sweep |
| Connection-string leakage | startup/error paths assert messages never echo URLs; readiness payload allow-list | stub-guard #1, B1 #10, readiness tests |
| Prisma error leakage | `handleDbError` maps to `USAGE_SERVICE_UNAVAILABLE` in production; driver internals not surfaced | B1 #10 |
| Admin token timing | comparison now SHA-256-digest-then-`timingSafeEqual` (length not observable) | existing admin tests + code review |
| Health disclosure | readiness exposes statuses/latency/environment label only | readiness tests |
| Staging debug modes | none added; no debug env vars introduced | — |
| Telemetry cardinality | unchanged from Phase 63 (bounded counters, no identities/contents) | existing telemetry tests |
| Spoofed request/batch IDs | server-generated IDs only (unchanged Phase 62/63 behavior) | existing tests |
| Distributed lock leakage | release is no-op below zero; lease TTL watchdog reclaims crashed-instance slots | B2 #6, #7 |
| TOCTOU quota preflight | documented: bounded overshoot under racing preflights, exact once-only accounting preserved (no lost increments; recordUsage is an atomic DB upsert) | B1 #7, B3 A.exact-usage |

## D. Re-running everything

```bash
# Integration tests (skipped automatically without these env vars)
PDFKIT_TEST_DATABASE_URL=postgresql://pdfkit:pdfkit@127.0.0.1:5433/pdfkit_test \
PDFKIT_TEST_REDIS_URL=redis://127.0.0.1:6399/0 \
npx vitest run src/lib/usage/postgres.integration.test.ts src/lib/hardening/redis.integration.test.ts

# Start disposable infra (embedded PG 16 on 5433, Redis on 6399 if absent)
node -e "import('./scripts/infra/postgres.mjs').then(m=>m.startEmbeddedPostgres({dataDir:'/tmp/pg',port:5433,database:'pdfkit_test'}).then(p=>console.log(p.url)))"
node -e "import('./scripts/infra/redis.mjs').then(m=>m.startRedis({port:6399}).then(r=>console.log(r.url)))"

# Full multi-instance harness (build + 2 instances + all scenarios)
node scripts/infra/multi-instance-validate.mjs

# Staging smoke against a running deployment
PDFKIT_BASE_URL=https://staging.example.com npm run smoke:staging

# Environment validation
NODE_ENV=production node scripts/validate-environment.mjs
```

CI (`.github/workflows/ci.yml`) runs the two integration suites on every
PR/push to main with a real `prisma generate`, an embedded PostgreSQL and a
Redis service container. *(CI execution requires a PR to main — this branch's
pushes target `arena/01a081d8-pdfkit`; commands mirror the locally verified
invocations.)*

## E. Known limitations & honest status

1. **Sandbox blockers**: docker, apt (deb.debian.org), binaries.prisma.sh and
   download.redis.io were unreachable. Workarounds used npm-distributed PG
   binaries and a Redis source build — functionally identical for the
   validated behavior, but noted for transparency.
2. **The 10-minute concurrency lease TTL** means a crashed instance's slot is
   reclaimed only after expiry (by design; a future per-slot lease registry
   could reclaim instantly).
3. **Quota preflight TOCTOU**: concurrent requests racing the boundary can
   overshoot by a bounded amount (at most the number of concurrent racers);
   accounting remains exact (each admitted job counted exactly once). A
   conditional atomic-increment-with-limit inside PostgreSQL would remove the
   overshoot; deliberately not introduced in Phase 64 because the overshoot is
   bounded, small, and the change would couple the quota check to a
   single-round-trip SQL contract — revisit if product requires hard caps.
4. **Metrics remain in-memory per instance** (provider-neutral interface, one
   bounded implementation). Cross-instance aggregation is future work with a
   concrete requirement.
5. **Requires staging validation** (cannot be simulated): managed-database
   TLS/auth/latency, the platform's real proxy header behavior, multi-day
   operation (TTL rollover, midnight quota periods in real timezones),
   platform-level rolling restarts.

## F. Metrics provider review (Step 11) — decision

Provider-neutral interface retained (Phase 63). A Redis-backed provider was
**not** added: the current in-memory provider is bounded, zero-dependency and
sufficient for per-instance snapshots; cross-instance aggregation would add
shared-state key lifecycle for no current requirement. Revisit with a real
aggregation need (e.g. fleet-wide dashboards) — the interface already
accommodates it.
