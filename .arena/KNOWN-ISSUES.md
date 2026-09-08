# PDFKit — Known Issues, Verification & Security Audit Notes

## 1. Account Security & Input Hardening (Phase 46D)
- **Email Validation & Normalization**:
  - `validateAndNormalizeEmail()` in `src/lib/auth/validation.ts` enforces strict RFC 5321 length limits (<= 254 chars), rejects whitespace, control characters, and consecutive dots (`..`).
  - Normalizes email addresses to trimmed lowercase (`user@domain.com`) to prevent duplicate accounts caused by casing variations.
  - Rejects disposable / temporary throwaway email domains (`mailinator.com`, `tempmail.com`, `yopmail.com`, `10minutemail.com`, etc.) using a static local domain blocklist. Does NOT block mainstream providers (`gmail.com`, `outlook.com`, `yahoo.com`, `proton.me`, `icloud.com`).
  - Note: Disposable domain blocking + syntax validation is implemented. Full email ownership verification via magic link / OTP remains a future enhancement.

- **Password Policy Hardening**:
  - `validatePassword()` in `src/lib/auth/validation.ts` enforces 8 to 128 character length boundaries.
  - Requires alphanumeric complexity (at least one letter AND at least one number). Rejects spaces/control characters.
  - Rejects known common / easily guessed passwords (`password123`, `12345678`, `qwerty123`, `admin123`, `pdfkit123`, etc.).

- **HTTP Security Headers & CSP**:
  - `next.config.ts` enforces `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, and a Content-Security-Policy (CSP) that explicitly trusts Razorpay checkout assets (`https://checkout.razorpay.com`, `https://api.razorpay.com`).

---

## 2. Redaction Security Classification (Phase 46D)
- **Behavior**: `redact-information` draws vector blackout rectangles over specified page coordinates (`page.drawRectangle(...)` via `pdf-lib`).
- **Honest Security Scope**: Vector blackout rectangles visually obscure content on the rendered page canvas. However, underlying PDF text streams in un-rasterized vector PDFs are not destroyed unless flattened/rasterized.
- **Framing**: User interface and catalog descriptions honestly state that blackout rectangles cover visible content on the page and that underlying text streams are not stripped.

---

## 3. Production Service Configuration Verification Requirements
Before exposing PDFKit to real production traffic, the following infrastructure items must be configured and verified:

1. **Razorpay Production Billing Verification**:
   - `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_PRO_PLAN_ID` must be configured with test or production credentials.
   - `RAZORPAY_WEBHOOK_SECRET` must be set up in the Razorpay Dashboard for `https://<domain>/api/billing/webhook`.
   - HMAC SHA-256 signature verification and live subscription lifecycle events (`subscription.activated`, `subscription.charged`, `subscription.cancelled`) must be tested in Razorpay TEST MODE.

2. **Redis Distributed Protection Verification**:
   - `PDFKIT_REDIS_URL` or `REDIS_URL` must connect to a production Redis cluster.
   - Distributed concurrency lock TTLs and rate limit IP hashing (SHA-256 with daily salt) must be verified under multi-instance deployments.

3. **Database Migration & Deployment**:
   - PostgreSQL database must be provisioned and `DATABASE_URL` set.
   - Prisma migrations (`npx prisma migrate deploy`) must be run to create `UserAccount`, `DailyUsage`, and `RazorpayWebhookEvent` tables.

4. **Sentry Monitoring Verification**:
   - `SENTRY_DSN` must be configured to capture server-side processing exceptions while verifying PII sanitization.

---

## 4. Tool Catalog & Feasibility Assessment

1. **Catalog Status**:
   - **33 AVAILABLE tools**
   - **13 COMING_SOON tools**
   - **1 BLOCKED tool**: `pdf-to-grayscale` (requires Ghostscript or vector color space re-encoding engine).

