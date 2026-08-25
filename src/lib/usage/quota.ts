import "server-only";

import type { UserIdentity } from "@/lib/auth/types";
import { getQuotaConfigForTier } from "@/lib/usage/config";
import { getUsageRepository } from "@/lib/usage/repository";
import type {
  QuotaPreflightResult,
  UsageRepository,
  UserUsageSummary,
} from "@/lib/usage/types";
import { formatBytes } from "@/lib/utils/format";

/**
 * Returns today's quota period date in ISO format ("YYYY-MM-DD", UTC).
 */
export function getCurrentQuotaPeriodDate(date = new Date()): string {
  return date.toISOString().split("T")[0];
}

/**
 * Perform a preflight quota check before processing expensive PDF jobs.
 *
 * Rejects requests when:
 * 1. The daily job count limit for the user's tier would be exceeded.
 * 2. The requested upload size exceeds the remaining daily byte budget.
 *
 * Does NOT consume quota for preflight-rejected requests.
 */
export async function checkQuotaPreflight(params: {
  identity: UserIdentity;
  requestedBytes?: number;
  repo?: UsageRepository;
}): Promise<QuotaPreflightResult> {
  const { identity, requestedBytes, repo = getUsageRepository() } = params;
  const tier = identity.tier || (identity.isAuthenticated ? "free" : "anonymous");
  const quotaConfig = getQuotaConfigForTier(tier);
  const periodDate = getCurrentQuotaPeriodDate();

  let currentJobCount = 0;
  let currentProcessedBytes = 0;

  try {
    const usage = await repo.getUsage(identity.userId, periodDate);
    if (usage) {
      currentJobCount = usage.jobCount;
      currentProcessedBytes = usage.processedBytes;
    }
  } catch {
    if (process.env.NODE_ENV === "production") {
      return {
        allowed: false,
        tier,
        periodDate,
        currentJobCount: 0,
        jobLimit: quotaConfig.dailyJobLimit,
        remainingJobs: 0,
        currentProcessedBytes: 0,
        byteLimit: quotaConfig.dailyByteLimit,
        remainingBytes: 0,
        reason: "SERVICE_UNAVAILABLE",
        message: "Usage verification service is temporarily unavailable. Please try again.",
      };
    }
    // Non-production fallback
  }

  const remainingJobs = Math.max(0, quotaConfig.dailyJobLimit - currentJobCount);
  const remainingBytes = Math.max(0, quotaConfig.dailyByteLimit - currentProcessedBytes);

  // 1. Check job count limit
  if (currentJobCount + 1 > quotaConfig.dailyJobLimit) {
    const planName = tier.charAt(0).toUpperCase() + tier.slice(1);
    return {
      allowed: false,
      tier,
      periodDate,
      currentJobCount,
      jobLimit: quotaConfig.dailyJobLimit,
      remainingJobs: 0,
      currentProcessedBytes,
      byteLimit: quotaConfig.dailyByteLimit,
      remainingBytes,
      reason: "JOB_LIMIT_EXCEEDED",
      message: `Daily processing quota reached (${quotaConfig.dailyJobLimit} jobs/day for ${planName} tier). Upgrade or try again tomorrow.`,
    };
  }

  // 2. Check byte limit if request size is known
  if (
    requestedBytes !== undefined &&
    requestedBytes > 0 &&
    currentProcessedBytes + requestedBytes > quotaConfig.dailyByteLimit
  ) {
    const planName = tier.charAt(0).toUpperCase() + tier.slice(1);
    return {
      allowed: false,
      tier,
      periodDate,
      currentJobCount,
      jobLimit: quotaConfig.dailyJobLimit,
      remainingJobs,
      currentProcessedBytes,
      byteLimit: quotaConfig.dailyByteLimit,
      remainingBytes,
      reason: "BYTE_LIMIT_EXCEEDED",
      message: `Daily processing volume limit of ${formatBytes(quotaConfig.dailyByteLimit, 0)} reached for ${planName} tier (${formatBytes(remainingBytes, 0)} remaining today).`,
    };
  }

  return {
    allowed: true,
    tier,
    periodDate,
    currentJobCount,
    jobLimit: quotaConfig.dailyJobLimit,
    remainingJobs,
    currentProcessedBytes,
    byteLimit: quotaConfig.dailyByteLimit,
    remainingBytes,
  };
}

/**
 * Returns user usage summary snapshot for profile display.
 */
export async function getUserUsageSummary(
  identity: UserIdentity,
  repo = getUsageRepository(),
): Promise<UserUsageSummary> {
  const tier = identity.tier || (identity.isAuthenticated ? "free" : "anonymous");
  const quotaConfig = getQuotaConfigForTier(tier);
  const periodDate = getCurrentQuotaPeriodDate();

  const usage = await repo.getUsage(identity.userId, periodDate);
  const jobsUsed = usage?.jobCount ?? 0;
  const bytesUsed = usage?.processedBytes ?? 0;

  return {
    userId: identity.userId,
    tier,
    periodDate,
    jobsUsed,
    dailyJobLimit: quotaConfig.dailyJobLimit,
    jobsRemaining: Math.max(0, quotaConfig.dailyJobLimit - jobsUsed),
    bytesUsed,
    dailyByteLimit: quotaConfig.dailyByteLimit,
    bytesRemaining: Math.max(0, quotaConfig.dailyByteLimit - bytesUsed),
  };
}
