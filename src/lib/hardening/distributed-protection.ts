import "server-only";

import { createHash } from "node:crypto";
import Redis from "ioredis";
import { jsonError } from "@/lib/processing/http";
import {
  releaseJobSlot as localReleaseJobSlot,
  tryAcquireJobSlot as localTryAcquireJobSlot,
} from "@/lib/hardening/guards";
import { recordTelemetryEvent } from "@/lib/monitoring/telemetry";

/**
 * Distributed Concurrency & Rate-Limiting Protection (Phase 41/55).
 *
 * Provides shared protection state across multiple application instances
 * when Redis is configured (`PDFKIT_REDIS_URL` or `REDIS_URL`).
 *
 * Deterministic fallback to local in-memory protection when Redis is absent
 * (development, vitest, single-instance deployments).
 *
 * Privacy Guarantees:
 * - Client IP addresses are hashed with SHA-256 + daily salt and sliced to 16 chars.
 * - Raw IP addresses are NEVER logged, stored, or sent in headers.
 */

const SALT = new Date().toISOString().slice(0, 10); // Daily salt rotation

let redisClient: Redis | null = null;
let redisInitialized = false;

function getRedisClient(): Redis | null {
  if (redisInitialized) return redisClient;
  redisInitialized = true;

  const url = process.env.PDFKIT_REDIS_URL || process.env.REDIS_URL;
  if (!url) return null;

  try {
    const client = new Redis(url, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      lazyConnect: true,
      enableOfflineQueue: false,
    });

    client.on("error", (err) => {
      console.warn("[hardening] Redis connection error, using local fallback", err.message);
    });

    redisClient = client;
    return redisClient;
  } catch (err) {
    console.warn("[hardening] Redis initialization failed, using local fallback", err);
    return null;
  }
}

/**
 * Phase 64 fix (found by the real-Redis integration tests): with
 * lazyConnect + enableOfflineQueue:false, the FIRST command on a cold client
 * (fresh boot, reconnect) rejects immediately and silently falls back to
 * per-process protection — so the very first requests after a deploy could
 * bypass the global budget. Wait (bounded) for the connection instead; the
 * caller still falls back safely if Redis does not come up in time.
 */
async function ensureRedisReady(redis: Redis): Promise<void> {
  if (redis.status === "ready") return;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 1_000);
    const done = () => {
      clearTimeout(timeout);
      resolve();
    };
    redis.once("ready", done);
    if (redis.status === "wait" || redis.status === "close" || redis.status === "end") {
      redis.connect().catch(done);
    }
  });
}

/**
 * Phase 65 client-IP trust policy.
 *
 * Which request headers may identify the client is a DEPLOYMENT decision, not
 * a code default: `CF-Connecting-IP`/`X-Real-IP` are only meaningful when the
 * deployment actually sits behind Cloudflare/nginx AND the proxy strips
 * client-supplied copies. Blindly trusting them (the pre-Phase-65 behavior)
 * let any direct-to-app client rotate a fake header per request and bypass
 * the IP rate limit entirely.
 *
 * `PDFKIT_CLIENT_IP_HEADERS` configures the ordered list of trusted headers
 * (lower-case, comma-separated):
 *   - unset (default): `x-forwarded-for` — the standard header every managed
 *     proxy (Render/Railway/Fly/AWS LB/nginx/Cloudflare) appends to; the
 *     LAST entry is used because appending proxies add the real client IP at
 *     the end after any client-supplied prefix.
 *   - `cf-connecting-ip,x-forwarded-for`: behind Cloudflare.
 *   - `x-real-ip,x-forwarded-for`: behind an nginx that sets X-Real-IP and
 *     strips inbound copies.
 *   - `none`: no proxy in front — all clients share one fallback bucket
 *     (fail-closed: the rate limit becomes global, never per-attacker).
 */
const FALLBACK_CLIENT_IP = "127.0.0.1";

function readTrustedClientIpHeaders(): string[] {
  const raw = process.env.PDFKIT_CLIENT_IP_HEADERS;
  if (raw === undefined || raw === "") return ["x-forwarded-for"];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0 && s !== "none");
}

/** Compute an anonymized 16-character SHA-256 token for client rate limiting with proxy IP hardening. */
export function anonymizeClientIp(request: Request): string {
  let rawCandidate: string | null = null;

  for (const header of readTrustedClientIpHeaders()) {
    let value: string | null = null;
    if (header === "x-forwarded-for") {
      // Last entry: appended by the nearest trusted proxy — a client may
      // PREPEND anything it likes, the proxy-added tail wins.
      const forwarded = request.headers.get("x-forwarded-for") ?? "";
      const entries = forwarded
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      value = entries[entries.length - 1] ?? null;
    } else {
      value = request.headers.get(header)?.trim() || null;
    }
    if (value) {
      rawCandidate = value;
      break;
    }
  }

  if (!rawCandidate) rawCandidate = FALLBACK_CLIENT_IP;

  // Sanitize IP format to prevent header injection in keys
  const ip = /^[\d.a-fA-F:]+$/.test(rawCandidate) ? rawCandidate : FALLBACK_CLIENT_IP;

  return createHash("sha256").update(`${ip}:${SALT}`).digest("hex").slice(0, 16);
}

