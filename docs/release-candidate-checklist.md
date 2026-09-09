# Release-Candidate Checklist — Phase 65

**Branch:** `arena/01a081d8-pdfkit` · **Date:** 2026-09-09 · **Companion evidence:** [`staging-validation-results.md`](./staging-validation-results.md)

Status legend: **PASS** (verified by actual staging execution unless noted) · **FAIL** · **BLOCKED** (external dependency) · **N/A** (not applicable by scope decision)

## A. Git & CI

| # | Item | Status | Note |
| --- | --- | --- | --- |
| A1 | CI workflow change audited, not silently dropped | PASS | YAML validated locally; push rejected (no `workflows` permission) |
| A2 | CI patch preserved | PASS | `docs/phase65-ci-workflow-patch.diff` — manual apply required |
| A3 | Single focused commit for the phase | PASS | One commit on the arena branch |
| A4 | Branch pushed, SHA reported | PASS | Pushed to `origin/arena/01a081d8-pdfkit` |
| A5 | No history rewrite / no main push | PASS | — |
| A6 | Working tree clean after commit | PASS | — |
| A7 | CI actually runs on GitHub | **BLOCKED** | Workflow could not be pushed; requires an actor with `workflows` permission |

## B. Staging infrastructure

| # | Item | Status | Note |
| --- | --- | --- | --- |
| B1 | Production build boots in staging | PASS | `next build` + `next start`, NODE_ENV=production |
| B2 | Real managed PostgreSQL | PASS | PG 16 `:5433`, persistent data dir, 3 migrations applied |
| B3 | Real managed Redis | PASS | Redis 7 `:6399`, `PDFKIT_REDIS_REQUIRED=true` (fail-closed) |
| B4 | Reverse proxy in front of app | PASS | Round-robin `:3080` → 3101/3102, XFF append, CF/X-Real-IP strip |
| B5 | Multi-instance (≥2) | PASS | Even traffic distribution observed (`:3101`/`:3102`) |
| B6 | Readiness/liveness endpoints | PASS | 200 `status=ok`, db/redis/processing all ok |
| B7 | Migration idempotency across restart | PASS | Migrations not re-run after restart |
| B8 | Teardown is complete (no stale listeners) | PASS | F3 fixed: process-group kill + port sweep |
| B9 | Limits unchanged from production | PASS | 60/min, MAX_CONCURRENT_JOBS=2, tier quotas untouched |

## C. Proxy / network / client-IP trust

| # | Item | Status | Note |
| --- | --- | --- | --- |
| C1 | Global rate budget not multiplied by instances | PASS | Exactly 60 admitted then 429 through the round-robin proxy |
| C2 | Retry-After + machine-readable code on 429 | PASS | `Retry-After: 60`, `TOO_MANY_REQUESTS` |
| C3 | Different clients have independent budgets | PASS | Fresh IP unaffected by an exhausted bucket |
| C4 | X-Forwarded-For spoofing does NOT bypass | PASS | 61 unique fake XFF/CF/X-Real-IP — identity never rotated |
| C5 | Untrusted headers ignored by default | PASS | CF-Connecting-IP / X-Real-IP stripped at proxy, ignored by app |
| C6 | No raw IPs in responses, logs or telemetry | PASS | Log scan + 429 payload scan + metrics scan clean |

## D. Authentication

| # | Item | Status | Note |
| --- | --- | --- | --- |
| D1 | Passwords actually verified (the F1 defect) | PASS | scrypt hash stored at registration; verified in `authorize()`; fixed this phase |
| D2 | Registration API + UI | PASS | 201 / real form → signed in |
| D3 | Duplicate email rejected (case-insensitive) | PASS | 409 |
| D4 | Disposable/placeholder email blocked | PASS | 400 (mailinator, example.com, …) |
| D5 | Valid login → session | PASS | via real NextAuth credentials flow |
| D6 | Wrong password rejected | PASS | No session; failure recorded |
| D7 | Lockout after repeated failures | PASS | 6 fails → correct password then rejected |
| D8 | Session persistence (cross-instance) | PASS | JWT sessions valid on both instances |
| D9 | Logout | PASS | Session cleared |
| D10 | Protected account page | PASS | Authenticated renders data; anonymous carries none (streamed redirect) |
| D11 | Email verification flow | PASS | Token stored; verify link → `verified` |
| D12 | OAuth (Google/Microsoft) | **BLOCKED** | Implemented, env-conditional; requires real provider credentials |

## E. Usage & accounting

| # | Item | Status | Note |
| --- | --- | --- | --- |
| E1 | Anonymous jobs metered in DB | PASS | Exact row counts observed |
| E2 | UI meter == server == database | PASS | Browser-verified (e.g. 2/50 == 2 == 2) |
| E3 | Quota rejection at limit | PASS | 11th anonymous job → 429 `QUOTA_EXCEEDED` |
| E4 | No quota overage | PASS | DB shows exactly 10/10 |
| E5 | Failed jobs not metered | PASS | ~120 rejected jobs left DailyUsage unchanged |
| E6 | Tier limits correct (free/business observed) | PASS | 50/day free, 5000/day business via `/api/usage` |

