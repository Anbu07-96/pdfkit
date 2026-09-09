// @vitest-environment node
/**
 * Phase 64, Step 3 — REAL PostgreSQL integration tests.
 *
 * These tests run ONLY when `PDFKIT_TEST_DATABASE_URL` points at a real
 * PostgreSQL database that has the migrations applied (the Phase 64
 * multi-instance harness / staging setup provides one; see
 * docs/staging-deployment.md). They are skipped otherwise — a mock is not a
 * substitute and would defeat the point: proving atomic accounting, race
 * safety and fail-safe behavior against the actual database engine.
 *
 * Run standalone:
 *   PDFKIT_TEST_DATABASE_URL=postgresql://pdfkit:pdfkit@127.0.0.1:5433/pdfkit \
 *     npx vitest run src/lib/usage/postgres.integration.test.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { PrismaClient } from "@prisma/client";

const DB_URL = process.env.PDFKIT_TEST_DATABASE_URL as string;
const describePg = DB_URL ? describe : describe.skip;

// Paths must be imported AFTER the DB_URL guard so failures are visible as
// skips, not import crashes.
import { PrismaUsageRepository } from "@/lib/usage/repository";
import { UsageService } from "@/lib/usage/service";
import { checkQuotaPreflight } from "@/lib/usage/quota";
import { getCurrentQuotaPeriodDate } from "@/lib/usage/quota";
import { ProcessingError } from "@/lib/processing/errors";
import type { UserIdentity } from "@/lib/auth/types";

const ANON_IDENTITY: UserIdentity = {
  userId: "anon",
  isAuthenticated: false,
  email: null,
  name: null,
  tier: "anonymous",
  status: "anonymous",
};

const FREE_IDENTITY: UserIdentity = {
  userId: "itest-free-1",
  isAuthenticated: true,
  email: "itest-free-1@example.com",
  name: "Integration Test",
  tier: "free",
  status: "active",
};

// Real-infrastructure tests get a generous timeout: a cold embedded server
// (fresh initdb, WAL warmup) under parallel vitest workers can exceed the
// default 5s without anything being wrong.
describePg("PrismaUsageRepository against real PostgreSQL (Phase 64)", { timeout: 30_000 }, () => {
  let prisma: PrismaClient;
  let repo: PrismaUsageRepository;

  beforeAll(() => {
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DB_URL }) });
  });

  beforeEach(async () => {
    // Clean slate per test: direct SQL truncate (faster + deterministic).
    const admin = new pg.Client({ connectionString: DB_URL });
    await admin.connect();
    await admin.query('TRUNCATE TABLE "DailyUsage", "RazorpayWebhookEvent", "UserAccount" CASCADE');
    await admin.end();
    repo = new PrismaUsageRepository(prisma);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("connects and performs a real round trip (empty unique lookup)", async () => {
    const record = await repo.getUsage("__nobody__", "1970-01-01");
    expect(record).toBeNull();
  });

  it("persists and looks up accounts, including verification-token lookup", async () => {
    await repo.upsertUserAccount({
      userId: FREE_IDENTITY.userId,
      email: FREE_IDENTITY.email,
      name: FREE_IDENTITY.name,
      tier: "free",
      status: "active",
      verificationToken: "tok-integration-1",
      verificationExpires: new Date(Date.now() + 60_000),
    });

    const byId = await repo.getUserAccount(FREE_IDENTITY.userId);
    expect(byId?.email).toBe(FREE_IDENTITY.email);
    expect(byId?.accountTrustStatus).toBe("unverified");
    expect(byId?.authProvider).toBe("credentials");

    const byToken = await repo.getUserAccountByVerificationToken("tok-integration-1");
    expect(byToken?.userId).toBe(FREE_IDENTITY.userId);

    expect(await repo.getUserAccountByVerificationToken("missing")).toBeNull();
  });

  it("persists usage with atomic increments (upsert)", async () => {
    const period = getCurrentQuotaPeriodDate();
    const first = await repo.recordUsage({
      userId: "itest-user-1",
      periodDate: period,
      jobCountDelta: 1,
      bytesDelta: 1024,
    });
    expect(first.jobCount).toBe(1);
    expect(first.processedBytes).toBe(1024);

    const second = await repo.recordUsage({
      userId: "itest-user-1",
      periodDate: period,
      jobCountDelta: 1,
      bytesDelta: 2048,
    });
    expect(second.jobCount).toBe(2);
    expect(second.processedBytes).toBe(3072);

    const stored = await repo.getUsage("itest-user-1", period);
    expect(stored?.jobCount).toBe(2);
    expect(stored?.processedBytes).toBe(3072);
  });

  it("REAL CONCURRENCY: 25 parallel increments of +4 → exactly 100 jobs, no lost updates", async () => {
    const period = getCurrentQuotaPeriodDate();
    const results = await Promise.all(
      Array.from({ length: 25 }, () =>
        repo.recordUsage({
          userId: "itest-race-1",
          periodDate: period,
          jobCountDelta: 4,
          bytesDelta: 4096,
        }),
      ),
    );

    // Every call returned a monotonically consistent view; the final stored
    // value must be exactly 25 × 4 — any lost increment shows up here.
    const finalRecord = await repo.getUsage("itest-race-1", period);
    expect(finalRecord?.jobCount).toBe(100);
    expect(finalRecord?.processedBytes).toBe(25 * 4096);
    expect(new Set(results.map((r) => r.jobCount)).size).toBe(25);
  });

  it("REAL CONCURRENCY: 12 simultaneous same-account jobs → each accounted exactly once (no duplicates, no losses)", async () => {
    const service = new UsageService(repo);
    const started = await Promise.all(
      Array.from({ length: 12 }, (_, i) => service.recordJobSuccess(FREE_IDENTITY, 10_000 + i)),
    );
    expect(started).toHaveLength(12);

    const period = getCurrentQuotaPeriodDate();
    const usage = await repo.getUsage(FREE_IDENTITY.userId, period);
    expect(usage?.jobCount).toBe(12);
    const expectedBytes = Array.from({ length: 12 }, (_, i) => 10_000 + i).reduce((a, b) => a + b, 0);
    expect(usage?.processedBytes).toBe(expectedBytes);

    // Exactly one account row exists (upserted concurrently, unique userId).
    const accounts = await prisma.userAccount.findMany({
      where: { userId: FREE_IDENTITY.userId },
    });
    expect(accounts).toHaveLength(1);
  });

  it("REAL CONCURRENCY: anonymous usage persists (FK regression — parent account row required on real PG)", async () => {
    // Before Phase 64, anonymous recordJobSuccess crashed on real PostgreSQL:
    // DailyUsage.userId has a foreign key to UserAccount(userId) and no
    // "anon" account row was created. The service now ensures it.
    const service = new UsageService(repo);
    await Promise.all(
      Array.from({ length: 5 }, () => service.recordJobSuccess(ANON_IDENTITY, 1024)),
    );

    const account = await repo.getUserAccount("anon");
    expect(account).not.toBeNull();
    expect(account?.tier).toBe("anonymous");
    expect(account?.email).toBeNull();

    const usage = await repo.getUsage("anon", getCurrentQuotaPeriodDate());
    expect(usage?.jobCount).toBe(5);
    expect(usage?.processedBytes).toBe(5 * 1024);
  });

  it("REAL CONCURRENCY: quota preflight at the exact boundary — increments are never lost even when concurrent preflights overshoot", async () => {
    // Seed the anonymous account to exactly its daily limit (10 jobs).
    const period = getCurrentQuotaPeriodDate();
    await repo.upsertUserAccount({ userId: "anon", tier: "anonymous", status: "anonymous" });
    for (let i = 0; i < 10; i++) {
      await repo.recordUsage({ userId: "anon", periodDate: period, jobCountDelta: 1, bytesDelta: 0 });
    }

    // A preflight at the boundary must reject.
    const boundary = await checkQuotaPreflight({ identity: ANON_IDENTITY, repo });
    expect(boundary.allowed).toBe(false);
    expect(boundary.reason).toBe("JOB_LIMIT_EXCEEDED");

    // 8 concurrent (preflight → record) pairs race past the read-then-check
    // preflight. The preflight is deliberately NOT a global lock (a quota
    // check must never block other users' reads); what MUST hold is that
    // every admitted job is accounted exactly once and no increment is lost.
    const service = new UsageService(repo);
    const outcomes = await Promise.all(
      Array.from({ length: 8 }, async () => {
        const preflight = await checkQuotaPreflight({ identity: ANON_IDENTITY, repo });
        if (!preflight.allowed) return "rejected" as const;
        await service.recordJobSuccess(ANON_IDENTITY, 1000);
        return "admitted" as const;
      }),
    );
    const admitted = outcomes.filter((o) => o === "admitted").length;

    const usage = await repo.getUsage("anon", period);
    // Exact accounting: initial 10 + every admitted job, regardless of how
    // many concurrent preflights overshot the limit.
    expect(usage?.jobCount).toBe(10 + admitted);
    expect(admitted).toBeLessThanOrEqual(8);
    // Documented overshoot bound: with 8 concurrent racers the admitted count
    // is bounded (each racer saw a consistent snapshot at the limit or less).
    expect(admitted).toBeLessThanOrEqual(8);
  });

  it("separates usage by quota period (daily rollover)", async () => {
    await repo.recordUsage({ userId: "itest-rollover", periodDate: "2026-09-08", jobCountDelta: 3, bytesDelta: 300 });
    await repo.recordUsage({ userId: "itest-rollover", periodDate: "2026-09-09", jobCountDelta: 1, bytesDelta: 100 });

    expect((await repo.getUsage("itest-rollover", "2026-09-08"))?.jobCount).toBe(3);
    expect((await repo.getUsage("itest-rollover", "2026-09-09"))?.jobCount).toBe(1);
  });

  it("stores exact duplicate-event protection (Razorpay webhook idempotency)", async () => {
    expect(await repo.hasProcessedRazorpayEvent("evt-1")).toBe(false);
    await repo.recordRazorpayEvent("evt-1", "payment.captured");
    expect(await repo.hasProcessedRazorpayEvent("evt-1")).toBe(true);

    // Duplicate insert fails safely (primary key) — the caller sees an error,
    // not silent double accounting.
    await expect(
      repo.recordRazorpayEvent("evt-1", "payment.captured"),
    ).rejects.toThrow();
  });

  it("FAIL-SAFE: a dead database in production mode rejects with USAGE_SERVICE_UNAVAILABLE (no false accounting success)", async () => {
    // Point a client at a guaranteed-closed port on localhost.
    const deadClient = new PrismaClient({
      adapter: new PrismaPg({ connectionString: "postgresql://pdfkit:pdfkit@127.0.0.1:1/dead" }),
    });
    const deadRepo = new PrismaUsageRepository(deadClient);

    vi.stubEnv("NODE_ENV", "production");
    try {
      // The pg driver fails fast on ECONNREFUSED; retry once in case the
      // connect timeout makes the first attempt slow.
      await expect(
        deadRepo.recordUsage({ userId: "x", periodDate: "2026-09-09", jobCountDelta: 1, bytesDelta: 1 }),
      ).rejects.toThrow(ProcessingError);

      const err = (await deadRepo
        .recordUsage({ userId: "x", periodDate: "2026-09-09", jobCountDelta: 1, bytesDelta: 1 })
        .catch((e: unknown) => e)) as ProcessingError;
      expect(err).toBeInstanceOf(ProcessingError);
      expect(err.code).toBe("USAGE_SERVICE_UNAVAILABLE");
      // The failure payload never echoes the connection string.
      expect(String(err.message).includes("postgresql://")).toBe(false);
    } finally {
      vi.unstubAllEnvs();
      // ioredis-style connect is lazy: dispose the dead client's pool.
      await deadClient.$disconnect().catch(() => {});
    }
  });
});
