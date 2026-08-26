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
