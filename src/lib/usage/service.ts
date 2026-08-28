import "server-only";

import type { UserIdentity } from "@/lib/auth/types";
import { getCurrentQuotaPeriodDate, checkQuotaPreflight, getUserUsageSummary as getSummary } from "@/lib/usage/quota";
import { getUsageRepository } from "@/lib/usage/repository";
import type {
  QuotaPreflightResult,
  UsageRecord,
  UsageRepository,
  UserUsageSummary,
} from "@/lib/usage/types";

/**
 * Server-side Usage & Quota Service.
 *
 * Higher-level facade that decouples processing routes from storage engines.
 */
export class UsageService {
  private repo: UsageRepository;

  constructor(repo = getUsageRepository()) {
    this.repo = repo;
  }

  /**
   * Preflight check before starting document processing.
   */
  async evaluatePreflight(
    identity: UserIdentity,
    requestedBytes?: number,
  ): Promise<QuotaPreflightResult> {
    return checkQuotaPreflight({
      identity,
      requestedBytes,
      repo: this.repo,
    });
  }

  /**
   * Record successful PDF job execution and byte volume.
   *
   * Must be called ONLY after processing completes successfully.
   */
  async recordJobSuccess(
    identity: UserIdentity,
    processedBytes: number,
  ): Promise<UsageRecord> {
    const periodDate = getCurrentQuotaPeriodDate();

    // If user is authenticated, ensure their UserAccount row exists or is updated
    if (identity.isAuthenticated && identity.userId !== "anon") {
      try {
        await this.repo.upsertUserAccount({
          userId: identity.userId,
          email: identity.email,
          name: identity.name,
          tier: identity.tier,
          status: identity.status,
        });
      } catch (err) {
        console.error("[usage] Non-fatal account metadata sync error", err);
      }
    }

    return this.repo.recordUsage({
      userId: identity.userId,
      periodDate,
      jobCountDelta: 1,
      bytesDelta: Math.max(0, processedBytes),
    });
  }

  /**
   * Get user usage summary snapshot.
   */
  async getUserSummary(identity: UserIdentity): Promise<UserUsageSummary> {
    return getSummary(identity, this.repo);
  }
}

/**
 * Singleton instance of UsageService using active repository.
 */
export function getUsageService(): UsageService {
  return new UsageService(getUsageRepository());
}
