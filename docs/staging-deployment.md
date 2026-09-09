# Staging Deployment Guide (Phase 64)

This guide covers everything needed to run PDFKit on a staging environment
with **real shared infrastructure** — PostgreSQL and Redis — and to verify the
deployment is wired correctly. It respects the existing platform assumptions
(Node runtime, `next build` / `next start`, no docker required, no vendor
lock-in). Nothing here changes processing behavior, limits, or pricing.

Companion document: **docs/distributed-infrastructure-validation.md** — how the
multi-instance behavior was validated locally, what each invariant means, and
what still requires staging validation.

---

## 1. Runtime and build

| Requirement | Value |
| --- | --- |
| Node.js | 22 LTS (`engines` in package.json) |
| Runtime | Next.js standalone server (`next start`) — Node runtime on all API routes (no edge, no lambda adapters) |
| Native binaries | **None.** Prisma runs on the WASM query compiler with the pure-JS `pg` driver adapter (`engineType = "client"` in `prisma/schema.prisma`); PDF work uses WebAssembly (pdfium) and pure JS (pdf-lib) |
| Build | `npm ci && npm run build` |

Build order matters for two generated artifacts:

```bash
npm ci                    # installs deps; writes the DEV-STUB Prisma client
                          # (only if no real client exists — see §3)
npx next typegen          # generates PageProps/LayoutProps route types into
                          # .next/types — REQUIRED before `npm run typecheck`
npm run build             # type-checks (needs the typegen output) and builds
```

> `next typegen` before typecheck is mandatory with Next 16: the global
> `PageProps`/`LayoutProps` types live in `.next/types`. CI runs it
> (`.github/workflows/ci.yml`).

## 2. Provision infrastructure

### PostgreSQL

Any PostgreSQL 14+ works. Staging needs:

- a database (e.g. `pdfkit`),
- a user with rights over that database only,
- a connection string: `postgresql://USER:PASSWORD@HOST:5432/DATABASE`.

Daily usage rows are stored in `DailyUsage` (unique per `userId + periodDate`,
atomic increments) — see `prisma/schema.prisma`.

### Redis

Any Redis 6+ (or Valkey) works. Used for exactly two global protections
(`src/lib/hardening/distributed-protection.ts`):

- `pdfkit:ratelimit:<scope>:<hashed-ip>` — fixed-window IP rate limit (60s TTL),
- `pdfkit:concurrency:active` — global concurrent-job counter (leases expire
  after 10 minutes, so a crashed instance cannot leak a slot forever).

Keys are namespaced under `pdfkit:`, contain only hashed IP tokens (16-char
SHA-256 slice, daily salt — never raw IPs) and fixed scope names, and all have
TTLs. No document content, filenames or user identities ever reach Redis.

## 3. Generate the REAL Prisma client (critical)

`npm install` writes a **development stub** Prisma client when (and only when)
no real client exists (`scripts/generate-prisma-client.js`). The stub lets the
app typecheck and run its unit tests without a database; it is a no-op at
runtime. **A deployment that configures `DATABASE_URL` must overwrite it:**

```bash
npx prisma generate
```

Safety net (Phase 64): if `DATABASE_URL` is set while the bundled client is
still the stub, the application **refuses to start usage persistence** with an
explicit error naming the fix (`npx prisma generate`) — it will never silently
run the no-op client and lose metering. `scripts/generate-prisma-client.js`
never overwrites an existing real client, and the stub is marked with
`PrismaClient.PDFKIT_STUB = true` + a `PDFKIT-STUB-CLIENT` marker file.

