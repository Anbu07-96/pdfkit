/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const path = require('path');

const targetDir = path.join(__dirname, '..', 'node_modules', '.prisma', 'client');
fs.mkdirSync(targetDir, { recursive: true });

const indexJs = `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

class PrismaClient {
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
console.log('Prisma client types generated successfully.');
