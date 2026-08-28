import "server-only";

import { PrismaClient } from "@prisma/client";
import { ProcessingError } from "@/lib/processing/errors";
import type { UserAccountTier } from "@/lib/auth/types";
import type {
  PersistedUserAccount,
  UsageRecord,
  UsageRepository,
} from "@/lib/usage/types";

let globalPrisma: PrismaClient | null = null;

function getPrismaClient(): PrismaClient {
  if (!globalPrisma) {
    globalPrisma = new PrismaClient();
  }
  return globalPrisma;
}

/**
 * In-memory usage repository for unit testing and local development
 * when PostgreSQL is unconfigured.
 */
export class InMemoryUsageRepository implements UsageRepository {
  private usages = new Map<string, UsageRecord>();
  private accounts = new Map<string, PersistedUserAccount>();
  private razorpayEvents = new Map<string, string>();

  private usageKey(userId: string, periodDate: string): string {
    return `${userId}:${periodDate}`;
  }

  async getUsage(userId: string, periodDate: string): Promise<UsageRecord | null> {
    const key = this.usageKey(userId, periodDate);
    const existing = this.usages.get(key);
    return existing ? { ...existing } : null;
  }

  async recordUsage(params: {
    userId: string;
    periodDate: string;
    jobCountDelta: number;
    bytesDelta: number;
  }): Promise<UsageRecord> {
    const key = this.usageKey(params.userId, params.periodDate);
    const existing = this.usages.get(key) || {
      userId: params.userId,
      periodDate: params.periodDate,
      jobCount: 0,
      processedBytes: 0,
      createdAt: new Date(),
    };

    const updated: UsageRecord = {
      ...existing,
      jobCount: existing.jobCount + params.jobCountDelta,
      processedBytes: existing.processedBytes + params.bytesDelta,
      updatedAt: new Date(),
    };

    this.usages.set(key, updated);
    return { ...updated };
  }

  async getUserAccount(userId: string): Promise<PersistedUserAccount | null> {
    const account = this.accounts.get(userId);
    return account ? { ...account } : null;
  }

  async getUserAccountByVerificationToken(token: string): Promise<PersistedUserAccount | null> {
    for (const account of this.accounts.values()) {
      if (account.verificationToken === token) {
        return { ...account };
      }
    }
    return null;
  }

  async getUserAccountByRazorpayCustomerId(customerId: string): Promise<PersistedUserAccount | null> {
    for (const account of this.accounts.values()) {
      if (account.razorpayCustomerId === customerId) {
        return { ...account };
      }
    }
    return null;
  }

  async getUserAccountByRazorpaySubscriptionId(subscriptionId: string): Promise<PersistedUserAccount | null> {
    for (const account of this.accounts.values()) {
      if (account.razorpaySubscriptionId === subscriptionId) {
        return { ...account };
      }
    }
    return null;
  }

  async upsertUserAccount(account: {
    userId: string;
    email?: string | null;
    name?: string | null;
    tier?: UserAccountTier;
    status?: string;
    accountTrustStatus?: string;
    authProvider?: string | null;
    emailVerified?: Date | null;
    verificationToken?: string | null;
    verificationExpires?: Date | null;
    billingProvider?: string | null;
    razorpayCustomerId?: string | null;
    razorpaySubscriptionId?: string | null;
  }): Promise<PersistedUserAccount> {
    const existing = this.accounts.get(account.userId);
    const now = new Date();

    const updated: PersistedUserAccount = {
      id: existing?.id || `usr_acc_${account.userId}`,
      userId: account.userId,
      email: account.email !== undefined ? account.email : existing?.email || null,
      name: account.name !== undefined ? account.name : existing?.name || null,
      tier: account.tier || existing?.tier || "free",
      status: account.status || existing?.status || "active",
      accountTrustStatus:
        account.accountTrustStatus || existing?.accountTrustStatus || "unverified",
      authProvider:
        account.authProvider !== undefined
          ? account.authProvider
          : existing?.authProvider || "credentials",
      emailVerified:
        account.emailVerified !== undefined
          ? account.emailVerified
          : existing?.emailVerified || null,
      verificationToken:
        account.verificationToken !== undefined
          ? account.verificationToken
          : existing?.verificationToken || null,
      verificationExpires:
        account.verificationExpires !== undefined
          ? account.verificationExpires
          : existing?.verificationExpires || null,
      billingProvider:
        account.billingProvider !== undefined
          ? account.billingProvider
          : existing?.billingProvider || "razorpay",
      razorpayCustomerId:
        account.razorpayCustomerId !== undefined
          ? account.razorpayCustomerId
          : existing?.razorpayCustomerId || null,
      razorpaySubscriptionId:
        account.razorpaySubscriptionId !== undefined
          ? account.razorpaySubscriptionId
          : existing?.razorpaySubscriptionId || null,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    this.accounts.set(account.userId, updated);
    return { ...updated };
  }

  async hasProcessedRazorpayEvent(eventId: string): Promise<boolean> {
    return this.razorpayEvents.has(eventId);
  }

  async recordRazorpayEvent(eventId: string, eventType: string): Promise<void> {
    this.razorpayEvents.set(eventId, eventType);
  }

  async reset(): Promise<void> {
    this.usages.clear();
    this.accounts.clear();
    this.razorpayEvents.clear();
  }
}

/**
 * PostgreSQL + Prisma implementation of UsageRepository.
 * Enforces atomic database updates for concurrent job execution.
 */
export class PrismaUsageRepository implements UsageRepository {
  private prisma: PrismaClient;

