import "server-only";

import type { UserAccountTier } from "@/lib/auth/types";

/**
 * Usage metrics for a specific user during a quota period.
 */
export interface UsageRecord {
  userId: string;
  periodDate: string; // ISO Date "YYYY-MM-DD"
  jobCount: number;
  processedBytes: number;
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * Account quota limits configuration for a tier.
 */
export interface TierQuotaConfig {
  tier: UserAccountTier;
  /** Maximum successful PDF processing jobs allowed per day. */
  dailyJobLimit: number;
  /** Maximum total processed bytes allowed per day. */
  dailyByteLimit: number;
}

export type QuotaRejectionReason =
  | "JOB_LIMIT_EXCEEDED"
  | "BYTE_LIMIT_EXCEEDED"
  | "SERVICE_UNAVAILABLE";

/**
 * Result of preflight quota evaluation before running a job.
 */
export interface QuotaPreflightResult {
  allowed: boolean;
  tier: UserAccountTier;
  periodDate: string;
  currentJobCount: number;
  jobLimit: number;
  remainingJobs: number;
  currentProcessedBytes: number;
  byteLimit: number;
  remainingBytes: number;
  reason?: QuotaRejectionReason;
  message?: string;
}

/**
 * Snapshot of user's account usage and remaining quota for display (e.g. /account page).
 */
export interface UserUsageSummary {
  userId: string;
  tier: UserAccountTier;
  periodDate: string;
  jobsUsed: number;
  dailyJobLimit: number;
  jobsRemaining: number;
  bytesUsed: number;
  dailyByteLimit: number;
  bytesRemaining: number;
}

/**
 * Account metadata persisted in the usage database.
 */
export interface PersistedUserAccount {
  id: string;
  userId: string;
  email: string | null;
  name: string | null;
  tier: UserAccountTier;
  status: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Server persistence repository interface for usage and accounts.
 * Decouples PDFKit processing pipeline from Prisma/PostgreSQL specifics.
 */
export interface UsageRepository {
  /**
   * Fetch current daily usage record for a user in a given period.
   */
  getUsage(userId: string, periodDate: string): Promise<UsageRecord | null>;

  /**
   * Record and atomically increment successful usage for a user.
   */
  recordUsage(params: {
    userId: string;
    periodDate: string;
    jobCountDelta: number;
    bytesDelta: number;
  }): Promise<UsageRecord>;

  /**
   * Get account metadata for a user by userId.
   */
  getUserAccount(userId: string): Promise<PersistedUserAccount | null>;

  /**
   * Get account metadata by Stripe Customer ID.
   */
  getUserAccountByStripeCustomerId(customerId: string): Promise<PersistedUserAccount | null>;

  /**
   * Get account metadata by Stripe Subscription ID.
   */
  getUserAccountByStripeSubscriptionId(subscriptionId: string): Promise<PersistedUserAccount | null>;

  /**
   * Save or update account metadata for a user.
   */
  upsertUserAccount(account: {
    userId: string;
    email?: string | null;
    name?: string | null;
    tier?: UserAccountTier;
    status?: string;
    stripeCustomerId?: string | null;
    stripeSubscriptionId?: string | null;
  }): Promise<PersistedUserAccount>;

  /**
   * Check whether a Stripe webhook event ID has already been processed (idempotency).
   */
  hasProcessedStripeEvent(eventId: string): Promise<boolean>;

  /**
   * Record a processed Stripe webhook event ID for idempotency tracking.
   */
  recordStripeEvent(eventId: string, eventType: string): Promise<void>;

  /**
   * Reset repository state (used for testing).
   */
  reset?(): Promise<void>;
}
