# Launch Metrics (privacy-safe)

**Phase 66.** Launch observability uses the EXISTING operational telemetry (`/api/admin/metrics`, token-gated) — no new analytics, no user tracking. The snapshot contains aggregates only: no document contents, no file names, no raw IPs, no identities (staging-verified by payload scans).

## Where the numbers come from

- `GET /api/admin/metrics` (Bearer `PDFKIT_ADMIN_METRICS_TOKEN`) → `TelemetrySnapshot` (schema v1)
- Fields referenced below: `traffic.requestsPerMinute/requestsTotal`, `jobs.{started,completed,failed,successRate,duration}`, `bulk.*`, `errors.{byTool,byCode,byCategory}`, `statuses.{ok2xx,err4xx,count429,count503,count504}`, `bytes.{inputTotal,outputTotal}`, `quota.{rejectionsByTier,rejectionsTotal}`, `system.{activeJobs,rssBytes,heapUsedBytes,nodeVersion}`

## The launch dashboard (daily review, per environment)

| Question | Metric | Healthy launch band (first weeks) |
| --- | --- | --- |
| Is anyone using it? | `jobs.started`/day, unique-ish `traffic.requestsTotal`/day | trending; no fixed target |
| Are jobs succeeding? | `jobs.successRate` | ≥ 97%; alarm < 90% |
| What is failing? | `errors.byTool`, `errors.byCode` | no single tool dominating |
| Are limits working? | `statuses.count429`/day, `quota.rejectionsByTier` | nonzero but small; a spike = abuse or a config regression |
| Is the platform healthy? | `statuses.count503`, `statuses.count504` | ~0; any sustained 503 = Redis/fail-closed path |
| Is it fast enough? | `jobs.duration` avg + p95 | p95 well under the 120 s ceiling; stable |
| Bulk health | `bulk.batchesCompleted` vs `batchesStarted`, `filesFailed` | completion ratio ≥ 95% |
| Memory safety | `system.rssBytes` (both instances), `activeJobs` | stable sawtooth; `activeJobs` ≤ 2×instances |
| Quota pressure by tier | `quota.rejectionsByTier` | free/anon rejections expected; pro rejections = investigate |
| Volume vs capacity | `bytes.inputTotal`/day | watch against daily aggregate limits |

## Alerting suggestions (wire to the metrics scrape, thresholds are starting points)

1. `successRate < 0.90` over 15 min
2. `count503 > 0` sustained 5 min (fail-closed path engaged)
3. `count504` climbing (timeout ceiling)
4. `jobs.started` flat for 30 min during expected traffic (whole-app outage)
5. `rssBytes` beyond 2× the post-deploy baseline
6. `/api/health/ready` non-200 (readiness probe)

## Reporting cadence

- Daily: dashboard review during launch week.
- Weekly: trend review (jobs/day by tool, bulk usage, quota rejections by tier).
- The snapshot's `environment` label distinguishes staging vs production.

## Privacy guarantees (why this is enough)

Every number above is an aggregate counter. The snapshot has been scanned in staging for secrets, identities, IPs and file names — none present by construction (provider-neutral telemetry model + tests). This is deliberate: launch observability does not require knowing WHO processed WHAT — only that the service works.
