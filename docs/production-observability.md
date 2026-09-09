# PDFKit — Production Observability (Phase 63)

**Goal.** PDFKit can *observe, measure and validate* its current architecture
before any limits change. This document describes the observability model,
the endpoints, the metrics API, the dashboard specification, and what a
production deployment must configure.

---

## 1. The observability model

All operational telemetry flows through one pipeline:

```
processing code  →  recordTelemetryEvent()  →  ┬→ metrics provider (bounded aggregates)
            (src/lib/monitoring/telemetry.ts)   └→ existing structured logger (log pipeline)
```

**Events** (`src/lib/monitoring/telemetry-events.ts`):
`job_started`, `job_completed`, `job_failed`, `quota_rejected`,
`rate_limited`, `request_timeout`, `server_busy`, `http_response`, and the
client-reported bulk lifecycle events `batch_started`, `batch_completed`,
`batch_cancelled`, `batch_budget_stopped`, `batch_quota_stopped`.

**Safe metadata per event** (where applicable): tool id, tier, batch id,
request id, duration, input/output bytes, file counts, page/image counts,
error code + safe error category, HTTP status, retry-after seconds.
Environment identifier (`PDFKIT_ENVIRONMENT`, sanitized) and timestamp ride
along on every snapshot.

**Never in telemetry** (enforced by the typed event model, asserted by
tests): document contents, extracted text, file names, passwords, tokens,
cookies, payment data, user identities, IP addresses, connection strings.

**Request correlation**: every `/api/tools/*` response carries an
`x-pdfkit-request-id` header (server-generated). The id appears in the
timeout event and in job log lines, so one request's story can be reassembled
from logs. Users reporting a problem can quote the header value.

**Batch correlation**: the Phase 62 `x-pdfkit-batch-id` header (client
generated, strictly validated) rides on every per-file request; the same id
is used by the batch lifecycle beacons. Correlation only — never
authorization, quota or security.

## 2. The metrics layer (provider-neutral)

`src/lib/monitoring/metrics/types.ts` defines the `MetricsProvider`
interface. The default implementation,
`InMemoryMetricsProvider`, aggregates into strictly bounded structures:

| Aggregate | Bound |
| --- | --- |
| Requests/minute ring | 61 buckets (60 min) |
| Requests/hour ring | 25 buckets (24 h) |
| Job duration window | 4,096-entry ring (p50/p95/p99 over the newest window) |
| Per-key maps (tool/code/category/tier) | ≤ 128 sanitized keys, overflow folds into `other` |
| Counters | monotonic numbers |

Raw events are never stored. `PDFKIT_METRICS_PROVIDER` selects a provider
(today only `in-memory`; an unimplemented name fails open to in-memory with a
warning). A PostgreSQL/Redis/Sentry-backed provider can be added by
implementing the interface — **no processing code changes required**.

**Snapshot contents** answer: requests/min + /hour, active jobs, jobs
completed/failed, success rate, avg/p50/p95/p99 duration, bulk batches
started/completed/cancelled/budget-stopped/quota-stopped, files processed,
avg files per batch, avg batch duration, errors by tool/code/category, 2xx /
4xx / 429 / 503 / 504 counts, input/output bytes and averages, quota
rejections by tier, RSS + heap + Node version.

## 3. Endpoints

| Endpoint | Purpose | Auth |
| --- | --- | --- |
| `GET /api/health` | Liveness — process alive, always cheap, no dependencies touched | none |
| `GET /api/health/ready` | Readiness — database + Redis + processing checks; 200 `ok`/`degraded`, 503 `unavailable`; 5 s cache | none (no sensitive data) |
| `GET /api/admin/metrics` | Full telemetry snapshot | **Fail closed** — see below |
| `POST /api/bulk/telemetry` | Bulk batch lifecycle beacons from the browser runner | none (strictly validated, tiny, rate-limited, own scope) |

### Admin metrics security model

- Without `PDFKIT_ADMIN_METRICS_TOKEN` set, the endpoint answers **404** —
  it does not publicly exist.
- With the token set, callers must present it via `Authorization: Bearer …`
  or `x-pdfkit-admin-token`; comparison is constant-time. Missing/wrong →
  401 with no snapshot data.
- Token guessing is throttled by the IP limiter under a dedicated
  `admin-metrics` scope.
- The snapshot contains aggregates only (see §1); tests assert that no user
  identity, IP, file name, secret or connection string can appear.

