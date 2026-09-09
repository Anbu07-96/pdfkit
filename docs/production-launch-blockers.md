# Production Launch Blockers

**Phase 66 · 2026-09-09.** The GO/NO-GO matrix for public production launch (Phase 67). Every item states its classification and what would move it to PASS.

Legend: **PASS** (verified) · **FAIL** (broken, must fix) · **BLOCKED** (external dependency) · **OWNER ACTION REQUIRED** (repository owner must act) · **PRODUCTION VALIDATION REQUIRED** (can only be proven in production)

## Matrix

| Area | Item | Status | Detail / what moves it to PASS |
| --- | --- | --- | --- |
| CI | Workflow runs on GitHub | **BLOCKED** | Push of `.github/workflows/ci.yml` rejected (token lacks `workflows` permission). Patch preserved at `docs/phase65-ci-workflow-patch.diff`. Owner must push it; then verify a green run. |
| CI | All gates green locally (the CI steps) | **PASS** | 1692 unit tests, lint 0 errors, tsc clean, build clean, prisma validate — the exact commands CI runs. |
| Database | PostgreSQL works, migrations consistent | **PASS** | Real PG 16 in staging; 4 migrations applied; schema verified; 19/19 PG integration tests; restart idempotency verified. |
| Database | Backups configured + restore tested | **OWNER ACTION REQUIRED** | No backups exist yet (staging only). Implement + test per `docs/database-backup-recovery.md` §3–4 on the production database. |
| Redis | Distributed rate limiting / concurrency / fail-closed | **PASS** | 66/66 staging checks, 21/21 multi-instance harness checks, Redis outage → 503 fail-closed verified. |
| Redis | Recovery expectation documented | **PASS** | Redis holds only TTL-scoped protection state; fresh instance = full recovery (`database-backup-recovery.md` §6). |
| Domain | Final domain chosen + DNS | **OWNER ACTION REQUIRED** | No domain configured; every callback/URL/secrets doc uses a placeholder. |
| TLS | HTTPS at the edge, HSTS, Secure cookies | **PRODUCTION VALIDATION REQUIRED** | Local staging correctly omits Secure/HSTS on plain HTTP (documented). Verify at the edge after DNS + TLS termination; add HSTS there. |
| OAuth | Google sign-in | **BLOCKED** | Implemented, env-conditional; never executed with real credentials. Owner: create credentials, set callback `https://<domain>/api/auth/callback/google`, run the 7-step checklist in `docs/oauth-production-setup.md`. |
| OAuth | Microsoft sign-in | **BLOCKED** | Same, callback `https://<domain>/api/auth/callback/azure-ad`. |
| Auth | Credentials auth (hash, lockout, reset, sessions) | **PASS** | Staging-verified + 60+ new automated tests; browser E2E covers register/login/reset/session-invalidation. |
| Email | Transactional email delivery | **OWNER ACTION REQUIRED** | SMTP transport implemented + fail-closed without config; never delivered through a real provider. Owner: choose provider, set `SMTP_*`, publish SPF/DKIM/DMARC, run `docs/email-production-setup.md` §5 checklist. |
| Billing | Architecture, modes, entitlement enforcement | **PASS** | DB is the entitlement source of truth; disabled/test/live modes with fail-closed live gate; ownership-bound payment verification; idempotent webhooks — all automated-tested. |
| Billing | TEST-mode end-to-end checkout | **BLOCKED** | No Razorpay TEST credentials in this environment. Owner: create a Razorpay test account, set `RAZORPAY_*` test values, run the §“test-mode E2E” flow (upgrade → Pro → cancel → Free). |
| Billing | Price IDs configured (Razorpay plan ₹499) | **OWNER ACTION REQUIRED** | `RAZORPAY_PRO_PLAN_ID` unset; plan exists only in the catalog. Owner: create the plan in the Razorpay dashboard and set the id. |
| Billing | Webhook endpoint reachable + secret set | **OWNER ACTION REQUIRED** | Handler is signature-verified and idempotent (tested); needs the production URL registered in Razorpay + `RAZORPAY_WEBHOOK_SECRET`. |
| Billing | LIVE billing | **OWNER ACTION REQUIRED / DELIBERATELY OFF** | Requires live keys AND `PDFKIT_BILLING_ALLOW_LIVE=true` (two-key fail-closed). Must remain NO until Phase 67+ decides. |
| Legal | Privacy page truthful | **PASS** | Rewritten Phase 66 to match actual behavior (in-memory processing, scrypt, cookies, Razorpay, no tracking). Owner placeholders marked inline. |
| Legal | Terms of service | **PASS** (with placeholders) | Owner placeholders for legal entity/jurisdiction; lawyer review recommended (marked inline). |
| Legal | Refund policy | **PASS** (with placeholders) | Matches actual cancellation semantics; accountant/lawyer review marked. |
| Legal | Security page | **PASS** | Only implemented protections stated; no certification claims. |
| Support | Contact/support page + mailbox | **OWNER ACTION REQUIRED** | Page exists; `NEXT_PUBLIC_CONTACT_EMAIL` unset — owner must provision a monitored mailbox and set it. |
| Secrets | Production secret set + validation | **OWNER ACTION REQUIRED** | `npm run validate:production` enforces names/shapes; owner must provision real values per `docs/production-secrets-checklist.md`. |
| Monitoring | Admin metrics + launch dashboard | **PASS** | Token-gated metrics verified in staging (401 fail-closed, no PII); dashboard + alerts defined in `docs/launch-metrics.md`. |
| Ops | Incident runbook + rollback plan | **PASS** | `docs/production-runbook.md` covers DB/Redis/429/503/504/billing/email/rollback/secrets/disk. Rollback = app-build rollback, forward-only schema. |
| Security | Security headers | **PASS** | nosniff / DENY / referrer / CSP / permissions-policy — staging-verified. |
| Security | Production cookies | **PASS** (design) / **PRODUCTION VALIDATION REQUIRED** | HttpOnly + SameSite=Lax verified; Secure attribute must be confirmed behind TLS. |
| Limits | Rate limits (60/min global, no per-instance multiplication) | **PASS** | Staging + multi-instance verified; values unchanged. |
| Limits | Quota enforcement server-side (no client trust) | **PASS** | DB-backed tier on every request; escalation tests prove client values cannot grant Pro/Business. |
| QA | Browser E2E suite | **PASS** | 22/22 incl. billing-disabled UX, password reset, legal pages, mobile layouts. |
| QA | Mobile QA | **PASS** | 390×844 pricing/account/bulk flows without horizontal scroll. |

## GO / NO-GO summary

- **Application code: GO** — no known FAIL items; all behavior verified in staging/automation.
- **Public production launch: NO-GO during Phase 66** (by explicit instruction) — and NO-GO afterward until every **OWNER ACTION REQUIRED / BLOCKED** item above is resolved:
  1. Push the CI workflow (needs `workflows` permission).
  2. Choose the domain; configure DNS + TLS; set `NEXTAUTH_URL`/`NEXT_PUBLIC_SITE_URL`.
  3. Provision production secrets (Postgres, Redis, NextAuth, admin token) — run `npm run validate:production`.
  4. Set up + verify Google and Microsoft OAuth (real credentials, both checklists).
  5. Set up an SMTP provider + sender-domain DNS (SPF/DKIM/DMARC) and verify delivery.
  6. Create the Razorpay ₹499 plan + webhook in TEST mode; run the test-mode E2E; only then decide live billing (two-key gate stays).
  7. Configure + restore-test backups; wire the launch-metrics dashboard.
  8. Fill the owner placeholders on the legal pages and publish the support mailbox.
