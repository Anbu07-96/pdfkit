import "server-only";

import { createHash } from "node:crypto";
import Redis from "ioredis";
import { jsonError } from "@/lib/processing/http";
import {
  releaseJobSlot as localReleaseJobSlot,
  tryAcquireJobSlot as localTryAcquireJobSlot,
} from "@/lib/hardening/guards";

/**
 * Distributed Concurrency & Rate-Limiting Protection (Phase 41).
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

/** Compute an anonymized 16-character SHA-256 token for client rate limiting. */
export function anonymizeClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  const realIp = request.headers.get("x-real-ip") ?? "";
  const ip = (forwarded.split(",")[0] || realIp || "127.0.0.1").trim();
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
  return 0
end
return 1
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

// In-memory rate limiting map for fallback mode
const inMemoryRateLimits = new Map<string, { count: number; resetAt: number }>();

/**
 * Check distributed IP rate limit.
 * Returns null if allowed, or HTTP 429 Response if rate limit exceeded.
 */
export async function checkRateLimit(
  request: Request,
  rateLimitPerMinute: number,
): Promise<Response | null> {
  if (rateLimitPerMinute <= 0) return null;

  const clientToken = anonymizeClientIp(request);
  const redis = getRedisClient();

  if (redis) {
    try {
      const key = `pdfkit:ratelimit:${clientToken}`;
      const allowed = await redis.eval(RATE_LIMIT_LUA, 1, key, rateLimitPerMinute, 60);
      if (Number(allowed) === 0) {
        return jsonError(
          "TOO_MANY_REQUESTS",
          "Too many requests. Please wait a moment before trying again.",
        );
      }
      return null;
    } catch (err) {
      console.warn("[hardening] Distributed rate limit check failed, using local fallback", err);
    }
  }

  // Local fallback in-memory rate limiting
  const now = Date.now();
  const entry = inMemoryRateLimits.get(clientToken);

  if (!entry || now > entry.resetAt) {
    inMemoryRateLimits.set(clientToken, { count: 1, resetAt: now + 60_000 });
    return null;
  }

  if (entry.count >= rateLimitPerMinute) {
    return jsonError(
      "TOO_MANY_REQUESTS",
      "Too many requests. Please wait a moment before trying again.",
    );
  }

  entry.count += 1;
  return null;
}
