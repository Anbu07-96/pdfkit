/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Development fallback Prisma client stub (Phase 64 rework).
 *
 * Why this exists: PDFKit must typecheck and run its unit test suite in
 * environments where `prisma generate` cannot run (no network access to
 * binaries.prisma.sh, no DATABASE_URL). This script writes a minimal no-op
 * PrismaClient + types into node_modules/.prisma/client for that case.
 *
 * Phase 64 safety rules:
 *   1. If a REAL generated client is already present (someone ran
 *      `npx prisma generate`), it is NEVER overwritten — previous behavior
 *      silently replaced the real client with a no-op stub on every
 *      `npm install`, which would disable all database persistence in
 *      production while appearing healthy.
 *   2. The stub is unambiguously marked (static `PrismaClient.PDFKIT_STUB`
 *      and the `PDFKIT-STUB-CLIENT` marker file). Runtime code
 *      (src/lib/usage/repository.ts) refuses to use it when DATABASE_URL is
 *      configured, so a mis-configured deployment fails loudly at startup
 *      instead of silently dropping usage metering.
 *   3. `PDFKIT_SKIP_PRISMA_STUB=1` skips writing the stub entirely.
 */
const fs = require('fs');
const path = require('path');

const targetDir = path.join(__dirname, '..', 'node_modules', '.prisma', 'client');

if (process.env.PDFKIT_SKIP_PRISMA_STUB === '1') {
  console.log('Prisma stub generation skipped (PDFKIT_SKIP_PRISMA_STUB=1).');
  process.exit(0);
}

const stubMarkerFile = path.join(targetDir, 'PDFKIT-STUB-CLIENT');
const realIndex = path.join(targetDir, 'index.js');

if (fs.existsSync(realIndex) && !fs.existsSync(stubMarkerFile)) {
  // A real `prisma generate` output is present — keep it.
  console.log(
    'Real Prisma client detected (node_modules/.prisma/client) — keeping it; stub not written.',
  );
  process.exit(0);
}

fs.mkdirSync(targetDir, { recursive: true });

const indexJs = `"use strict";
// PDFKIT-STUB-CLIENT — development no-op fallback; NOT a real Prisma client.
// Written by scripts/generate-prisma-client.js when no real client exists.
Object.defineProperty(exports, "__esModule", { value: true });

class PrismaClient {
  // Marker checked by src/lib/usage/repository.ts: a deployment that sets
  // DATABASE_URL must never run this stub (fail-closed at startup).
  static PDFKIT_STUB = true;
  constructor(options) {
    this.options = options || {};
  }
  async $connect() {}
  async $disconnect() {}
  async $transaction(fn) {
    if (typeof fn === 'function') {
      return fn(this);
    }
    return Promise.all(fn);
  }
  userAccount = {
    findUnique: async () => null,
    findFirst: async () => null,
    upsert: async () => ({}),
    create: async () => ({}),
    update: async () => ({}),
  };
  dailyUsage = {
    findUnique: async () => null,
    upsert: async () => ({}),
    create: async () => ({}),
    update: async () => ({}),
  };
  razorpayWebhookEvent = {
    findUnique: async () => null,
    create: async () => ({}),
  };
}

exports.PrismaClient = PrismaClient;
exports.Prisma = {
  PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {},
};
`;