2. **Feasibility Audit for Remaining COMING_SOON Tools**:
   - **Office Conversions** (`word-to-pdf`, `excel-to-pdf`, `powerpoint-to-pdf`): Kept COMING_SOON because accurate layout rendering requires LibreOffice or a headless browser engine, violating zero-native-binary constraints.
   - **AI Tools** (`summarize-pdf`, `ask-pdf`, `extract-important-information`, `generate-notes`, `generate-key-points`, `extract-dates-and-deadlines`, `translate-documents`): Kept COMING_SOON because LLM inference requires external paid AI APIs, violating zero-external-API constraints.
   - **OCR Tools** (`scanned-pdf-to-searchable-pdf`, `ocr-document`, `image-to-text`): Kept COMING_SOON pending local offline language model assets.
   - **Digital Signature** (`digital-signature`): Kept COMING_SOON pending X.509 PKCS#7 / PFX certificate manager integration.

---

## 5. Bulk Tools Limits, Rationale & Known Limitations (Phase 61)

### Architecture
- Bulk processing is **client-orchestrated**: the browser sends each file as its own ordinary request to the existing single-file endpoint (sequentially, ≥1.1 s apart). No server-side batch endpoint exists, so quota metering, rate limiting, concurrency caps, origin checks, validation and sanitisation apply per file with no bulk bypass.
- A bulk operation may only exist while its underlying single-file tool is `AVAILABLE` (enforced by `src/lib/tools/bulk.test.ts`).

### Selected limits and why
| Limit | Anonymous | Free | Pro | Business | Reasoning |
| --- | --- | --- | --- | --- | --- |
| Files per batch | 10 | 50 | 100 | 100 | `min(tier ceiling, daily job quota)` — anon 10 = its whole daily job quota (a bigger batch could never finish); free 50 = whole daily quota; pro/business 100 where browser memory and session duration bind before quota does. |
| Total upload per batch | 50 MB | 100 MB | 250 MB | 250 MB | Same `min(quota, ceiling)` derivation; 250 MB is an upload-session practicality cap. Per-request server cap (25 MB/file) untouched since files travel one by one. |
| Rendered pages per batch (PDF→JPG/PNG) | 200 | 200 | 200 | 200 | 150 DPI dense page ≈ 1 MB JPEG → ~200 MB worst-case browser-held output; ~100–400 s of server rasterisation spread across short requests, each far below the 120 s request timeout. |
| Extracted images per batch | 400 | 400 | 400 | 400 | 2× the new per-file server cap (200), bounding in-memory artifacts. |
| Result bytes per batch | 200 MB | 200 MB | 200 MB | 200 MB | All outputs are held in browser RAM while the batch ZIP is assembled; 200 MB keeps mobile browsers (killed well before desktop limits) safe. |
| Concurrent jobs per batch | 1 | 1 | 1 | 1 | Sequential dispatch adds no server concurrency pressure and stays under the 60 req/min IP rate limit with pacing. |
| Request timeout | 120 s unchanged | — | — | — | Each file is one request; the existing hardening timeout applies as-is. |

### Known limitations
- **Budget overshoot of one file**: budgets are checked *between* files, so the file that crosses a page/output/image budget still completes. Overshoot is bounded by one file's output, which the server already caps per file (≤50 pages, ≤6 MB/image, ≤200 images). Worst case equals two adversarial single-file jobs run back-to-back, which is possible today via manual use.
- **Bulk office conversions are NOT offered**: Word→PDF, Excel→PDF and PowerPoint→PDF have no single-file engines (COMING_SOON; require LibreOffice/headless browser). The bulk landing page states this explicitly.
- **Quota display cadence**: the bulk UI refreshes `GET /api/usage` on mount, every 5 settled files and at batch end — not per file — to stay under the shared per-IP rate limit. The server remains the source of truth and stops the batch with `QUOTA_EXCEEDED` regardless of what the UI shows.
- **Retry-After is delay-seconds only (Phase 62)**: the rate limiter now sends a real `Retry-After` (remaining window seconds, clamped 1–60 s) and the runner honors it, falling back to 60 s when absent. HTTP-date `Retry-After` forms are deliberately not interpreted (the limiter never sends them; guessing a timezone-correct delay would be fake precision).
- **Anonymous bucket is shared**: unauthenticated visitors share the `anon` usage bucket per deployment instance (pre-existing Phase 43 behavior); a large anonymous batch may therefore find the quota already consumed.
- **Extract Images is raster-only**: it extracts embedded raster XObjects (JPEG/PNG/Flate); vector graphics and images drawn as page content are not reconstructed. Pre-existing behavior, unchanged.
- **Page-budget enforcement is reactive for raster ops**: page counts come from the server's `X-PDFKit-Pages` response header, so a batch learns a file's page count only after that file is processed (no per-file pre-inspection requests are made, by design, to halve request volume).

