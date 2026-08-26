# PDFKit — Known Issues, Verification & Development Notes

## 1. Authentication & Session Validation Issues
1. **Credentials Provider Negative Validation**:
   - The current NextAuth credentials provider in `src/lib/auth/config.ts` requires comprehensive negative test coverage.
   - *Observed Issue*: Submitting an invalid email/password combination during local testing was observed to potentially issue a valid session token rather than rejecting authentication.
   - *Fix Requirement*: `authorize()` in `src/lib/auth/config.ts` must strictly validate emails and passwords against stored hashes/records and explicitly return `null` for invalid credentials.
2. **Mandatory Login Rejection Checks**:
   - Invalid or malformed email format.
   - Missing password field.
   - Incorrect password for an existing account.
   - Unknown/unregistered email credentials.
3. **Session Lifecycle Testing Needed**:
   - Fresh unauthenticated visitor state (`ANONYMOUS_USER_IDENTITY`).
   - Active user sign-in and cookie persistence.
   - User sign-out and session revocation.
   - Sign back in after sign-out.
   - Protected route guards (`/account`).

---

## 2. Production Service Configuration Verification Requirements
Before exposing PDFKit to real production traffic, the following infrastructure items must be configured and verified:

1. **Stripe Production Billing Verification**:
   - `STRIPE_SECRET_KEY` and `STRIPE_PRO_PRICE_ID` must be configured with production values.
   - `STRIPE_WEBHOOK_SECRET` must be set up in the Stripe Dashboard for `https://<domain>/api/billing/webhook`.
   - Webhook signature verification and live subscription lifecycle events (`checkout.session.completed`, `customer.subscription.deleted`) must be tested against live Stripe test/production environments.

2. **Redis Distributed Protection Verification**:
   - `PDFKIT_REDIS_URL` or `REDIS_URL` must connect to a production Redis cluster.
   - Distributed concurrency lock TTLs and rate limit IP hashing (SHA-256 with daily salt) must be verified under multi-instance deployments.

3. **Database Migration & Deployment**:
   - PostgreSQL database must be provisioned and `DATABASE_URL` set.
   - Prisma migrations (`npx prisma migrate deploy`) must be run to create `UserAccount`, `DailyUsage`, and `StripeWebhookEvent` tables.

4. **Sentry Monitoring Verification**:
   - `SENTRY_DSN` must be configured to capture server-side processing exceptions while verifying PII sanitization.

---

## 3. Tool Catalog & Planned Extensions

1. **Implemented vs. Coming Soon Tools**:
   - Catalog contains **29 AVAILABLE tools** and **18 COMING_SOON tools**.
   - `pdf-to-grayscale` was reported BLOCKED because `pdf-lib` cannot rewrite vector content stream color spaces without rasterization or external Ghostscript bindings.

2. **Planned / Requested Document Conversions**:
   - Bulk PDF → Word (`.docx`)
   - Word (`.docx`) → PDF
   - PDF → Excel (`.xlsx`)
   - Excel (`.xlsx`) → PDF
   - PowerPoint (`.pptx`) → PDF
   - Other document intelligence workflows (OCR, AI summarization).

*Note: None of the planned conversion tools listed above should be marked AVAILABLE in `catalog.ts` until an exact, production-ready server processor is implemented and tested.*