Prisma 6.16 with `engineType = "client"` needs **no engine binaries** — the
query compiler is WASM and the driver is `@prisma/adapter-pg` (pure JS). In
network-restricted build environments the CLI may still try to download engine
binaries (known upstream bug #27236); the documented workaround is environment
variables only (see docs/distributed-infrastructure-validation.md §A2).

## 4. Apply migrations

```bash
DATABASE_URL=postgresql://... npm run db:migrate    # prisma migrate deploy
```

Migration history (`prisma/migrations/`):

| Migration | Contents |
| --- | --- |
| `20260826000000_init` | `UserAccount`, `DailyUsage` (unique `userId+periodDate`, FK to `UserAccount(userId)`), `RazorpayWebhookEvent` |
| `20260909000000_add_account_verification_fields` | additive: `accountTrustStatus`, `authProvider`, `emailVerified`, `verificationToken` (unique), `verificationExpires` on `UserAccount`. Required because the email-verification flow and the `PersistedUserAccount` contract reference these columns; the initial migration predated them and the dev stub's hand-written types masked the mismatch (found and fixed in Phase 64). Safe on databases that already ran `init` — nullable/defaulted columns only. |

Both migrations are applied idempotently by `migrate deploy`; re-running is a
no-op. `npm run prisma:validate` checks the schema without touching a database
(requires `DATABASE_URL` to be set to any syntactically valid string).

## 5. Environment variables

Validate before deploying:

```bash
NODE_ENV=production node scripts/validate-environment.mjs
```

The validator names VARIABLE NAMES only — never values. Exit 0 = ok.

Required for staging/production:

| Variable | Meaning |
| --- | --- |
| `NODE_ENV=production` | enables fail-closed behavior (no in-memory usage repo, DB errors → `USAGE_SERVICE_UNAVAILABLE`) |
| `DATABASE_URL` | PostgreSQL connection string (required; without it persistence fails closed) |
| `NEXTAUTH_SECRET` | Auth.js session signing |
| `NEXTAUTH_URL` | public base URL |

Strongly recommended (multi-instance staging):

| Variable | Meaning |
| --- | --- |
| `PDFKIT_REDIS_URL` | Redis for the global IP rate limit + global concurrency cap (falls back per-process when unset — single instance only) |
| `PDFKIT_REDIS_REQUIRED=true` | Redis declared mandatory: unavailable Redis → 503 fail-closed responses + 503 readiness, never a silent downgrade (per-process limits would be multiplied by the instance count) |
| `PDFKIT_ADMIN_METRICS_TOKEN` | ≥ 16 chars, high-entropy. Unset = `/api/admin/metrics` disabled (404). Constant-time compared (SHA-256 digest comparison — token length is not observable) |
| `PDFKIT_ENVIRONMENT` | sanitized label (letters/digits/`.`/`-`/`_`, ≤ 32 chars) surfaced in readiness + metrics |

Existing optional knobs (limits, timeouts, quota overrides) are documented in
`.env.example`. **All Phase 64 limits are unchanged.**

## 6. Start

Single instance:

```bash
npm run start            # next start (PORT env or -p)
```

Multiple instances behind a load balancer: run N `next start -p <port>` with
the **same** `DATABASE_URL` and `PDFKIT_REDIS_URL`, and set
`PDFKIT_REDIS_REQUIRED=true` + `PDFKIT_MAX_CONCURRENT_JOBS` (the cap is then
global). Instances are stateless (no local files, no sticky sessions needed
for correctness of the protections; auth sessions are JWT-based).

## 7. Health, readiness, metrics

| Endpoint | Purpose | Behavior |
| --- | --- | --- |
| `GET /api/health` | liveness | always cheap, never touches dependencies, 200 while the process is up |
| `GET /api/health/ready` | readiness | checks database (when configured), Redis (when configured), tool registry; 5s response cache. Payload: `{status, timestamp, uptimeSeconds, environment, checks:{database,redis,processing}}` — statuses, latency ms and the sanitized environment label only. Never connection strings, hosts, secrets or paths |
| `GET /api/admin/metrics` | admin snapshot | disabled (404) unless `PDFKIT_ADMIN_METRICS_TOKEN` is set; constant-time token check behind its own rate-limit scope (30/min) |

Readiness semantics (Phase 63, extended in Phase 64):

- `200 ok` — every configured dependency answers.
- `200 degraded` — optional dependencies merely unconfigured (dev mode:
  in-memory usage repo, per-process limiter). Still able to process.
- `503 unavailable` — a **configured** dependency is failing, the tool
  registry is broken, or `PDFKIT_REDIS_REQUIRED=true` and Redis is
  unconfigured/unreachable. Load balancers should pull the instance.

Interpretation cheat sheet:

| database | redis | verdict |
| --- | --- | --- |
| ok | ok | `ok` |
| ok | unconfigured | `degraded` (fine single-instance) |
| failed | * | `unavailable` — do not route traffic |
| unconfigured | ok | `degraded` (dev mode persistence) |
| unconfigured (prod) | * | startup fails closed on first persistence call (`USAGE_SERVICE_UNAVAILABLE`) |

## 8. Smoke test

```bash
PDFKIT_BASE_URL=https://staging.example.com npm run smoke:staging
# optionally add PDFKIT_ADMIN_METRICS_TOKEN=... to verify authorized metrics access
```

Checks: liveness, readiness (with dependency statuses), one real merge job,
invalid PDF → 422, metrics 401/404 without token (+ 200 with token), and the
rate limiter visible (bounded probe: ≤ 31 requests against the admin scope —
no flooding; tolerant of an already-active window). Locally verified against a
production-mode instance with real PostgreSQL + Redis.

## 9. Logs and telemetry validation

After starting, verify from the outside:

- Processing requests log structured JSON lines (`job_completed` with
  `outcome`, `files`, `bytes`, `ms`, `code`, `tier`, `requestId`) — **no file
  contents, no filenames, no user identities**.
- `quota_rejected`, `rate_limited` (with `retryAfterSeconds`), `server_busy`
  events appear under the corresponding conditions.
- The admin metrics snapshot (`environment`, bounded counters) matches the
  `PDFKIT_ENVIRONMENT` label and resets on restart (in-memory provider).
- Telemetry is provider-neutral and bounded (Phase 63); the in-memory
  provider remains the only implementation (see §11).

## 10. Rollback

- **Application**: redeploy the previous build; the build is stateless.
  Migrations are additive, so an older application version keeps working
  against a newer schema (no destructive changes in Phase 64).
- **Migration rollback**: not provided by design — both Phase 64 changes are
  additive columns; restoring the previous application is sufficient. If the
  columns must be removed, do it with a new forward migration after verifying
  no code path references them.
- **Redis flush**: safe procedure is `redis-cli --scan --pattern 'pdfkit:*' |
  xargs redis-cli del` — this resets rate windows and the concurrency counter;
  the effect is a fresh budget, never data loss (usage truth lives in
  PostgreSQL).

## 11. Metrics provider decision (Phase 64)

The provider-neutral metrics interface (`src/lib/monitoring/metrics/types.ts`)
keeps exactly one implementation: the bounded in-memory provider. A Redis-backed
provider was reviewed and deliberately **not** added: current traffic does not
need cross-instance metric aggregation, and a shared store would add key
lifecycle/TTL concerns to a component whose value is its simplicity. Revisit
only with a concrete aggregation requirement (documented in
docs/distributed-infrastructure-validation.md §F).

## 12. Security checklist

- [ ] `PDFKIT_ADMIN_METRICS_TOKEN` set (≥ 16 chars, high entropy) or metrics intentionally disabled
- [ ] Secrets only in server-side env vars; no `NEXT_PUBLIC_*` secret
- [ ] `PDFKIT_REDIS_REQUIRED=true` when running more than one instance
- [ ] Readiness reachable only from the ops network if preferred (it leaks no secrets either way)
- [ ] TLS terminates before the app; the app binds `0.0.0.0` and expects `X-Forwarded-For`/`CF-Connecting-IP` from the proxy only
- [ ] Database user restricted to the PDFKit database
- [ ] `redis-cli --scan --pattern 'pdfkit:*'` shows only `pdfkit:`-namespaced keys with TTLs
- [ ] Error responses to clients are the structured JSON errors (`error.code`) — Prisma/PostgreSQL internals are never echoed (verified by tests)

## 13. What this sandbox validated vs. what needs staging

Everything in this guide that could run locally was executed and verified
(see docs/distributed-infrastructure-validation.md for the full evidence
matrix): real PostgreSQL 16 via the embedded-postgres npm package, real Redis
7.2.5, two production `next start` instances sharing both, 21/21 harness
checks, 19/19 integration tests, full unit suite, gates.

Still requires staging validation (cannot be simulated locally):

- managed PostgreSQL/Redis with real network latency, TLS and auth,
- the platform's actual proxy/load-balancer behavior (IP forwarding headers),
- sustained multi-day operation (Redis TTL rollover, midnight quota period
  rollover under real timezones).