  constructor(client?: PrismaClient) {
    this.prisma = client || getPrismaClient();
  }

  private handleDbError(error: unknown): never {
    console.error("[usage] PostgreSQL database operation failed", error);
    if (process.env.NODE_ENV === "production") {
      throw new ProcessingError(
        "USAGE_SERVICE_UNAVAILABLE",
        "Usage tracking service is temporarily unavailable. Please try again later.",
        { cause: error },
      );
    }
    throw error;
  }

  async getUsage(userId: string, periodDate: string): Promise<UsageRecord | null> {
    try {
      const record = await this.prisma.dailyUsage.findUnique({
        where: {
          userId_periodDate: { userId, periodDate },
        },
      });

      if (!record) return null;

      return {
        userId: record.userId,
        periodDate: record.periodDate,
        jobCount: record.jobCount,
        processedBytes: Number(record.processedBytes),
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      };
    } catch (error) {
      this.handleDbError(error);
    }
  }

  async recordUsage(params: {
    userId: string;
    periodDate: string;
    jobCountDelta: number;
    bytesDelta: number;
  }): Promise<UsageRecord> {
    try {
      const record = await this.prisma.dailyUsage.upsert({
        where: {
          userId_periodDate: {
            userId: params.userId,
            periodDate: params.periodDate,
          },
        },
        create: {
          userId: params.userId,
          periodDate: params.periodDate,
          jobCount: params.jobCountDelta,
          processedBytes: BigInt(params.bytesDelta),
        },
        update: {
          jobCount: { increment: params.jobCountDelta },
          processedBytes: { increment: BigInt(params.bytesDelta) },
        },
      });

      return {
        userId: record.userId,
        periodDate: record.periodDate,
        jobCount: record.jobCount,
        processedBytes: Number(record.processedBytes),
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      };
    } catch (error) {
      this.handleDbError(error);
    }
  }

  async getUserAccount(userId: string): Promise<PersistedUserAccount | null> {
    try {
      const acc = await this.prisma.userAccount.findUnique({
        where: { userId },
      });

      if (!acc) return null;

      return {
        id: acc.id,
        userId: acc.userId,
        email: acc.email,
        name: acc.name,
        tier: acc.tier as UserAccountTier,
        status: acc.status,
        accountTrustStatus: acc.accountTrustStatus,
        authProvider: acc.authProvider,
        emailVerified: acc.emailVerified,
        verificationToken: acc.verificationToken,
        verificationExpires: acc.verificationExpires,
        billingProvider: acc.billingProvider,
        razorpayCustomerId: acc.razorpayCustomerId,
        razorpaySubscriptionId: acc.razorpaySubscriptionId,
        createdAt: acc.createdAt,
        updatedAt: acc.updatedAt,
      };
    } catch (error) {
      this.handleDbError(error);
    }
  }

