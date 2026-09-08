import "server-only";

import { pingDatabase } from "@/lib/usage/repository";
import { pingRedis } from "@/lib/hardening/distributed-protection";
import { getImplementedToolIds } from "@/lib/processing/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/health/ready` — readiness probe (Phase 63, Step 6).
 *
 * Distinct from `/api/health` (liveness: is the process alive — always cheap,
 * never touches dependencies). Readiness answers: can this instance actually
 * process jobs right now?
 *
 * Checks:
 * - `database`: PostgreSQL ping when `DATABASE_URL` is configured.
 *   "unconfigured" is reported (not "failed") because the in-memory usage
 *   repository is a supported mode for dev/single-instance deployments.
 * - `redis`: Redis ping when `PDFKIT_REDIS_URL`/`REDIS_URL` is configured;
 *   same honesty about "unconfigured".
 * - `processing`: the tool registry resolves processors (cheap, in-process).
 *
 * Verdict: 200 `ok` (or `degraded` when optional dependencies are
 * unconfigured but the instance can still process), 503 `unavailable` when a
 * *configured* dependency is failing.
 *
 * Results are cached for 5 seconds so probes stay cheap under scraping.
 * The payload never includes secrets, connection strings or IPs — only check
 * names, statuses and latency milliseconds.
 */

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
} as const;

const CACHE_TTL_MS = 5_000;

interface CheckResult {
  status: "ok" | "failed" | "unconfigured";
  latencyMs?: number;
}

interface ReadinessResult {
  status: "ok" | "degraded" | "unavailable";
  timestamp: string;
  uptimeSeconds: number;
  checks: {
    database: CheckResult;
    redis: CheckResult;
    processing: CheckResult;
  };
}

const processStartTime = Date.now();
let cached: { at: number; result: ReadinessResult } | null = null;

async function runChecks(): Promise<ReadinessResult> {
  const [database, redis] = await Promise.all([pingDatabase(), pingRedis()]);

  let processing: CheckResult;
  try {
    processing = { status: getImplementedToolIds().length > 0 ? "ok" : "failed" };
  } catch {
    processing = { status: "failed" };
  }

  const databaseCheck: CheckResult =
    database.status === "ok"
      ? { status: "ok", latencyMs: database.latencyMs }
      : { status: database.status };
  const redisCheck: CheckResult =
    redis.status === "ok" ? { status: "ok", latencyMs: redis.latencyMs } : { status: redis.status };

  // A configured dependency failing makes the instance not ready. Optional
  // dependencies that are simply not configured only degrade the verdict.
  const anyFailed =
    databaseCheck.status === "failed" ||
    redisCheck.status === "failed" ||
    processing.status === "failed";
  const anyUnconfigured =
    databaseCheck.status === "unconfigured" || redisCheck.status === "unconfigured";

  return {
    status: anyFailed ? "unavailable" : anyUnconfigured ? "degraded" : "ok",
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor((Date.now() - processStartTime) / 1000),
    checks: { database: databaseCheck, redis: redisCheck, processing },
  };
}

/** Test hook: drop the cached readiness result. */
export function resetReadinessCacheForTests(): void {
  cached = null;
}

export async function GET(): Promise<Response> {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_TTL_MS) {
    return Response.json(cached.result, { status: statusFor(cached.result), headers: JSON_HEADERS });
  }

  const result = await runChecks();
  cached = { at: now, result };
  return Response.json(result, { status: statusFor(result), headers: JSON_HEADERS });
}

function statusFor(result: ReadinessResult): number {
  return result.status === "unavailable" ? 503 : 200;
}

export function POST(): Response {
  return Response.json(
    { error: { code: "VALIDATION_ERROR", message: "Use GET." } },
    { status: 405, headers: JSON_HEADERS, },
  );
}
