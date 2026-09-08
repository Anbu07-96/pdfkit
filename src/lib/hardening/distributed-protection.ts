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

/** Compute an anonymized 16-character SHA-256 token for client rate limiting with proxy IP hardening. */
export function anonymizeClientIp(request: Request): string {
  const cfIp = request.headers.get("cf-connecting-ip")?.trim();
  const realIp = request.headers.get("x-real-ip")?.trim();
  const forwarded = request.headers.get("x-forwarded-for") ?? "";

  // Reverse proxies like Render/Railway/Cloudflare append the real client IP to the end or set CF-Connecting-IP / X-Real-IP
  const forwardedIps = forwarded
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  // Pick CF-Connecting-IP > X-Real-IP > last X-Forwarded-For entry > first X-Forwarded-For entry > fallback
  const rawCandidate =
    cfIp || realIp || forwardedIps[forwardedIps.length - 1] || forwardedIps[0] || "127.0.0.1";

  // Sanitize IP format to prevent header injection in keys
  const ip = /^[\d.a-fA-F:]+$/.test(rawCandidate) ? rawCandidate : "127.0.0.1";

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
 * Try to acquire a concurrency slot across distributed instances.
 * Falls back to local in-memory guard if Redis is not configured or unavailable.
 */
export async function tryAcquireDistributedSlot(
  maxConcurrentJobs: number,
  leaseTtlSeconds = DEFAULT_LEASE_TTL,
): Promise<boolean> {
  const redis = getRedisClient();
  if (!redis) {
    return localTryAcquireJobSlot(maxConcurrentJobs);
  }

  try {
    const result = await redis.eval(
      ACQUIRE_LUA,
      1,
      CONCURRENCY_KEY,
      maxConcurrentJobs,
      leaseTtlSeconds,
    );
    return Number(result) === 1;
  } catch (err) {
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
      console.warn("[hardening] Distributed rate limit check failed, using local fallback", err);
    }
  }

  // Local fallback in-memory rate limiting
  const now = Date.now();
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
