import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserIdentity } from "@/lib/auth/types";
import {
  DEFAULT_TIER_QUOTAS,
  getQuotaConfigForTier,
} from "@/lib/usage/config";
import {
  getCurrentQuotaPeriodDate,
} from "@/lib/usage/quota";
import {
  InMemoryUsageRepository,
  getUsageRepository,
  setUsageRepositoryOverride,
} from "@/lib/usage/repository";
import { UsageService } from "@/lib/usage/service";
import { ProcessingError } from "@/lib/processing/errors";

const mockAnonIdentity: UserIdentity = {
  isAuthenticated: false,
  userId: "anon",
  email: null,
  name: null,
  status: "anonymous",
  tier: "anonymous",
};

const mockFreeIdentity: UserIdentity = {
  isAuthenticated: true,
  userId: "usr_free_123",
  email: "free@example.com",
  name: "Free User",
  status: "active",
  tier: "free",
};

const mockProIdentity: UserIdentity = {
  isAuthenticated: true,
  userId: "usr_pro_456",
  email: "pro@example.com",
  name: "Pro User",
  status: "active",
  tier: "pro",
};

const mockBusinessIdentity: UserIdentity = {
  isAuthenticated: true,
  userId: "usr_biz_789",
  email: "biz@example.com",
  name: "Biz User",
  status: "active",
  tier: "business",
};