### Bulk telemetry beacon trust model

Client values are **untrusted**: known event enum, known operation, strict
batch-id pattern, clamped counts, ≤ 2 KB body, origin check, own rate-limit
scope. Values are recorded as client-reported aggregates only — never used
for authorization, quota or security decisions, never stored raw.

## 4. Dashboard specification (implemented as API; UI pending)

The metrics API above is dashboard-ready. The recommended internal dashboard
(consuming `GET /api/admin/metrics` server-side, so the token never reaches
the browser):

- **Overview** — total jobs, successful, failed, active, success rate,
  average duration.
- **Traffic** — requests/minute + /hour sparklines, rate-limit events.
- **Tools** — top tools by usage, by failures, by p95 processing time.
- **Bulk** — batches started/completed/cancelled, files processed, budget
  stops by reason, average files per batch, average batch duration.
- **Quotas** — quota rejections by tier (anonymous/free/pro/business).
- **Reliability** — 429 / 422 / 503 / 504 counts, timeouts, processor
  failures by category.
- **System** — RSS, heap, Node version, environment.

None of these views require user-level data; the snapshot already omits it
by construction. A future `/admin/metrics` page should render server-side
behind the same token check (or an operator SSO once an admin role exists).

## 5. Production deployment requirements (Phase 63 additions)

| Requirement | Variable | Notes |
| --- | --- | --- |
| Admin metrics access | `PDFKIT_ADMIN_METRICS_TOKEN` | Long random string; **unset = endpoint disabled (404)** |
| Environment label | `PDFKIT_ENVIRONMENT` | Sanitized identifier in snapshots (e.g. `production-eu-1`) |
| Provider selection | `PDFKIT_METRICS_PROVIDER` | Only `in-memory` exists today; unknown values fail open with a warning |
| Database (readiness + quotas) | `DATABASE_URL` | PostgreSQL + `npx prisma generate` (real, engine-free client; see below) |
| Redis (readiness + distributed protection) | `PDFKIT_REDIS_URL` / `REDIS_URL` | Unset = in-memory fallback (single instance only) |
| Mandatory Redis (multi-instance) | `PDFKIT_REDIS_REQUIRED=true` | Unavailable Redis → 503 fail-closed responses AND 503 readiness; never a silent per-process downgrade (Phase 64) |

**Phase 64 update — the dev/CI Prisma stub is now fail-closed, not silent.**
The stub (written only when no real client exists, marked
`PrismaClient.PDFKIT_STUB`) still lets tests run without a database, but a
deployment that sets `DATABASE_URL` while only the stub is bundled **refuses
to start persistence** with an error naming the fix. `npx prisma generate`
produces the real client on the WASM query compiler with the pure-JS `pg`
driver adapter — no engine binaries. A pre-deploy environment validator
(`NODE_ENV=production node scripts/validate-environment.mjs`) checks the full
variable set and names variables only, never values.

**Readiness verdicts**: `ok` = all configured dependencies healthy;
`degraded` = optional dependencies unconfigured but the instance can process
(dev/single-instance mode); `unavailable` (503) = a configured dependency is
failing — or `PDFKIT_REDIS_REQUIRED=true` and Redis is unconfigured/unreachable
— the load balancer should remove the instance. The payload additionally
carries a sanitized `environment` label (Phase 64).

**Phase 64 admin-token hardening**: token comparison hashes both sides
(SHA-256) before `timingSafeEqual`, so neither content nor length is
observable through timing. The endpoint keeps its own rate-limit scope
(30/min); with required Redis unavailable it fails closed for everyone (503)
— token checks never bypass the limiter.

**Staging smoke (Phase 64)**: `PDFKIT_BASE_URL=... npm run smoke:staging`
verifies liveness, readiness (with dependency statuses), one real job, 422 on
invalid input, metrics protection and a visible rate limit with honest
`Retry-After`. See docs/staging-deployment.md §8.

## 6. Privacy findings (audited)

- No telemetry field carries document contents, text, file names, user
  identities, IPs (client IPs are SHA-256 hashed with a daily salt in the
  limiter and never enter telemetry), tokens, cookies or payment data.
- The admin snapshot and readiness payload were fuzzed in tests with hostile
  inputs (injection-shaped tool ids, connection-string-looking env values);
  everything hostile is sanitized or replaced with `unknown`/`other`.
- Beacons accept only counts and validated identifiers; extra fields are
  ignored and never recorded.