  async getUserAccountByVerificationToken(token: string): Promise<PersistedUserAccount | null> {
    try {
      const acc = await this.prisma.userAccount.findUnique({
        where: { verificationToken: token },
      });

      if (!acc) return null;

      return {
        id: acc.id,
        userId: acc.userId,
        email: acc.email,
        name: acc.name,
        tier: acc.tier as UserAccountTier,
        status: acc.status,
        accountTrustStatus: acc.accountTrustStatus,
        authProvider: acc.authProvider,
        emailVerified: acc.emailVerified,
        verificationToken: acc.verificationToken,
        verificationExpires: acc.verificationExpires,
        billingProvider: acc.billingProvider,
        razorpayCustomerId: acc.razorpayCustomerId,
        razorpaySubscriptionId: acc.razorpaySubscriptionId,
        createdAt: acc.createdAt,
        updatedAt: acc.updatedAt,
      };
    } catch (error) {
      this.handleDbError(error);
    }
  }

  async getUserAccountByRazorpayCustomerId(customerId: string): Promise<PersistedUserAccount | null> {
    try {
      const acc = await this.prisma.userAccount.findUnique({
        where: { razorpayCustomerId: customerId },
      });

      if (!acc) return null;

      return {
        id: acc.id,
        userId: acc.userId,
        email: acc.email,
        name: acc.name,
        tier: acc.tier as UserAccountTier,
        status: acc.status,
        accountTrustStatus: acc.accountTrustStatus,
        authProvider: acc.authProvider,
        emailVerified: acc.emailVerified,
        verificationToken: acc.verificationToken,
        verificationExpires: acc.verificationExpires,
        billingProvider: acc.billingProvider,
        razorpayCustomerId: acc.razorpayCustomerId,
        razorpaySubscriptionId: acc.razorpaySubscriptionId,
        createdAt: acc.createdAt,
        updatedAt: acc.updatedAt,
      };
    } catch (error) {
      this.handleDbError(error);
    }
  }

  async getUserAccountByRazorpaySubscriptionId(subscriptionId: string): Promise<PersistedUserAccount | null> {
    try {
      const acc = await this.prisma.userAccount.findUnique({
        where: { razorpaySubscriptionId: subscriptionId },
      });

      if (!acc) return null;

      return {
        id: acc.id,
        userId: acc.userId,
        email: acc.email,
        name: acc.name,
        tier: acc.tier as UserAccountTier,
        status: acc.status,
        accountTrustStatus: acc.accountTrustStatus,
        authProvider: acc.authProvider,
        emailVerified: acc.emailVerified,
        verificationToken: acc.verificationToken,
        verificationExpires: acc.verificationExpires,
        billingProvider: acc.billingProvider,
        razorpayCustomerId: acc.razorpayCustomerId,
        razorpaySubscriptionId: acc.razorpaySubscriptionId,
        createdAt: acc.createdAt,
        updatedAt: acc.updatedAt,
      };
    } catch (error) {
      this.handleDbError(error);
    }
  }