## F. Single-tool matrix

| # | Item | Status | Note |
| --- | --- | --- | --- |
| F1 | 16 tools with real downloads | PASS | merge, split, compress, rotate, pdf→jpg/png/word/excel/text, images→pdf, extract-images, watermark, protect, unlock, redact, compare |
| F2 | MIME types correct | PASS | Per-tool content-type asserted |
| F3 | Structural validity | PASS | PDF/ZIP/JPEG/PNG magic bytes; docx/xlsx ZIP structure; encryption round-trip (protected file refuses to open; unlock restores) |
| F4 | Anonymous tool path | PASS | Anonymous merge 200 |
| F5 | Option contracts honored | PASS | rotations, password, pages, mode, areas, watermark options |

## G. Bulk

| # | Item | Status | Note |
| --- | --- | --- | --- |
| G1 | Bulk works in a real browser (the F2 defect) | PASS | `fetch.bind(globalThis)` fix; 0 failed across all batches |
| G2 | Anonymous 10-file batch (desktop) | PASS | 10/0/0, ZIP 10 entries, CSV 10 rows |
| G3 | Free 25-file batch (desktop) | PASS | 25/0/0, ZIP 25 entries, CSV 25 rows |
| G4 | Mobile viewport batch | PASS | 390×844, pdf-to-jpg 10/0/0 |
| G5 | Business 50-file batch | PASS | 50/0/0, 54 s, peak heap 15.7 MB |
| G6 | ZIP at 10/25/50 | PASS | EOCD-verified entry counts; correct sizes |
| G7 | CSV export | PASS | Row counts match file counts |
| G8 | Resource review verdict | PASS | No evidence for server-side redesign; current caps hold |
| G9 | Honest progress/retry semantics | PASS | Batch-level status lines observed; retry/backoff exercised by 429s (handled) |

## H. Reliability

| # | Item | Status | Note |
| --- | --- | --- | --- |
| H1 | Controlled restart recovery | PASS | Readiness back in seconds |
| H2 | Sessions survive restart | PASS | Same JWT secret |
| H3 | DB accounting survives restart | PASS | Rows unchanged |
| H4 | No leaked concurrency slots | PASS | Redis counter 0 after restart |
| H5 | Processing works after restart | PASS | Full job 200 |

## I. Observability, security, privacy

| # | Item | Status | Note |
| --- | --- | --- | --- |
| I1 | Admin metrics fail-closed | PASS | 401 without/with wrong token |
| I2 | Admin metrics authorized | PASS | 200 with token, across instances |
| I3 | Metrics privacy | PASS | No secrets/PII/IPs/filenames in snapshots |
| I4 | Security headers | PASS | nosniff, DENY, referrer-policy, CSP `default-src 'self'`, permissions-policy |
| I5 | Session cookie flags | PASS | HttpOnly + SameSite=Lax (Secure at edge, documented) |
| I6 | No CSP regression | PASS | No strict-CSP additions; all pages functional under current policy |
| I7 | Browser console/network audit | PASS | No page errors/5xx/failed requests; 429s by design and handled |
| I8 | Temp-file privacy | PASS | No files left in tmpdir; logs contain no contents/filenames |

## J. Quality gates

| # | Item | Status | Note |
| --- | --- | --- | --- |
| J1 | `npm test` | PASS | 1638 passed / 19 skipped (174 files) |
| J2 | `tsc --noEmit` | PASS | Clean (after `next typegen`) |
| J3 | Lint | PASS | 0 errors (2 pre-existing warnings, untouched files) |
| J4 | Staging HTTP checks | PASS | 66/66, twice back-to-back |
| J5 | Staging browser checks | PASS | 17/17 |
| J6 | Restart checks | PASS | 6/6 |

## K. Release decision inputs

| # | Item | Status | Note |
| --- | --- | --- | --- |
| K1 | RC blockers resolved | PASS | F1 (auth), F2 (bulk) fixed and verified in staging |
| K2 | Live billing | N/A | Deliberately disabled — dedicated later phase; fail-safe verified |
| K3 | Limits unchanged | PASS | No tier/limit modifications |
| K4 | OAuth | **BLOCKED** | Requires real credentials before public launch |
| K5 | CI on GitHub | **BLOCKED** | Manual workflow push required (permissions) |
| K6 | Production (edge TLS, real CDN, secrets mgmt) | **REQUIRES PRODUCTION VALIDATION** | Local staging validates app behavior only |

**Overall: release-candidate quality for the application itself. Remaining blockers are operational (OAuth credentials, CI workflow push), not code.**
