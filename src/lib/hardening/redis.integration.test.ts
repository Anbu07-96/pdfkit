// @vitest-environment node
/**
 * Phase 64, Step 4 — REAL Redis integration tests.
 *
 * These tests run ONLY when `PDFKIT_TEST_REDIS_URL` points at a real Redis
 * (the Phase 64 harness starts one on a private port; see
 * docs/distributed-infrastructure-validation.md). They are skipped
 * otherwise — the fallback in-memory limiter is covered by unit tests.
 *
 * Multi-instance semantics are exercised by importing the protection module
 * TWICE (vi.resetModules + dynamic import): each module instance has its own
 * module state and its own ioredis connection, exactly like two application
 * processes sharing one Redis. Both must observe ONE global budget.
 *
 * Run standalone:
 *   PDFKIT_TEST_REDIS_URL=redis://127.0.0.1:6399/0 \
 *     npx vitest run src/lib/hardening/redis.integration.test.ts
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import Redis from "ioredis";

const REDIS_URL = process.env.PDFKIT_TEST_REDIS_URL as string;
const describeRedis = REDIS_URL ? describe : describe.skip;

type ProtectionModule = typeof import("@/lib/hardening/distributed-protection");

async function importProtectionInstance(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) vi.stubEnv(key, "");
    else vi.stubEnv(key, value);
  }
  return (await import("@/lib/hardening/distributed-protection")) as ProtectionModule;
}

function requestFromIp(ip: string): Request {
  return new Request("http://localhost/api/tools/merge-pdf", {
    method: "POST",
    headers: { "x-forwarded-for": ip },
  });
}

describeRedis("distributed protection against real Redis (Phase 64)", { timeout: 30_000 }, () => {
  let instanceA: ProtectionModule;
  let instanceB: ProtectionModule;
  let raw: Redis;

  beforeAll(async () => {
    instanceA = await importProtectionInstance({ PDFKIT_REDIS_URL: REDIS_URL, REDIS_URL: undefined });
    instanceB = await importProtectionInstance({ PDFKIT_REDIS_URL: REDIS_URL, REDIS_URL: undefined });
    raw = new Redis(REDIS_URL, { maxRetriesPerRequest: 1, connectTimeout: 2000 });
    // Start from a clean slate (leftover counters from earlier runs on the
    // same day would collide with the same salted IP tokens).
    await raw.flushdb();
  });

  afterEach(async () => {
    // Isolate tests: flush the harness redis (private port, disposable data).
    await raw.flushdb();
  });

  it("connects and pings with latency", async () => {
    const result = await instanceA.pingRedis();
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("SHARED BUDGET: 60 requests/min are honored GLOBALLY across two instances — not 120", async () => {
    const ip = "198.51.100.10";
    // 30 requests via instance A, 30 via instance B — one shared counter.
    for (let i = 0; i < 30; i++) {
      expect(await instanceA.checkRateLimit(requestFromIp(ip), 60)).toBeNull();
      expect(await instanceB.checkRateLimit(requestFromIp(ip), 60)).toBeNull();
    }
    // The 61st request is rejected no matter which instance serves it.
    const blockedA = await instanceA.checkRateLimit(requestFromIp(ip), 60);
    expect(blockedA).not.toBeNull();
    expect(blockedA!.status).toBe(429);
    const blockedB = await instanceB.checkRateLimit(requestFromIp(ip), 60);
    expect(blockedB).not.toBeNull();
    expect(blockedB!.status).toBe(429);

    // A different IP is unaffected (per-IP isolation).
    expect(await instanceA.checkRateLimit(requestFromIp("198.51.100.11"), 60)).toBeNull();
  });

  it("SHARED BUDGET: Retry-After is consistent across instances", async () => {
    const ip = "198.51.100.20";
    for (let i = 0; i < 60; i++) {
      await instanceA.checkRateLimit(requestFromIp(ip), 60);
    }
    const blockedViaA = await instanceA.checkRateLimit(requestFromIp(ip), 60);
    const blockedViaB = await instanceB.checkRateLimit(requestFromIp(ip), 60);
    expect(blockedViaA!.status).toBe(429);
    expect(blockedViaB!.status).toBe(429);
    const retryA = Number(blockedViaA!.headers.get("retry-after"));
    const retryB = Number(blockedViaB!.headers.get("retry-after"));
    expect(retryA).toBeGreaterThan(0);
    expect(retryB).toBeGreaterThan(0);
    // Same window, same key: both instances report (nearly) the same value.
    expect(Math.abs(retryA - retryB)).toBeLessThanOrEqual(1);
  });

  it("TTL: the rate-limit key expires and the window resets", async () => {
    const ip = "198.51.100.30";
    const token = instanceA.anonymizeClientIp(requestFromIp(ip));
    const key = `pdfkit:ratelimit:${token}`;

    await instanceA.checkRateLimit(requestFromIp(ip), 1);
    await instanceA.checkRateLimit(requestFromIp(ip), 1); // now limited

    // The key exists with a positive TTL (fixed 60s window).
    const ttl = await raw.ttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);

    // Force the window to roll over deterministically instead of waiting 60s.
    await raw.expire(key, 1);
    await new Promise((r) => setTimeout(r, 1300));

    // Counter reset: the same IP is admitted again on both instances.
    expect(await instanceA.checkRateLimit(requestFromIp(ip), 1)).toBeNull();
    expect(await instanceB.checkRateLimit(requestFromIp(ip), 1)).not.toBeNull();
  });

  it("SHARED CAP: distributed concurrency slots are global across instances", async () => {
    const cap = 2;
    // Both instances draw from the same slot pool.
    expect(await instanceA.tryAcquireDistributedSlot(cap)).toBe(true); // slot 1
    expect(await instanceB.tryAcquireDistributedSlot(cap)).toBe(true); // slot 2
    // Cap reached — no third slot on either instance.
    expect(await instanceA.tryAcquireDistributedSlot(cap)).toBe(false);
    expect(await instanceB.tryAcquireDistributedSlot(cap)).toBe(false);

    // Releasing on one instance frees capacity observed by the other.
    await instanceA.releaseDistributedSlot();
    expect(await instanceB.tryAcquireDistributedSlot(cap)).toBe(true);
  });

  it("WATCHDOG: un-released slots expire via lease TTL (stale lease cleanup)", async () => {
    // Short lease: simulate a crashed instance that never released.
    expect(await instanceA.tryAcquireDistributedSlot(2, 1)).toBe(true);
    expect(await instanceB.tryAcquireDistributedSlot(2, 1)).toBe(true);
    expect(await instanceA.tryAcquireDistributedSlot(2, 1)).toBe(false);

    await new Promise((r) => setTimeout(r, 1300));

    // Expired leases no longer count: both slots available again.
    expect(await instanceA.tryAcquireDistributedSlot(2, 1)).toBe(true);
    expect(await instanceB.tryAcquireDistributedSlot(2, 1)).toBe(true);
  });

  it("release never drives the shared counter below zero", async () => {
    await instanceA.releaseDistributedSlot(); // release without acquire
    const counter = Number(await raw.get("pdfkit:concurrency:active") ?? 0);
    expect(counter).toBeGreaterThanOrEqual(0);

    expect(await instanceA.tryAcquireDistributedSlot(1)).toBe(true);
    await instanceB.releaseDistributedSlot();
    await instanceA.releaseDistributedSlot();
    const after = Number(await raw.get("pdfkit:concurrency:active") ?? 0);
    expect(after).toBeGreaterThanOrEqual(0);
  });

  it("OUTAGE: unreachable Redis reports failed (visible), local fallback stays bounded (not unlimited)", async () => {
    const dead = await importProtectionInstance({
      PDFKIT_REDIS_URL: "redis://127.0.0.1:1/0",
      REDIS_URL: undefined,
    });

    const ping = await dead.pingRedis();
    expect(ping.status).toBe("failed");

    // Dev semantics (no PDFKIT_REDIS_REQUIRED): documented per-process
    // fallback — requests are still LIMITED (1/min), never unlimited.
    const ip = "198.51.100.40";
    expect(await dead.checkRateLimit(requestFromIp(ip), 1)).toBeNull();
    const blocked = await dead.checkRateLimit(requestFromIp(ip), 1);
    expect(blocked).not.toBeNull();
    expect(blocked!.status).toBe(429);
  });

  it("redis keys use only fixed namespaces with hashed/scoped tokens (no raw IPs, no user-controlled key names)", async () => {
    await instanceA.checkRateLimit(requestFromIp("203.0.113.99"), 60);
    await instanceA.tryAcquireDistributedSlot(10);

    const keys = await raw.keys("*");
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      // Fixed namespaces only.
      expect(key.startsWith("pdfkit:")).toBe(true);
      // No raw IP addresses or user-controlled strings in key names.
      expect(key.includes("203.0.113.99")).toBe(false);
      expect(key).toMatch(/^pdfkit:[a-z0-9:._-]*$/);
    }
  });
});
