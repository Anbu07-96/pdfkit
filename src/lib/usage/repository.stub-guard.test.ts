// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Phase 64, Step 2 — the bundled Prisma client must be REAL whenever
 * DATABASE_URL is configured. The development stub (written by
 * scripts/generate-prisma-client.js when no real client exists) would
 * silently no-op every persistence call: metered jobs would "succeed"
 * while recording nothing. The repository refuses to start in that state.
 *
 * Both sides are tested with module mocks so the suite passes regardless of
 * whether CI bundled the stub or a real generated client.
 */

const makeRequestMock = vi.hoisted(() => vi.fn());

function setupClientMocks(options: { stub: boolean }) {
  vi.resetModules();

  class PrismaClient {
    static PDFKIT_STUB = options.stub ? true : undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(_opts?: any) {
      makeRequestMock(_opts);
    }
    async $disconnect() {}
    userAccount = {};
    dailyUsage = {};
    razorpayWebhookEvent = {};
  }

  class PrismaPg {
    // Adapter options from the repository are ignored by the mock.
    constructor(..._args: unknown[]) {
      void _args;
    }
  }

  vi.doMock("@prisma/client", () => ({ PrismaClient }));
  vi.doMock("@prisma/adapter-pg", () => ({ PrismaPg }));
}

async function importRepository() {
  const mod = await import("@/lib/usage/repository");
  return mod;
}

describe("PrismaUsageRepository stub fail-closed guard", () => {
  afterEach(() => {
    vi.doUnmock("@prisma/client");
    vi.doUnmock("@prisma/adapter-pg");
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("refuses to construct with DATABASE_URL set when the bundled client is the stub", async () => {
    setupClientMocks({ stub: true });
    vi.stubEnv("DATABASE_URL", "postgresql://u:pw@127.0.0.1:5432/pdfkit");

    const { PrismaUsageRepository, isStubPrismaClient } = await importRepository();
    expect(isStubPrismaClient()).toBe(true);

    expect(() => new PrismaUsageRepository()).toThrow(/development stub/);
    const threw = (() => {
      try {
        new PrismaUsageRepository();
      } catch (err) {
        return err as Error;
      }
      return null;
    })();
    // Actionable fix is named; the connection string is never echoed.
    expect(threw?.message).toContain("npx prisma generate");
    expect(threw?.message.includes("postgresql://")).toBe(false);
  });

  it("constructs with the driver adapter when a real client is bundled", async () => {
    setupClientMocks({ stub: false });
    vi.stubEnv("DATABASE_URL", "postgresql://u:pw@127.0.0.1:5432/pdfkit");

    const { PrismaUsageRepository, isStubPrismaClient } = await importRepository();
    expect(isStubPrismaClient()).toBe(false);

    expect(() => new PrismaUsageRepository()).not.toThrow();
    // The client was constructed WITH the pg driver adapter (Phase 64:
    // engineType = "client" + @prisma/adapter-pg — no Rust engine binary).
    expect(makeRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({ adapter: expect.anything() }),
    );
  });

  it("getPrismaClient without DATABASE_URL fails closed with a clear message", async () => {
    setupClientMocks({ stub: false });
    vi.stubEnv("DATABASE_URL", undefined);

    const { getUsageRepository } = await importRepository();
    // Without DATABASE_URL the factory returns the in-memory repository
    // (development mode) — never a Prisma repository.
    const repo = getUsageRepository();
    expect(repo.constructor.name).toBe("InMemoryUsageRepository");
  });
});
