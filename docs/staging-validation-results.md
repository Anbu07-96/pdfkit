# Phase 65 — Staging Validation Results

**Date:** 2026-09-09 · **Branch:** `arena/01a081d8-pdfkit` · **Environment:** local staging stack (production build, real PostgreSQL 16, real Redis 7, reverse proxy, two app instances)

This document records what was **actually executed** against the staging stack in Phase 65, with the raw results. Every number below comes from a real HTTP request, a real browser session, or a real database query — nothing is inferred from unit tests alone. The companion document is [`release-candidate-checklist.md`](./release-candidate-checklist.md).

---

## 1. Staging environment (how it ran)

| Component | Detail |
| --- | --- |
| App | `next build` + `next start`, NODE_ENV=production, PDFKIT_ENVIRONMENT=staging |
| Instances | 2 (`127.0.0.1:3101`, `127.0.0.1:3102`) behind a round-robin reverse proxy (`:3080`, stats `:3081`) |
| Database | Real PostgreSQL 16 (`:5433`, persistent data dir, 3 migrations applied) |
| Cache/protection | Real Redis (`:6399`), `PDFKIT_REDIS_REQUIRED=true` (fail-closed) |
| Limits | `RATE_LIMIT_PER_MINUTE=60`, `MAX_CONCURRENT_JOBS=2` (production values, unchanged) |
| Secrets | Random per-boot `NEXTAUTH_SECRET` / `ADMIN_METRICS_TOKEN` (recorded in local staging state, never printed) |
| Scripts | `scripts/infra/staging-up.mjs`, `staging-down.mjs`, `staging-checks.mjs`, `scripts/e2e/staging-browser.mjs` |

Harness details worth knowing when reading the results:

- **Source-IP control.** The validation driver issues raw `http.request`s with per-section loopback source addresses (`127.<a>.<b>.<n>`, run-unique). This is what makes the client-IP trust tests meaningful: different simulated clients are genuinely different TCP peers to the proxy.
- **Controlled staging resets.** `DailyUsage` rows are truncated at defined points (start of the usage section, before the bulk batches). This is staging test data only — accounts, history and migrations are never touched. Every reset is printed to the console when it happens.
- **Browser.** Real headless Chromium (`playwright-core` 1.63 + `@sparticuz/chromium` 152) with the package's bundled NSS/NSPR libraries extracted (the sandbox is not Amazon Linux, so the `al2023.tar.br` self-extraction does not trigger). The Lambda-specific `--single-process`/`--no-zygote`/`--disable-web-security` flags are removed for a realistic multi-process browser.

## 2. Results summary

| Suite | Result | Evidence |
| --- | --- | --- |
| HTTP staging checks (`staging-checks.mjs`) | **66/66 PASS** (twice, back-to-back) | `/tmp/pdfkit-infra/staging-checks-results.json` at run time |
| Restart / redeploy checks (`--only restart`) | **6/6 PASS** | same |
| Browser E2E (`staging-browser.mjs`) | **17/17 PASS** | `/tmp/pdfkit-infra/staging-browser-results.json` at run time |
| Unit/integration suite (`npm test`) | **1638 passed, 19 skipped** (174 files) | local gate |
| Type check (`tsc --noEmit`, after `next typegen`) | **clean** | local gate |
| Lint | **0 errors** (2 pre-existing warnings in files untouched this phase) | local gate |

### 2.1 HTTP staging checks — sections