  async upsertUserAccount(account: {
    userId: string;
    email?: string | null;
    name?: string | null;
    tier?: UserAccountTier;
    status?: string;
    accountTrustStatus?: string;
    authProvider?: string | null;
    emailVerified?: Date | null;
    verificationToken?: string | null;
    verificationExpires?: Date | null;
    billingProvider?: string | null;
    razorpayCustomerId?: string | null;
    razorpaySubscriptionId?: string | null;
  }): Promise<PersistedUserAccount> {
    try {
      const acc = await this.prisma.userAccount.upsert({
        where: { userId: account.userId },
        create: {
          userId: account.userId,
          email: account.email ?? null,
          name: account.name ?? null,
          tier: account.tier || "free",
          status: account.status || "active",
          accountTrustStatus: account.accountTrustStatus || "unverified",
          authProvider: account.authProvider ?? "credentials",
          emailVerified: account.emailVerified ?? null,
          verificationToken: account.verificationToken ?? null,
          verificationExpires: account.verificationExpires ?? null,
          billingProvider: account.billingProvider ?? "razorpay",
          razorpayCustomerId: account.razorpayCustomerId ?? null,
          razorpaySubscriptionId: account.razorpaySubscriptionId ?? null,
        },
        update: {
          ...(account.email !== undefined ? { email: account.email } : {}),
          ...(account.name !== undefined ? { name: account.name } : {}),
          ...(account.tier !== undefined ? { tier: account.tier } : {}),
          ...(account.status !== undefined ? { status: account.status } : {}),
          ...(account.accountTrustStatus !== undefined
            ? { accountTrustStatus: account.accountTrustStatus }
            : {}),
          ...(account.authProvider !== undefined ? { authProvider: account.authProvider } : {}),
          ...(account.emailVerified !== undefined ? { emailVerified: account.emailVerified } : {}),
          ...(account.verificationToken !== undefined
            ? { verificationToken: account.verificationToken }
            : {}),
          ...(account.verificationExpires !== undefined
            ? { verificationExpires: account.verificationExpires }
            : {}),
          ...(account.billingProvider !== undefined ? { billingProvider: account.billingProvider } : {}),
          ...(account.razorpayCustomerId !== undefined
            ? { razorpayCustomerId: account.razorpayCustomerId }
            : {}),
          ...(account.razorpaySubscriptionId !== undefined
            ? { razorpaySubscriptionId: account.razorpaySubscriptionId }
            : {}),
        },
      });

      return {
        id: acc.id,
        userId: acc.userId,
        email: acc.email,
        name: acc.name,
        tier: acc.tier as UserAccountTier,
        status: acc.status,
        accountTrustStatus: acc.accountTrustStatus,
        authProvider: acc.authProvider,
        emailVerified: acc.emailVerified,
        verificationToken: acc.verificationToken,
        verificationExpires: acc.verificationExpires,
        billingProvider: acc.billingProvider,
        razorpayCustomerId: acc.razorpayCustomerId,
        razorpaySubscriptionId: acc.razorpaySubscriptionId,
        createdAt: acc.createdAt,
        updatedAt: acc.updatedAt,
      };
    } catch (error) {
      this.handleDbError(error);
    }
  }

  async hasProcessedRazorpayEvent(eventId: string): Promise<boolean> {
    try {
      const found = await this.prisma.razorpayWebhookEvent.findUnique({
        where: { id: eventId },
      });
      return found !== null;
    } catch (error) {
      this.handleDbError(error);
    }
  }

  async recordRazorpayEvent(eventId: string, eventType: string): Promise<void> {
    try {
      await this.prisma.razorpayWebhookEvent.create({
        data: { id: eventId, eventType },
      });
    } catch (error) {
      this.handleDbError(error);
    }
  }

  async reset(): Promise<void> {
    // No-op for Prisma repository in production
  }
}

let activeRepositoryOverride: UsageRepository | null = null;
const inMemoryFallbackRepo = new InMemoryUsageRepository();

/**
 * Set an explicit repository instance (primarily used for unit testing).
 */
export function setUsageRepositoryOverride(repo: UsageRepository | null): void {
  activeRepositoryOverride = repo;
}

/**
 * Resolves the active UsageRepository instance.
 *
 * Uses explicit override if set, PrismaUsageRepository if DATABASE_URL is configured,
 * or InMemoryUsageRepository for local development/testing.
 */
export function getUsageRepository(): UsageRepository {
  if (activeRepositoryOverride) {
    return activeRepositoryOverride;
  }

  const dbUrl = process.env.DATABASE_URL;
  const forceInMemory = process.env.PDFKIT_USE_IN_MEMORY_USAGE_REPO === "true";

  if (dbUrl && !forceInMemory) {
    return new PrismaUsageRepository();
  }

  if (process.env.NODE_ENV === "production" && !dbUrl) {
    const unconfiguredErr = () => {
      throw new ProcessingError(
        "USAGE_SERVICE_UNAVAILABLE",
        "Usage database is not configured.",
      );
    };
    return {
      getUsage: async () => unconfiguredErr(),
      recordUsage: async () => unconfiguredErr(),
      getUserAccount: async () => unconfiguredErr(),
      getUserAccountByVerificationToken: async () => unconfiguredErr(),
      getUserAccountByRazorpayCustomerId: async () => unconfiguredErr(),
      getUserAccountByRazorpaySubscriptionId: async () => unconfiguredErr(),
      upsertUserAccount: async () => unconfiguredErr(),
      hasProcessedRazorpayEvent: async () => unconfiguredErr(),
      recordRazorpayEvent: async () => unconfiguredErr(),
    };
  }

  return inMemoryFallbackRepo;
}
