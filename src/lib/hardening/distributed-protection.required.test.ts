// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase 64 — `PDFKIT_REDIS_REQUIRED=true` fail-closed semantics.
 *
 * When a deployment declares Redis mandatory (multi-instance staging/prod),
 * an unavailable Redis must NOT silently downgrade global protections to
 * per-process state (that would multiply the IP rate limit and concurrency
 * cap by the instance count). Expected behavior:
 *   - rate limit check  → visible 503, no local fallback
 *   - concurrency slot  → denied, no local fallback
 *   - no URL configured → same failures (deployment error, not degraded)
 * Without the flag (dev default) the documented local fallback stays.
 */

const evalMock = vi.hoisted(() => vi.fn());

vi.mock("ioredis", () => {
  class FakeRedis {
    status = "ready";
    // Extra constructor arguments from ioredis call sites are ignored at
    // runtime; a parameterless constructor keeps the mock honest.
    constructor(..._args: unknown[]) {
      void _args;
    }
    eval = evalMock;
    async ping() {
      return "PONG";
    }
    async connect() {
      /* no-op */
    }
    async disconnect() {
      /* no-op */
    }
    on() {
      return this;
    }
  }
  return { default: FakeRedis };
});

import {
  checkRateLimit,
  isRedisRequired,
  tryAcquireDistributedSlot,
} from "@/lib/hardening/distributed-protection";

function request(): Request {
  return new Request("http://localhost/api/tools/merge-pdf", {
    method: "POST",
    headers: { "x-forwarded-for": "203.0.113.7" },
  });
}

describe("PDFKIT_REDIS_REQUIRED fail-closed protection", () => {
  beforeEach(() => {
    vi.stubEnv("PDFKIT_REDIS_URL", "redis://127.0.0.1:6399/0");
    vi.stubEnv("PDFKIT_REDIS_REQUIRED", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("isRedisRequired reflects the flag", () => {
    expect(isRedisRequired()).toBe(true);
    vi.stubEnv("PDFKIT_REDIS_REQUIRED", "false");
    expect(isRedisRequired()).toBe(false);
  });

  it("returns a visible 503 when the Redis rate-limit check fails (no silent fallback)", async () => {
    evalMock.mockRejectedValueOnce(new Error("connection refused"));
    const blocked = await checkRateLimit(request(), 60);
    expect(blocked).not.toBeNull();
    expect(blocked!.status).toBe(503);
    const body = (await blocked!.json()) as { error: { code: string } };
    expect(body.error.code).toBe("USAGE_SERVICE_UNAVAILABLE");
    // The error payload must not echo connection details.
    expect(JSON.stringify(body).includes("redis://")).toBe(false);
    expect(JSON.stringify(body).includes("connection refused")).toBe(false);
  });

  it("denies the concurrency slot when the Redis acquire fails (no local fallback)", async () => {
    evalMock.mockRejectedValueOnce(new Error("connection refused"));
    const acquired = await tryAcquireDistributedSlot(4);
    expect(acquired).toBe(false);
  });

  it("admits traffic normally while Redis answers", async () => {
    evalMock.mockResolvedValueOnce(-1); // rate limit: allowed
    expect(await checkRateLimit(request(), 60)).toBeNull();

    evalMock.mockResolvedValueOnce(1); // slot acquire: granted
    expect(await tryAcquireDistributedSlot(4)).toBe(true);
  });

  it("keeps the documented local fallback when the flag is unset (dev)", async () => {
    vi.stubEnv("PDFKIT_REDIS_REQUIRED", "false");
    evalMock.mockRejectedValueOnce(new Error("connection refused"));
    // Local fallback admits the request (per-process budget).
    expect(await checkRateLimit(request(), 60)).toBeNull();
    evalMock.mockRejectedValueOnce(new Error("connection refused"));
    expect(await tryAcquireDistributedSlot(4)).toBe(true);
  });

  it("rejects rate-limited requests even when the flag is unset (fallback still limits)", async () => {
    vi.stubEnv("PDFKIT_REDIS_REQUIRED", "false");
    // Redis path rejects with remaining TTL seconds → 429 with Retry-After.
    evalMock.mockResolvedValueOnce(37);
    const blocked = await checkRateLimit(request(), 1);
    expect(blocked).not.toBeNull();
    expect(blocked!.status).toBe(429);
    expect(blocked!.headers.get("retry-after")).toBe("37");
  });
});
