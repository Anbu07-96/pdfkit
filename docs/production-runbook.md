# Production Runbook

**Phase 66.** Concise, operational responses. Assume the deployment is: two Next.js instances behind a reverse proxy, PostgreSQL, Redis, admin metrics at `/api/admin/metrics` (Bearer token), readiness at `/api/health/ready`.

## First checks (any incident)

```bash
curl -fsS $SITE_URL/api/health/ready      # overall + db/redis/processing
curl -fsS -H "Authorization: Bearer $ADMIN_TOKEN" $SITE_URL/api/admin/metrics
```

The metrics snapshot (`traffic`, `jobs`, `errors`, `statuses`, `system`) tells you which pattern below you are in.

## Database unavailable

- Symptom: readiness `database=failed`; 5xx on authenticated routes.
- App behavior: quota/identity reads fail; the identity resolver falls back to session defaults — **quota enforcement refuses jobs** rather than metering blindly.
- Response: check the DB provider status → restore per `database-backup-recovery.md` §7 → redeploy if `DATABASE_URL` changed.

## Redis unavailable

- Symptom: readiness `redis=failed`.
- App behavior: **fails closed** by design (`PDFKIT_REDIS_REQUIRED=true`) — processing routes refuse traffic instead of running unprotected.
- Response: provision/restore Redis (no data restore needed — only TTL-scoped counters), confirm readiness flips to ok. If Redis is permanently lost, a fresh empty instance is sufficient.

## High 429 rate (`statuses.count429` climbing)

- Meaning: rate limiter working. Distinguish one abusive client (expected) from a config regression.
- Check: is legitimate traffic affected? `traffic.requestsPerMinute` vs `count429`.
- If a single client: it is already throttled; optionally block at the edge/proxy.
- If global: verify `PDFKIT_RATE_LIMIT_PER_MINUTE` was not lowered (60 is the launch value).

## High 503 rate

- `503` = Redis required but unavailable, or processing disabled. Follow the Redis path first; then check `/api/health/ready` `processing` field.

## High 504 rate

- Timeouts (120 s ceiling). Usually huge/slow PDFs or an upstream stall.
- Check `jobs.duration` in metrics (avg/p95) and `errors.byTool` for a hot tool.
- Mitigate at the edge if a specific abusive pattern; do not raise request timeouts without a phase of analysis.

## PDF processing failure spike (`jobs.failed` climbing)

- Check `errors.byTool` + `errors.byCode` — one tool vs all tools.
- One tool: consider disabling its route (deploy config) while investigating; keep others up.
- All tools: suspect a bad deployment (see rollback) — the processors share validation plumbing.
- Never log user documents; reproduce with synthetic fixtures.

## Authentication failure spike

- Check instance logs for `authorize` rejections (no PII in lines — counts/classes only).
- Confirm `NEXTAUTH_SECRET` matches on BOTH instances (a mismatch causes silent session invalidation across the round-robin).
- Lockout storms (`failed-login`) from one range = credential stuffing; the lockout already throttles it. Edge-block if sustained.

## Billing webhook failure

- Symptom: entitlements not updating after successful payments (user paid, tier not Pro).
- Check: instance logs for `[billing]` lines; provider dashboard for webhook delivery failures.
- Razorpay retries webhooks; idempotency makes re-delivery safe.
- If the webhook secret was rotated: update `RAZORPAY_WEBHOOK_SECRET`, redeploy, and re-trigger delivery from the dashboard.
- Manual fix of last resort: set the account tier via a controlled DB update (document who/why) — the DB is the entitlement source of truth.

## Email failure

- Symptom: verification/reset mail not arriving; reset endpoint returns 503 in production when SMTP is unconfigured.
- Check `SMTP_*` env (names only), provider status; password reset fails CLOSED by design — users see "temporarily unavailable".
- Verification is non-blocking for sign-in; a backlog of unverified accounts is acceptable during the outage.

## Bad deployment / rollback

- Roll back the APPLICATION build (previous container/image), **not the schema** — migrations are forward-only.
- Steps: deploy the previously known-good image → verify `/api/health/ready` → watch `errors`/`jobs` for 15 minutes.
- If a migration was part of the bad deploy and is incompatible with the old build: prefer fixing forward (new build) over schema surgery; involve the DBA path in `database-backup-recovery.md`.

## Secret leakage suspicion

1. Rotate the affected secret per `production-secrets-checklist.md` (rotation notes) — sessions may be invalidated (acceptable).
2. For `NEXTAUTH_SECRET`: all users re-authenticate.
3. For Razorpay keys: rotate in the dashboard, update env, redeploy.
4. Check admin metrics for anomalies during the exposure window; review instance logs for the secret's NAME (values are never logged — if a value appears anywhere, treat the logger as compromised too and fix it).
5. Record the incident and the rotation times.

## Unexpected resource usage / disk pressure

- The app writes no document data to disk (in-memory processing). Disk growth beyond logs/builds is anomalous.
- Memory: check `system.rssBytes`/`system.heapUsedBytes` in metrics; `MAX_CONCURRENT_JOBS=2` per instance bounds processing memory.
- If `/tmp` fills: identify the writer (should be nothing of ours — staging audits verify zero temp files per job).
- Reduce `PDFKIT_MAX_CONCURRENT_JOBS` only as a last resort — it is a launch value; changing it is a capacity decision, not an incident fix.

## Incident template

```
Time (UTC): …
Detection: (metrics alert / user report / …)
Impact: (users affected, features degraded)
Root cause: …
Actions: (ordered, with times)
Resolution + verification: (readiness checks green, error rates baseline)
Follow-ups: (tickets, monitoring gaps)
```
