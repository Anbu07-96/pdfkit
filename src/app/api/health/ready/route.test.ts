// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

// The dependency probes are mocked: this file tests the ROUTE's verdict
// logic. The bundled Prisma client in dev/CI is a no-op stub (see
// scripts/generate-prisma-client.js), so a real unreachable-database round
// trip only exists with a production-generated client.
type PingResult =
  | { status: "unconfigured" }
  | { status: "ok"; latencyMs: number }
  | { status: "failed" };

const pingDatabaseMock = vi.hoisted(() =>
  vi.fn(async (): Promise<PingResult> => ({ status: "unconfigured" })),
);
const pingRedisMock = vi.hoisted(() =>
  vi.fn(async (): Promise<PingResult> => ({ status: "unconfigured" })),
);

vi.mock("@/lib/usage/repository", () => ({
  pingDatabase: pingDatabaseMock,
}));
vi.mock("@/lib/hardening/distributed-protection", () => ({
  pingRedis: pingRedisMock,
}));

import { GET, resetReadinessCacheForTests } from "@/app/api/health/ready/route";

/**
 * Phase 63 — readiness probe. Liveness (/api/health) and readiness
 * (/api/health/ready) are separate: readiness must verify configured
 * dependencies and answer 503 when one is failing, without ever leaking
 * connection strings or secrets.
 */

describe("GET /api/health/ready", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    resetReadinessCacheForTests();
  });

  it("reports degraded-but-ready when no external dependencies are configured", async () => {
    resetReadinessCacheForTests();

    const response = await GET();
    expect([200, 503]).toContain(response.status);
    const body = (await response.json()) as {
      status: string;
      checks: Record<string, { status: string }>;
    };
    // In-memory usage repo + local rate limiter = supported dev mode:
    // "degraded" (optional deps unconfigured), still HTTP 200.
    expect(body.status).toBe("degraded");
    expect(response.status).toBe(200);
    expect(body.checks.database.status).toBe("unconfigured");
    expect(body.checks.redis.status).toBe("unconfigured");
    expect(body.checks.processing.status).toBe("ok");
  });

  it("answers 503 unavailable when a configured database probe fails", async () => {
    pingDatabaseMock.mockResolvedValueOnce({ status: "failed" });
    resetReadinessCacheForTests();

    const response = await GET();
    expect(response.status).toBe(503);
    const body = (await response.json()) as {
      status: string;
      checks: { database: { status: string } };
    };
    expect(body.status).toBe("unavailable");
    expect(body.checks.database.status).toBe("failed");

    // The payload must never echo a connection string or secret.
    const text = JSON.stringify(body);
    expect(text.includes("postgres")).toBe(false);
  });

  it("reports database latency when the probe succeeds", async () => {
    pingDatabaseMock.mockResolvedValueOnce({ status: "ok", latencyMs: 7 });
    pingRedisMock.mockResolvedValueOnce({ status: "ok", latencyMs: 2 });
    resetReadinessCacheForTests();

    const response = await GET();
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      status: string;
      checks: { database: { status: string; latencyMs?: number } };
    };
    expect(body.status).toBe("ok");
    expect(body.checks.database.status).toBe("ok");
    expect(body.checks.database.latencyMs).toBe(7);
  });

  it("answers 503 when Redis is configured but unreachable", async () => {
    pingRedisMock.mockResolvedValueOnce({ status: "failed" });
    resetReadinessCacheForTests();

    const response = await GET();
    expect(response.status).toBe(503);
    const body = (await response.json()) as {
      status: string;
      checks: { redis: { status: string } };
    };
    expect(body.status).toBe("unavailable");
    expect(body.checks.redis.status).toBe("failed");
  });

  it("caches readiness results for 5 seconds (cheap probing)", async () => {
    resetReadinessCacheForTests();

    const first = await GET();
    const second = await GET();
    const a = (await first.json()) as { timestamp: string };
    const b = (await second.json()) as { timestamp: string };
    // Same cached result: identical timestamp.
    expect(b.timestamp).toBe(a.timestamp);
  });

  it("never exposes secrets or connection strings", async () => {
    pingDatabaseMock.mockResolvedValueOnce({ status: "ok", latencyMs: 1 });
    resetReadinessCacheForTests();
    const response = await GET();
    const json = JSON.stringify(await response.json());
    for (const forbidden of ["DATABASE_URL", "postgres", "redis://", "secret", "password"]) {
      expect(json.includes(forbidden)).toBe(false);
    }
  });

  it("rejects non-GET methods", async () => {
    const { POST } = await import("@/app/api/health/ready/route");
    const response = POST();
    expect(response.status).toBe(405);
  });
});