const indexDts = `export interface UserAccount {
  id: string;
  userId: string;
  email: string | null;
  name: string | null;
  tier: string;
  status: string;
  accountTrustStatus: string;
  authProvider: string | null;
  emailVerified: Date | null;
  verificationToken: string | null;
  verificationExpires: Date | null;
  billingProvider: string | null;
  razorpayCustomerId: string | null;
  razorpaySubscriptionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DailyUsage {
  id: string;
  userId: string;
  periodDate: string;
  jobCount: number;
  processedBytes: bigint;
  createdAt: Date;
  updatedAt: Date;
}

export interface RazorpayWebhookEvent {
  id: string;
  eventType: string;
  createdAt: Date;
}

export interface UserAccountWhereUniqueInput {
  id?: string;
  userId?: string;
  verificationToken?: string;
  razorpayCustomerId?: string;
  razorpaySubscriptionId?: string;
}

export interface UserAccountCreateInput {
  id?: string;
  userId: string;
  email?: string | null;
  name?: string | null;
  tier?: string;
  status?: string;
  accountTrustStatus?: string;
  authProvider?: string | null;
  emailVerified?: Date | null;
  verificationToken?: string | null;
  verificationExpires?: Date | null;
  billingProvider?: string | null;
  razorpayCustomerId?: string | null;
  razorpaySubscriptionId?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface UserAccountUpdateInput {
  email?: string | null;
  name?: string | null;
  tier?: string;
  status?: string;
  accountTrustStatus?: string;
  authProvider?: string | null;
  emailVerified?: Date | null;
  verificationToken?: string | null;
  verificationExpires?: Date | null;
  billingProvider?: string | null;
  razorpayCustomerId?: string | null;
  razorpaySubscriptionId?: string | null;
}

export interface DailyUsageWhereUniqueInput {
  id?: string;
  userId_periodDate?: {
    userId: string;
    periodDate: string;
  };
}

export interface DailyUsageCreateInput {
  id?: string;
  userId: string;
  periodDate: string;
  jobCount?: number;
  processedBytes?: bigint | number;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface DailyUsageUpdateInput {
  jobCount?: number | { increment?: number };
  processedBytes?: bigint | number | { increment?: bigint | number };
}

export declare class PrismaClient {
  /** Development stub marker — true only for the no-op fallback client. */
  static readonly PDFKIT_STUB: true;
  constructor(options?: any);
  $connect(): Promise<void>;
  $disconnect(): Promise<void>;
  $transaction<T>(fn: (prisma: PrismaClient) => Promise<T>): Promise<T>;
  userAccount: {
    findUnique(args: { where: UserAccountWhereUniqueInput }): Promise<UserAccount | null>;
    findFirst(args: { where: UserAccountWhereUniqueInput }): Promise<UserAccount | null>;
    upsert(args: {
      where: UserAccountWhereUniqueInput;
      create: UserAccountCreateInput;
      update: UserAccountUpdateInput;
    }): Promise<UserAccount>;
    create(args: { data: UserAccountCreateInput }): Promise<UserAccount>;
    update(args: { where: UserAccountWhereUniqueInput; data: UserAccountUpdateInput }): Promise<UserAccount>;
  };
  dailyUsage: {
    findUnique(args: { where: DailyUsageWhereUniqueInput }): Promise<DailyUsage | null>;
    upsert(args: {
      where: DailyUsageWhereUniqueInput;
      create: DailyUsageCreateInput;
      update: DailyUsageUpdateInput;
    }): Promise<DailyUsage>;
    create(args: { data: DailyUsageCreateInput }): Promise<DailyUsage>;
    update(args: { where: DailyUsageWhereUniqueInput; data: DailyUsageUpdateInput }): Promise<DailyUsage>;
  };
  razorpayWebhookEvent: {
    findUnique(args: { where: { id: string } }): Promise<RazorpayWebhookEvent | null>;
    create(args: { data: { id: string; eventType: string } }): Promise<RazorpayWebhookEvent>;
  };
}

export declare namespace Prisma {
  export class PrismaClientKnownRequestError extends Error {
    code: string;
  }
}
`;

fs.writeFileSync(path.join(targetDir, 'index.js'), indexJs);
fs.writeFileSync(path.join(targetDir, 'default.js'), indexJs);
fs.writeFileSync(path.join(targetDir, 'index.d.ts'), indexDts);
fs.writeFileSync(path.join(targetDir, 'default.d.ts'), indexDts);
fs.writeFileSync(stubMarkerFile, 'development no-op stub client\n');
console.log(
  'Prisma client stub written (development fallback). ' +
    'Run `npx prisma generate` before any deployment that sets DATABASE_URL ' +
    '(see docs/staging-deployment.md).',
);