describe("Phase 43 — Database Usage Quotas & Metering", () => {
  let repo: InMemoryUsageRepository;
  let service: UsageService;

  beforeEach(() => {
    repo = new InMemoryUsageRepository();
    setUsageRepositoryOverride(repo);
    service = new UsageService(repo);
  });

  afterEach(() => {
    setUsageRepositoryOverride(null);
  });

  describe("Quota Configuration", () => {
    it("returns correct default quota configs for all tiers", () => {
      expect(getQuotaConfigForTier("anonymous")).toEqual(DEFAULT_TIER_QUOTAS.anonymous);
      expect(getQuotaConfigForTier("free")).toEqual(DEFAULT_TIER_QUOTAS.free);
      expect(getQuotaConfigForTier("pro")).toEqual(DEFAULT_TIER_QUOTAS.pro);
      expect(getQuotaConfigForTier("business")).toEqual(DEFAULT_TIER_QUOTAS.business);
    });

    it("respects environment variable overrides for quotas", () => {
      vi.stubEnv("PDFKIT_QUOTA_ANON_DAILY_JOBS", "15");
      vi.stubEnv("PDFKIT_QUOTA_ANON_DAILY_BYTES", "104857600"); // 100 MB

      const anonConfig = getQuotaConfigForTier("anonymous");
      expect(anonConfig.dailyJobLimit).toBe(15);
      expect(anonConfig.dailyByteLimit).toBe(104857600);

      vi.unstubAllEnvs();
    });
  });

  describe("Preflight Quota Checks", () => {
    it("allows request when under anonymous quota", async () => {
      const result = await service.evaluatePreflight(mockAnonIdentity, 1024);
      expect(result.allowed).toBe(true);
      expect(result.tier).toBe("anonymous");
      expect(result.currentJobCount).toBe(0);
      expect(result.remainingJobs).toBe(10);
    });

    it("allows request when under free-user quota", async () => {
      const result = await service.evaluatePreflight(mockFreeIdentity, 10 * 1024 * 1024);
      expect(result.allowed).toBe(true);
      expect(result.tier).toBe("free");
      expect(result.remainingJobs).toBe(50);
    });

    it("allows request when under pro-user quota", async () => {
      const result = await service.evaluatePreflight(mockProIdentity, 50 * 1024 * 1024);
      expect(result.allowed).toBe(true);
      expect(result.tier).toBe("pro");
      expect(result.remainingJobs).toBe(500);
    });

    it("allows request when under business-user quota", async () => {
      const result = await service.evaluatePreflight(mockBusinessIdentity, 100 * 1024 * 1024);
      expect(result.allowed).toBe(true);
      expect(result.tier).toBe("business");
      expect(result.remainingJobs).toBe(5000);
    });

    it("rejects request when job count reaches exact daily limit boundary", async () => {
      const limit = DEFAULT_TIER_QUOTAS.anonymous.dailyJobLimit; // 10
      for (let i = 0; i < limit; i++) {
        await service.recordJobSuccess(mockAnonIdentity, 1024);
      }

      const preflight = await service.evaluatePreflight(mockAnonIdentity, 1024);
      expect(preflight.allowed).toBe(false);
      expect(preflight.reason).toBe("JOB_LIMIT_EXCEEDED");
      expect(preflight.message).toContain("Daily processing quota reached");
    });

    it("rejects request larger than remaining byte quota", async () => {
      // Consume 45MB out of 50MB
      await service.recordJobSuccess(mockAnonIdentity, 45 * 1024 * 1024);

      // Attempt a 10MB job (would exceed 50MB total)
      const preflight = await service.evaluatePreflight(mockAnonIdentity, 10 * 1024 * 1024);
      expect(preflight.allowed).toBe(false);
      expect(preflight.reason).toBe("BYTE_LIMIT_EXCEEDED");
      expect(preflight.message).toContain("Daily processing volume limit");
    });

    it("handles daily period rollover cleanly", async () => {
      const today = getCurrentQuotaPeriodDate();
      const yesterday = "2020-01-01";

      // Usage yesterday
      await repo.recordUsage({
        userId: mockAnonIdentity.userId,
        periodDate: yesterday,
        jobCountDelta: 10,
        bytesDelta: 50 * 1024 * 1024,
      });

      // Preflight today should be clear
      const preflight = await service.evaluatePreflight(mockAnonIdentity, 1024);
      expect(preflight.allowed).toBe(true);
      expect(preflight.currentJobCount).toBe(0);
      expect(preflight.periodDate).toBe(today);
    });
  });

  describe("Usage Recording & Atomicity", () => {
    it("records successful job usage accurately", async () => {
      await service.recordJobSuccess(mockFreeIdentity, 2048);
      const usage = await repo.getUsage(mockFreeIdentity.userId, getCurrentQuotaPeriodDate());

      expect(usage).not.toBeNull();
      expect(usage?.jobCount).toBe(1);
      expect(usage?.processedBytes).toBe(2048);
    });

    it("persists user account metadata upon first job success for authenticated users", async () => {
      await service.recordJobSuccess(mockFreeIdentity, 1024);
      const acc = await repo.getUserAccount(mockFreeIdentity.userId);

      expect(acc).not.toBeNull();
      expect(acc?.userId).toBe(mockFreeIdentity.userId);
      expect(acc?.email).toBe(mockFreeIdentity.email);
      expect(acc?.tier).toBe("free");
    });

    it("handles atomic concurrent usage updates correctly", async () => {
      const promises = Array.from({ length: 20 }).map(() =>
        service.recordJobSuccess(mockFreeIdentity, 100),
      );

      await Promise.all(promises);

      const usage = await repo.getUsage(mockFreeIdentity.userId, getCurrentQuotaPeriodDate());
      expect(usage?.jobCount).toBe(20);
      expect(usage?.processedBytes).toBe(2000);
    });
  });

  describe("User Usage Summary", () => {
    it("returns correct summary metrics for account view", async () => {
      await service.recordJobSuccess(mockFreeIdentity, 50 * 1024 * 1024); // 50MB, 1 job

      const summary = await service.getUserSummary(mockFreeIdentity);
      expect(summary.userId).toBe(mockFreeIdentity.userId);
      expect(summary.tier).toBe("free");
      expect(summary.jobsUsed).toBe(1);
      expect(summary.dailyJobLimit).toBe(50);
      expect(summary.jobsRemaining).toBe(49);
      expect(summary.bytesUsed).toBe(50 * 1024 * 1024);
      expect(summary.bytesRemaining).toBe(200 * 1024 * 1024);
    });
  });

  describe("Failure Safety & Privacy Requirements", () => {
    it("fails closed in production when database is unconfigured", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("DATABASE_URL", "");
      setUsageRepositoryOverride(null);

      const activeRepo = getUsageRepository();
      await expect(activeRepo.getUsage("user1", "2026-08-26")).rejects.toThrow(
        ProcessingError,
      );

      vi.unstubAllEnvs();
    });

    it("does not store document text, passwords, or raw IP addresses in usage records", async () => {
      await service.recordJobSuccess(mockFreeIdentity, 5000);
      const usage = await repo.getUsage(mockFreeIdentity.userId, getCurrentQuotaPeriodDate());

      expect(Object.keys(usage!)).toEqual([
        "userId",
        "periodDate",
        "jobCount",
        "processedBytes",
        "createdAt",
        "updatedAt",
      ]);
    });
  });

  describe("Phase 64 — Anonymous Usage Persistence (FK regression)", () => {
    it("creates the parent UserAccount row for anonymous identities before recording usage", async () => {
      // On real PostgreSQL, DailyUsage.userId has a foreign key to
      // UserAccount(userId). Previously the account upsert ran only for
      // authenticated identities, so anonymous recordUsage failed on a real
      // database (the in-memory repository masked this). The service must
      // ensure the parent row exists for EVERY identity.
      const anonIdentity = {
        userId: "anon",
        isAuthenticated: false,

        email: null,
        name: null,
        tier: "anonymous" as const,
        status: "anonymous" as const,
      };

      await service.recordJobSuccess(anonIdentity, 4096);

      const account = await repo.getUserAccount("anon");
      expect(account).not.toBeNull();
      expect(account!.userId).toBe("anon");
      expect(account!.tier).toBe("anonymous");
      expect(account!.email).toBeNull();
      expect(account!.name).toBeNull();

      const usage = await repo.getUsage("anon", getCurrentQuotaPeriodDate());
      expect(usage!.jobCount).toBe(1);
      expect(Number(usage!.processedBytes)).toBe(4096);
    });

    it("upserts the anonymous account idempotently (no PII, stable singleton)", async () => {
      const anonIdentity = {
        userId: "anon",
        isAuthenticated: false,

        email: null,
        name: null,
        tier: "anonymous" as const,
        status: "anonymous" as const,
      };

      const upsertSpy = vi.spyOn(repo, "upsertUserAccount");
      await service.recordJobSuccess(anonIdentity, 100);
      await service.recordJobSuccess(anonIdentity, 100);
      await service.recordJobSuccess(anonIdentity, 100);

      // Every recording ensures the parent row (upsert = idempotent).
      expect(upsertSpy).toHaveBeenCalledTimes(3);
      for (const call of upsertSpy.mock.calls) {
        expect(call[0].userId).toBe("anon");
        expect(call[0].email).toBeUndefined();
        expect(call[0].name).toBeUndefined();
      }
      // The anonymous account exists exactly once via the unique userId key.
      const account = await repo.getUserAccount("anon");
      expect(account!.userId).toBe("anon");

      const usage = await repo.getUsage("anon", getCurrentQuotaPeriodDate());
      expect(usage!.jobCount).toBe(3);
    });

    it("does not overwrite authenticated account metadata when recording anonymous usage", async () => {
      await repo.upsertUserAccount({
        userId: "user-registered-1",
        email: "someone@example.com",
        name: "Someone",
        tier: "pro",
        status: "active",
      });

      const registeredIdentity = {
        userId: "user-registered-1",
        isAuthenticated: true,

        email: "someone@example.com",
        name: "Someone",
        tier: "pro" as const,
        status: "active" as const,
      };
      await service.recordJobSuccess(registeredIdentity, 2048);

      const account = await repo.getUserAccount("user-registered-1");
      expect(account!.email).toBe("someone@example.com");
      expect(account!.tier).toBe("pro");
      expect(account!.name).toBe("Someone");
    });
  });
});