---

## 6. Phase 62 Additions & Notes

### New mitigations (previously open gaps)
- **429 backoff was coarse** — resolved: the limiter returns its real remaining window and the runner waits exactly that (clamped ≤120 s client-side), else 60 s; retry budgets (2×/file) still prevent storms.
- **ZIP entry explosion** — resolved defense-in-depth: archive results are capped at 2,000 entries each and batches at 25,000 total entries.
- **CSV formula injection** — resolved: cells beginning with `=`, `+`, `-` or `@` are prefixed with `'` (metadata-only CSV; never document contents).
- **Non-Latin filenames degraded** — resolved: the entry sanitizer (client and server twins) now preserves Unicode letters/numbers/marks; CJK/Cyrillic/Greek names no longer become underscores. Path separators, control characters and traversal remain blocked.
- **Budget-stop labelling inconsistency** — resolved: files after a budget stop are labelled `skipped-budget` (matching the first violator) instead of `cancelled`, so summary counts are honest.
- **Bulk invisible to search** — resolved: `searchBulkOperations` answers bulk/batch/multiple-files phrasing; the tool catalog itself is untouched.

### Known limitations (accepted, documented)
- **Budget overshoot of one file** (unchanged from Phase 61): budgets are checked between files; the crossing file completes. Bounded by per-file server caps.
- **Intra-file progress is unknowable**: progress is batch-level only ("file 3 of 10"). The server cannot report rasterisation progress, so none is invented.
- **Offline detection is `navigator.onLine`**: coarse (a captive portal can read "online"). The runner pauses and resumes; it never burns through failures while offline.
- **`batchId` is correlation-only**: strictly validated server-side and attached to logs; it must never be used for authorization, quota or security decisions (enforced by design).
- **Rate limiter `Retry-After` is per-IP**: a batch shares the IP bucket with the caller's other tabs/tools; the header reflects the shared bucket, not the batch alone.
- **Limit review is a mechanism, not a raise**: `docs/bulk-limit-review.md` documents thresholds; no limits changed in Phase 62.

---

## 7. Phase 63 Additions & Notes

### New infrastructure (previously missing)
- **No metrics/aggregation existed** — resolved: bounded provider-neutral metrics layer + fail-closed `/api/admin/metrics` (see `docs/production-observability.md`).
- **No readiness probe existed** — resolved: `GET /api/health/ready` (DB/Redis/registry; `ok`/`degraded`/`unavailable`).
- **No request correlation id existed** — resolved: `x-pdfkit-request-id` on every processing response, attached to timeout/job telemetry.
- **Batch lifecycle invisible server-side** — resolved: validated client beacons (`POST /api/bulk/telemetry`) for batch start/complete/cancel/budget/quota stops.

### Known limitations (accepted, documented)
- **Bundled Prisma client is a no-op stub in dev/CI** (`scripts/generate-prisma-client.js`, pre-existing): `pingDatabase` probes with an always-empty unique lookup, so a real round trip requires a production-generated client. Readiness reports `unconfigured` (honest) until `DATABASE_URL` + real `prisma generate` exist.
- **In-memory metrics are per-process and reset on restart**: multi-instance deployments need a shared provider (interface ready; not implemented). Redis-backed rate limiting already shares state; metrics do not yet.
- **Readiness cache is 5 s per instance**: a dependency failing between probes is invisible for ≤5 s. Deliberate: probes must stay cheap.
- **Admin metrics has no human auth model**: token-only (no admin role exists in the account model). An operator SSO/admin role is future work; the endpoint fails closed meanwhile.
- **Beacons are best-effort**: fire-and-forget from the browser; a lost beacon (offline, ad-blocker) undercounts batch completions. Per-file server-side correlation (`batchId` on job logs) remains the source of truth.
- **Load tests are in-process**: no network/TLS/PostgreSQL/Redis; they prove correctness under concurrency, not production capacity (`docs/load-validation-results.md` states this explicitly).
