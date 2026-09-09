# Database Backup & Recovery Plan

**Phase 66.** This is a plan, not a claim: **no backups are currently configured** — the staging stack runs a local PostgreSQL cluster for validation only. The production operator must implement and TEST the backup schedule below before launch.

## 1. What PostgreSQL contains

| Table | Contents | Loss impact |
| --- | --- | --- |
| `UserAccount` | email (unique), scrypt password hashes, verification tokens, tier/status, Razorpay customer/subscription ids, reset-token hashes, `passwordResetAt` | **critical** — accounts, entitlements and paid subscriptions |
| `DailyUsage` | per-user daily job/byte counters (rolling) | moderate — quota state resets to zero (users get a fresh allowance; overage risk for one day) |
| `RazorpayWebhookEvent` | processed webhook event ids | moderate — protects idempotency; losing it can replay events (all handlers are idempotent by design, so effects are safe) |
| `_prisma_migrations` | migration history | low — re-derivable from the repository |

No document data is stored — files are processed in memory and never persisted (architecture guarantee, staging-verified).

## 2. What must be backed up

- The **database** (all tables above) — nothing else holds durable state.
- The **environment secret set** (see `production-secrets-checklist.md`) — stored in the deployment platform's secret manager, not in PostgreSQL.

## 3. Recommended backup frequency

- **Automated daily full backups** (e.g. `pg_dump -Fc` via the managed provider's snapshots, or platform-native PITR).
- **Point-in-time recovery (PITR)** if the provider supports it (recommended for billing data).
- Retention: at least 7 daily + 4 weekly + 3 monthly.

## 4. Restore validation (must be exercised before launch and quarterly)

1. Restore the latest backup to a scratch database.
2. Run `npx prisma migrate deploy` against it — expect **zero pending migrations** (history consistent).
3. Start the app against the scratch DB; verify: a user can sign in, `/api/usage` returns their tier + counters, admin metrics report `status=ok`.
4. Measure RTO (restore + verify time) and record it in the runbook.

## 5. Migration compatibility

- Migrations are forward-only; the schema is validated by `npx prisma validate` in CI.
- After restoring an older backup, run `npx prisma migrate deploy` to bring it to HEAD before pointing traffic at it.
- Downgrades are NOT supported — roll back the application build, not the schema (see the runbook).

## 6. What Redis contains (and why it is NOT primary state)

Redis holds **ephemeral protection state only**: per-minute rate-limit counters, concurrency slots, and admin-metrics scopes — all with second-to-minute TTLs. It deliberately holds **no account, entitlement or usage data**:

- If Redis is flushed or lost: rate-limit windows reset (one minute of slightly elevated request rates) and concurrency counters rebuild. Nothing user-visible is lost.
- If Redis is unavailable: with `PDFKIT_REDIS_REQUIRED=true` the app **fails closed** (refuses requests) rather than running unprotected — that is a deliberate availability trade-off, documented and staged-verified.

**Recovery for Redis = restart/provision a fresh instance; no restore is needed or meaningful.**

## 7. Recovery steps (database)

1. Declare the incident (see `production-runbook.md`).
2. Provision a fresh PostgreSQL instance if the primary is unhealthy.
3. Restore the most recent validated backup (§4 procedure).
4. Apply `npx prisma migrate deploy`.
5. Update `DATABASE_URL`, redeploy/restart both app instances.
6. Verify readiness (`/api/health/ready` → `status=ok`), sign-in, and quota checks.
7. Post-incident: capture RPO/RTO actuals and any data-loss window (e.g. daily-usage counters since the last backup).
