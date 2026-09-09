# Production Secrets Checklist

**Phase 66.** Variable NAMES only — no values are ever committed. `.env.example` contains names and placeholders only; `.env*` files are git-ignored.

## Required (launch-blocking — validated by `npm run validate:production`)

| Variable | Purpose | Notes |
| --- | --- | --- |
| `NEXTAUTH_URL` | public origin; OAuth callbacks, redirects | `https://<final-domain>` |
| `NEXTAUTH_SECRET` (or `AUTH_SECRET`) | JWT session signing | ≥32 random bytes; dev default is REJECTED by the validator |
| `DATABASE_URL` | PostgreSQL connection | `postgresql://…` |
| `PDFKIT_REDIS_URL` | distributed rate limiting / concurrency | `redis://…` or `rediss://…` |
| `PDFKIT_REDIS_REQUIRED` | must be `true` (fail-closed) | otherwise protections drop when Redis is down |
| `PDFKIT_ADMIN_METRICS_TOKEN` | admin metrics auth | ≥32 random bytes; constant-time compared |

## Required for the related feature to launch (owner actions)

| Variable | Feature | Notes |
| --- | --- | --- |
| `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET` + `RAZORPAY_PRO_PLAN_ID` | billing | `rzp_test_…` → test mode; `rzp_live_…` + `PDFKIT_BILLING_ALLOW_LIVE=true` → live |
| `RAZORPAY_WEBHOOK_SECRET` | billing entitlement sync | webhook signature verification |
| `PDFKIT_BILLING_ALLOW_LIVE` | live billing arm switch | unset/`false` = live keys stay disabled (fail-closed) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | verification + password-reset email | without SMTP_HOST production reset fails closed |
| `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` | Google OAuth | both together |
| `AZURE_AD_CLIENT_ID` + `AZURE_AD_CLIENT_SECRET` (+ `AZURE_AD_TENANT_ID`) | Microsoft OAuth | both together |
| `NEXT_PUBLIC_SITE_URL` | canonical URLs, email links | public value, not a secret |
| `NEXT_PUBLIC_CONTACT_EMAIL` | support address on public pages | public value; owner must provision a mailbox |

## Optional / deployment-specific

| Variable | Purpose |
| --- | --- |
| `PDFKIT_ENVIRONMENT` | metrics label (`production`) |
| `PDFKIT_QUOTA_*` | quota overrides (defaults are the launch values; leave unset) |
| `PDFKIT_RATE_LIMIT_PER_MINUTE`, `PDFKIT_MAX_CONCURRENT_JOBS` | limiter/concurrency knobs (defaults are the launch values) |
| `PDFKIT_CLIENT_IP_HEADERS` | client-IP trust override (default: last XFF only — do not widen) |
| `PDFKIT_USE_IN_MEMORY_USAGE_REPO` | must never be `true` in production (validator rejects) |

## Rotation procedures (high level)

- **`NEXTAUTH_SECRET`** — rotating invalidates all sessions (users must sign in again). Rotate on suspicion; schedule during low traffic.
- **`PDFKIT_ADMIN_METRICS_TOKEN`** — rotate freely; only monitoring consumers notice.
- **`RAZORPAY_KEY_SECRET` / webhook secret** — rotate in the Razorpay dashboard, update env, redeploy both instances; webhook verification is stateless, so no data migration. Keep old + new secrets overlapping during the deploy window if the provider allows multiple webhook secrets.
- **`SMTP_PASS`** — rotate at the provider; no state in the app.
- **OAuth client secrets** — rotate in the provider console, update env, redeploy; active sessions survive (JWT), new consent flows use the new secret.
- **`DATABASE_URL` / `PDFKIT_REDIS_URL`** — rotating credentials at the provider requires updating env and restarting both app instances.

Never log secret values; the validator and all application logs print variable NAMES only.