const ACQUIRE_LUA = `
local key = KEYS[1]
local maxJobs = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
local current = tonumber(redis.call('get', key) or '0')
if maxJobs > 0 and current >= maxJobs then
  return 0
end
redis.call('incr', key)
redis.call('expire', key, ttl)
return 1
`;

const RELEASE_LUA = `
local key = KEYS[1]
local current = tonumber(redis.call('get', key) or '0')
if current > 0 then
  redis.call('decr', key)
end
return 1
`;

const RATE_LIMIT_LUA = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
local current = redis.call('incr', key)
if current == 1 then
  redis.call('expire', key, ttl)
end
if current > limit then
  -- Return the window's remaining TTL so the caller can send an honest
  -- Retry-After header instead of guessing.
  local remaining = redis.call('ttl', key)
  if remaining < 1 then
    remaining = 1
  end
  return remaining
end
return -1
`;

const CONCURRENCY_KEY = "pdfkit:concurrency:active";
const DEFAULT_LEASE_TTL = 600; // 10 minutes auto-expiration for stale leases

/**
 * Phase 64: when `PDFKIT_REDIS_REQUIRED=true` the deployment declares that
 * Redis-backed protections (IP rate limit, global concurrency cap) MUST have
 * global state — e.g. multi-instance staging/production. If Redis is
 * unavailable in that mode, requests fail safely (503 / slot denied) instead
 * of silently downgrading to per-process protection, which would multiply
 * the effective limits by the instance count. Dev (unset/false) keeps the
 * documented per-process fallback.
 */
export function isRedisRequired(): boolean {
  return process.env.PDFKIT_REDIS_REQUIRED === "true";
}

/**
 * Try to acquire a concurrency slot across distributed instances.
 * Falls back to local in-memory guard if Redis is not configured or unavailable —
 * unless `PDFKIT_REDIS_REQUIRED=true`, in which case a Redis failure denies the
 * slot (fail-closed: the global cap cannot be verified).
 */
export async function tryAcquireDistributedSlot(
  maxConcurrentJobs: number,
  leaseTtlSeconds = DEFAULT_LEASE_TTL,
): Promise<boolean> {
  const redis = getRedisClient();
  if (!redis) {
    if (isRedisRequired()) {
      console.error(
        "[hardening] PDFKIT_REDIS_REQUIRED=true but Redis is not configured — denying job slot (fail-closed)",
      );
      return false;
    }
    return localTryAcquireJobSlot(maxConcurrentJobs);
  }

  try {
    await ensureRedisReady(redis);
    const result = await redis.eval(
      ACQUIRE_LUA,
      1,
      CONCURRENCY_KEY,
      maxConcurrentJobs,
      leaseTtlSeconds,
    );
    return Number(result) === 1;
  } catch (err) {
    if (isRedisRequired()) {
      console.error(
        "[hardening] PDFKIT_REDIS_REQUIRED=true and Redis acquire failed — denying job slot (fail-closed)",
        err instanceof Error ? err.message : err,
      );
      return false;
    }
    console.warn("[hardening] Distributed acquire failed, falling back to local guard", err);
    return localTryAcquireJobSlot(maxConcurrentJobs);
  }
}

/**
 * Release a concurrency slot across distributed instances.
 */
export async function releaseDistributedSlot(): Promise<void> {
  const redis = getRedisClient();
  if (!redis) {
    localReleaseJobSlot();
    return;
  }

  try {
    await ensureRedisReady(redis);
    await redis.eval(RELEASE_LUA, 1, CONCURRENCY_KEY);
  } catch (err) {
    console.warn("[hardening] Distributed release failed, falling back to local release", err);
    localReleaseJobSlot();
  }
}

/**
 * Redis health probe for the readiness endpoint (Phase 63).
 *
 * Returns "unconfigured" when no Redis URL is set (normal in dev/test and for
 * single-instance deployments), "ok" after a successful PING, or "failed".
 * Never throws, never leaks the connection string, and is bounded by a short
 * timeout so probes stay cheap.
 */
export async function pingRedis(): Promise<
  { status: "unconfigured" } | { status: "ok"; latencyMs: number } | { status: "failed" }
> {
  const redis = getRedisClient();
  if (!redis) return { status: "unconfigured" };

  try {
    const startedAt = Date.now();
    if (redis.status !== "ready") {
      await redis.connect().catch(() => {
        // Already connecting/connected or unreachable — fall through to PING,
        // which will surface the real state (or failure) below.
      });
    }
    await Promise.race([
      redis.ping(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("ping timeout")), 1_500).unref?.(),
      ),
    ]);
    return { status: "ok", latencyMs: Date.now() - startedAt };
  } catch {
    return { status: "failed" };
  }
}

// In-memory rate limiting map for fallback mode
const inMemoryRateLimits = new Map<string, { count: number; resetAt: number }>();

/**
 * Build the 429 response with an honest Retry-After header (Phase 62).
 *
 * `retryAfterMs` is the real remaining window when the limiter knows it
 * (both the Redis and the in-memory limiter use a fixed 60 s window that
 * starts with the first counted request, so the remaining time is exact);
 * when unknown, no header is invented — callers fall back to their own
 * conservative backoff.
 */
function rateLimitResponse(retryAfterMs?: number): Response {
  const headers: Record<string, string> = {};
  if (retryAfterMs !== undefined && Number.isFinite(retryAfterMs)) {
    const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
    headers["retry-after"] = String(Math.min(seconds, 60));
  }

  recordTelemetryEvent({
    type: "rate_limited",
    ...(headers["retry-after"]
      ? { retryAfterSeconds: Number(headers["retry-after"]) }
      : {}),
  });

  return jsonError(
    "TOO_MANY_REQUESTS",
    "Too many requests. Please wait a moment before trying again.",
    undefined,
    headers,
  );
}

/**
 * Check distributed IP rate limit.
 * Returns null if allowed, or HTTP 429 Response if rate limit exceeded.
 *
 * `scope` separates buckets that must not share the processing budget (e.g.
 * the bulk telemetry beacon). Undefined keeps the original shared key so
 * existing deployments see no change.
 */
export async function checkRateLimit(
  request: Request,
  rateLimitPerMinute: number,
  scope?: string,
): Promise<Response | null> {
  if (rateLimitPerMinute <= 0) return null;

  const clientToken = anonymizeClientIp(request);
  const scopedToken = scope ? `${scope}:${clientToken}` : clientToken;
  const redis = getRedisClient();

  if (redis) {
    try {
      await ensureRedisReady(redis);
      const key = `pdfkit:ratelimit:${scopedToken}`;
      // -1 = allowed; >= 1 = rejected, with the window's remaining TTL in
      // seconds (see RATE_LIMIT_LUA).
      const result = await redis.eval(
        RATE_LIMIT_LUA,
        1,
        key,
        rateLimitPerMinute,
        60,
      );
      const value = Number(result);
      if (value !== -1) {
        return rateLimitResponse(value >= 1 ? value * 1000 : undefined);
      }
      return null;
    } catch (err) {
      if (isRedisRequired()) {
        // Fail safe: the global IP budget cannot be verified; admitting the
        // request would rely on per-process state and multiply the limit by
        // the instance count. Visible 503, no secrets in the payload.
        console.error(
          "[hardening] PDFKIT_REDIS_REQUIRED=true and rate limit check failed — rejecting (fail-closed)",
          err instanceof Error ? err.message : err,
        );
        return jsonError(
          "USAGE_SERVICE_UNAVAILABLE",
          "Rate protection is temporarily unavailable. Please retry shortly.",
        );
      }
      console.warn("[hardening] Distributed rate limit check failed, using local fallback", err);
    }
  } else if (isRedisRequired()) {
    console.error(
      "[hardening] PDFKIT_REDIS_REQUIRED=true but Redis is not configured — rejecting (fail-closed)",
    );
    return jsonError(
      "USAGE_SERVICE_UNAVAILABLE",
      "Rate protection is temporarily unavailable. Please retry shortly.",
    );
  }

  // Local fallback in-memory rate limiting
  const now = Date.now();
  pruneInMemoryRateLimits(now);
  const entry = inMemoryRateLimits.get(scopedToken);

  if (!entry || now > entry.resetAt) {
    inMemoryRateLimits.set(scopedToken, { count: 1, resetAt: now + 60_000 });
    return null;
  }

  if (entry.count >= rateLimitPerMinute) {
    return rateLimitResponse(entry.resetAt - now);
  }

  entry.count += 1;
  return null;
}

/**
 * Phase 64 security hardening: the fallback map is keyed by anonymized client
 * token and entries were only ever replaced, never removed — a long-running
 * process would accumulate one entry per distinct client token forever
 * (unbounded memory growth in fallback mode). Opportunistic bounded sweep:
 * cheap (no-op under 5k entries), keeps the map proportional to live windows.
 */
const IN_MEMORY_LIMIT_MAX_ENTRIES = 5_000;

function pruneInMemoryRateLimits(now: number): void {
  if (inMemoryRateLimits.size <= IN_MEMORY_LIMIT_MAX_ENTRIES) return;
  for (const [key, entry] of inMemoryRateLimits) {
    if (now > entry.resetAt) inMemoryRateLimits.delete(key);
  }
  // Hard cap even when many windows are still live: drop oldest-expiring
  // entries beyond the cap (worst case a client's fallback counter restarts —
  // the Redis path is the authoritative limiter whenever it is configured).
  if (inMemoryRateLimits.size > IN_MEMORY_LIMIT_MAX_ENTRIES * 2) {
    const sorted = [...inMemoryRateLimits.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
    const excess = inMemoryRateLimits.size - IN_MEMORY_LIMIT_MAX_ENTRIES;
    for (let i = 0; i < excess; i++) inMemoryRateLimits.delete(sorted[i][0]);
  }
}