- **Readiness (3/3):** liveness 200; readiness `status=ok` with database/redis/processing all `ok` (db 2–68 ms, redis 2–56 ms across runs); payload contains no connection strings or tokens.
- **Proxy & client-IP trust (10/10):**
  - One client through the round-robin proxy: **exactly 60 admitted, 61st → 429** — the budget is global across both instances (a per-instance limiter would have admitted 120). `Retry-After: 60`, code `TOO_MANY_REQUESTS`.
  - A different source IP is **not** affected by the first client's exhausted budget (distinguishability).
  - **Spoofing:** 61 job requests from ONE source IP, each carrying a *unique* fake `X-Forwarded-For`, `CF-Connecting-IP` and `X-Real-IP`. Identity never rotated — the stack rate-limited after 60 admitted requests anyway. (The proxy appends the true socket address to XFF — last entry wins — and strips CF/X-Real-IP; the app's `anonymizeClientIp` trusts only the last XFF entry unless explicitly configured otherwise.)
  - Proxy distributed traffic to both instances evenly (e.g. `:3101=2098, :3102=2098` cumulative).
  - 429 payloads contain no client IP.
  - **Failed jobs are not metered:** ~120 rejected garbage jobs left `DailyUsage` byte-for-byte unchanged (metering happens on success only).
- **Auth E2E (12/12):** registration 201; duplicate email (case-insensitive) → 409; disposable/placeholder domain → 400; correct password → session with the right email; correct-format-but-wrong password → no session; **lockout after 6 failures (the correct password is then rejected)**; session persists across requests and instances; `/account` renders account data when authenticated and carries **no** account data when anonymous (App Router streams the redirect with HTTP 200 — verified by content, not status code); verification token stored on registration; the verify link flips `accountTrustStatus` to `verified`; signout clears the session; without OAuth secrets the provider list is `credentials` only (Google/Microsoft **not** verified — requires real credentials).
- **Usage/quota (6/6):** anonymous jobs land in `DailyUsage` exactly (`anon` row, jobCount 3 after 3 jobs); `/api/usage` reports the same number; free user: **UI-facing endpoint == database** (both 2 after 2 jobs); 11th anonymous job → 429 `QUOTA_EXCEEDED`; database shows exactly 10/10 (no overage).
- **Tool matrix (17/17):** 16 tools + the encryption round-trip + anonymous spot-check, each with **real download + MIME + structural validation** (PDF signature, ZIP EOCD, JPEG/PNG magic bytes, docx/xlsx ZIP structure, text content). `password-protect` output genuinely refuses to open without the password (pdf-lib), then `unlock-pdf` round-trips it. `compare-documents` returns a text diff report. Full list: merge, split (every-page), compress, rotate, pdf-to-jpg, pdf-to-png, pdf-to-word, pdf-to-excel, pdf-to-text (`pages=all`), images-to-pdf, extract-images (`pages=all`), watermark, password-protect, unlock-pdf, redact-information, compare-documents.
- **Admin metrics (5/5):** no token → 401 (fail closed); wrong token → 401; valid token → 200 across instances; the snapshot reflects the validation traffic (`jobs.started` aggregates); **privacy scan finds no secret values, identities, IPs, filenames or connection strings** in any snapshot (the word "password" only appears inside the tool id `password-protect`).
- **Security headers (7/7):** `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, CSP with `default-src 'self'`, `Permissions-Policy` denies camera/microphone/geolocation; session cookie `HttpOnly` + `SameSite=Lax` (Secure is correctly absent on plain-HTTP local staging — TLS terminates at the platform edge); HSTS N/A locally, documented.
- **Billing fail-safe (2/2):** checkout without Razorpay configuration/auth → 401 `VALIDATION_ERROR` (no crash, no charge); pricing page renders.
- **Privacy / temp data (3/3):** a processing job adds **no files** to the system temp dir (uploads are processed in memory; `.next` unchanged); instance/proxy logs contain **no emails, passwords, tokens or uploaded filenames**; `job_completed` log lines carry tool/outcome/counts only.
- **Staging smoke (1/1):** `npm run smoke:staging` passes (5–7 checks depending on active rate windows — it adaptively skips token checks when a window is already hot, which is honest behavior).

### 2.2 Restart / redeploy (6/6)

Both app instances stopped (SIGTERM→SIGKILL by listening port — see finding F3), relaunched with identical env: readiness recovered in seconds; **pre-restart JWT sessions still valid** (same secret); database usage rows unchanged and migrations **not** re-run; Redis concurrency counter at 0 (no leaked slots); a full processing job succeeds after restart.

### 2.3 Browser E2E (17/17)

- **Pages (7):** `/`, `/tools`, `/pricing`, `/login`, `/register`, `/bulk`, `/account` all 200 with correct titles.
- **Registration UI (1):** real form → account created → signed in, lands on `/account`.
- **Login UI (1):** sign out via API, then sign in through the real form restores the session.
- **Tool flow (1):** upload two PDFs in the merge workspace → "Merge PDFs" → **real file download** (valid `%PDF-`, correct filename) via the blob object URL.
- **Account meter (1):** **UI meter == `/api/usage` == database** (e.g. `2/50 == 2 == 2`, tier free) — the number shown to the user is the number the server meters.
- **Bulk desktop (2):** anonymous 10-file batch (pdf-to-word): 10 succeeded / 0 failed / 0 skipped, ZIP with 10 entries, CSV with 10 rows, ~10 s, JS heap 7.6→10.0 MB. Free-tier 25-file batch: 25/0/0, 25-entry ZIP, 25-row CSV, ~26 s, heap 11.7→16.9 MB.
- **Bulk mobile (1):** 390×844 iPhone viewport, 10-file pdf-to-jpg batch: 10/0/0, 10-entry ZIP, 113 KB, ~10 s.
- **Bulk 50 (2):** business-tier 50-file pdf-to-text batch: **50/0/0**, 50-entry ZIP (7.3 KB), 50-row CSV, 54 s wall, **peak JS heap 15.7 MB**. Resource-review verdict: client-side orchestration stayed bounded (heap, wall time, output size all modest); **no evidence of a need for a server-side bulk queue** — current design holds.
- **Console/network audit (1):** no page errors, no 5xx, no failed requests, no unexplained console errors across every visited page. Two HTTP 429s were observed on `/api/usage` during batch load — the rate limiter working as designed from one shared IP; the client handled them (batches finished 0 failed). Chromium's automatic "Failed to load resource: 429" console line is classified accordingly.

## 3. Findings (all fixed or documented this phase)

**F1 — RC security blocker (found in code audit, fixed before validation): credentials auth never verified passwords.** `authorize()` accepted any policy-valid password for any known email (registration stored nothing). Fixed: registration stores `scrypt:16384:8:1:<salt>:<hash>` (NFKC, `timingSafeEqual`), `authorize()` verifies the stored hash, records failed attempts (6 → 15 min lockout, doubling, cap ×16), rejects suspended accounts, never logs PII. Unique index on `email`; case-insensitive normalization. Disclosed prominently: auth E2E passing *after* this fix is the meaningful result.

**F2 — RC blocker (found by browser E2E, fixed): every bulk file failed in real browsers.** The bulk runner's default `fetchImpl = fetch` was invoked method-style; in real browsers `Window.fetch` then throws `Illegal invocation`. All bulk files failed with `NETWORK_ERROR` after one retry. Node's undici fetch has no `this` requirement, which is why all unit tests stayed green. Fixed with `fetch.bind(globalThis)` (`src/lib/bulk/runner.ts`). After the fix, all four bulk batches completed 0 failed. This is the clearest example of why Phase 65 required a real browser.

**F3 — Infra bug (found while validating restarts, fixed): stale instances survived teardown.** `npx next start` wrapper processes exit while their `next-server` children keep the ports; killing only recorded wrapper PIDs left the OLD instances serving (with the old build and old secrets — observed as a metrics-token 401 after a "fresh" boot). Fixed: teardown signals process groups and sweeps by listening port (`ss` → exact PID); `staging-up.mjs` now reuses the same teardown.

**F4 — Cosmetic/robustness (observed, no code change): hydration race on `/login`.** Filling the form before React attaches listeners leaves the submit button disabled; a real user is unaffected (the state settles in well under a second). The E2E helper retries fill+click. Recorded, not "fixed" — no evidence a user can trigger it.

**F5 — Expected behavior worth documenting: 429s are visible in the browser console.** When the shared 60/min window saturates (one IP driving many API calls — as the harness does, and as a real user running a large bulk batch plus page loads could), Chromium logs "Failed to load resource: 429" for handled requests too. The bulk runner backs off and retries correctly. No change made; classified as by-design in the audit.

**F6 — ZIP evidence method.** Counting ZIP entries must use the End-of-Central-Directory record: bulk pdf-to-word outputs `.docx` files that are themselves ZIPs, so naive signature counting overcounts (10 files → 230 raw signatures, 20 name-filtered, 10 per EOCD). The validation scripts implement the EOCD method.

## 4. Not verifiable in this environment (honestly stated)

- **OAuth (Google/Microsoft):** implemented, conditionally enabled by env — never verified without real provider credentials.
- **Live billing/Razorpay:** deliberately unconfigured; only the fail-safe path (401, no charge) was exercised. No live payments, per phase constraints.
- **CI workflow execution:** the `ci.yml` change could not be pushed (missing `workflows` permission). Patch saved at `docs/phase65-ci-workflow-patch.diff`; applying it is a manual action by someone with permissions.
- **Real-CDN/edge TLS, HSTS, Secure cookies:** terminate at the platform edge; validated only insofar as the local stack correctly omits them on plain HTTP.

## 5. Reproduction

```bash
node scripts/infra/staging-up.mjs            # build + boot the stack (or --skip-build)
node scripts/infra/staging-checks.mjs        # 66 HTTP-level checks through the proxy
node scripts/infra/staging-checks.mjs --only restart   # restart/redeploy validation
node scripts/e2e/staging-browser.mjs         # 17 browser checks incl. bulk 10/25/50
node scripts/infra/staging-down.mjs          # teardown (data kept; --reset-data wipes)
```
