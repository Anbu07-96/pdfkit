import "server-only";

import type { UserAccountTier } from "@/lib/auth/types";
import type { TierQuotaConfig } from "@/lib/usage/types";

/**
 * Default daily plan quotas for PDFKit.
 *
 * - anonymous:  10 jobs/day,  50 MB/day
 * - free:       50 jobs/day, 250 MB/day
 * - pro:       500 jobs/day,   2 GB/day
 * - business: 5000 jobs/day,  20 GB/day
 */
export const DEFAULT_TIER_QUOTAS: Record<UserAccountTier, TierQuotaConfig> = {
  anonymous: {
    tier: "anonymous",
    dailyJobLimit: 10,
    dailyByteLimit: 50 * 1024 * 1024, // 50 MB
  },
  free: {
    tier: "free",
    dailyJobLimit: 50,
    dailyByteLimit: 250 * 1024 * 1024, // 250 MB
  },
  pro: {
    tier: "pro",
    dailyJobLimit: 500,
    dailyByteLimit: 2 * 1024 * 1024 * 1024, // 2 GB
  },
  business: {
    tier: "business",
    dailyJobLimit: 5000,
    dailyByteLimit: 20 * 1024 * 1024 * 1024, // 20 GB
  },
};

/**
 * Helper to parse a positive integer environment variable with fallback.
 */
function parseEnvPositiveInt(key: string, fallback: number): number {
  const val = process.env[key];
  if (!val) return fallback;
  const parsed = parseInt(val, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Resolves configured tier quota limits, incorporating environment overrides if set.
 */
export function getQuotaConfigForTier(tier: UserAccountTier): TierQuotaConfig {
  const defaults = DEFAULT_TIER_QUOTAS[tier] ?? DEFAULT_TIER_QUOTAS.anonymous;

  switch (tier) {
    case "anonymous":
      return {
        tier: "anonymous",
        dailyJobLimit: parseEnvPositiveInt("PDFKIT_QUOTA_ANON_DAILY_JOBS", defaults.dailyJobLimit),
        dailyByteLimit: parseEnvPositiveInt("PDFKIT_QUOTA_ANON_DAILY_BYTES", defaults.dailyByteLimit),
      };
    case "free":
      return {
        tier: "free",
        dailyJobLimit: parseEnvPositiveInt("PDFKIT_QUOTA_FREE_DAILY_JOBS", defaults.dailyJobLimit),
        dailyByteLimit: parseEnvPositiveInt("PDFKIT_QUOTA_FREE_DAILY_BYTES", defaults.dailyByteLimit),
      };
    case "pro":
      return {
        tier: "pro",
        dailyJobLimit: parseEnvPositiveInt("PDFKIT_QUOTA_PRO_DAILY_JOBS", defaults.dailyJobLimit),
        dailyByteLimit: parseEnvPositiveInt("PDFKIT_QUOTA_PRO_DAILY_BYTES", defaults.dailyByteLimit),
      };
    case "business":
      return {
        tier: "business",
        dailyJobLimit: parseEnvPositiveInt("PDFKIT_QUOTA_BUSINESS_DAILY_JOBS", defaults.dailyJobLimit),
        dailyByteLimit: parseEnvPositiveInt("PDFKIT_QUOTA_BUSINESS_DAILY_BYTES", defaults.dailyByteLimit),
      };
    default:
      return defaults;
  }
}
