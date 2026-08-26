-- CreateTable
CREATE TABLE "UserAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT,
    "name" TEXT,
    "tier" TEXT NOT NULL DEFAULT 'free',
    "status" TEXT NOT NULL DEFAULT 'active',
    "accountTrustStatus" TEXT NOT NULL DEFAULT 'unverified',
    "authProvider" TEXT DEFAULT 'credentials',
    "emailVerified" TIMESTAMP(3),
    "verificationToken" TEXT,
    "verificationExpires" TIMESTAMP(3),
    "billingProvider" TEXT DEFAULT 'razorpay',
    "razorpayCustomerId" TEXT,
    "razorpaySubscriptionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyUsage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "periodDate" TEXT NOT NULL,
    "jobCount" INTEGER NOT NULL DEFAULT 0,
    "processedBytes" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RazorpayWebhookEvent" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RazorpayWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserAccount_userId_key" ON "UserAccount"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserAccount_verificationToken_key" ON "UserAccount"("verificationToken");

-- CreateIndex
CREATE UNIQUE INDEX "UserAccount_razorpayCustomerId_key" ON "UserAccount"("razorpayCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "UserAccount_razorpaySubscriptionId_key" ON "UserAccount"("razorpaySubscriptionId");

-- CreateIndex
CREATE INDEX "UserAccount_userId_idx" ON "UserAccount"("userId");

-- CreateIndex
CREATE INDEX "UserAccount_verificationToken_idx" ON "UserAccount"("verificationToken");

-- CreateIndex
CREATE INDEX "UserAccount_razorpayCustomerId_idx" ON "UserAccount"("razorpayCustomerId");

-- CreateIndex
CREATE INDEX "UserAccount_razorpaySubscriptionId_idx" ON "UserAccount"("razorpaySubscriptionId");

-- CreateIndex
CREATE INDEX "DailyUsage_userId_periodDate_idx" ON "DailyUsage"("userId", "periodDate");

-- CreateIndex
CREATE INDEX "DailyUsage_periodDate_idx" ON "DailyUsage"("periodDate");

-- CreateIndex
CREATE UNIQUE INDEX "DailyUsage_userId_periodDate_key" ON "DailyUsage"("userId", "periodDate");

-- AddForeignKey
ALTER TABLE "DailyUsage" ADD CONSTRAINT "DailyUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "UserAccount"("userId") ON DELETE CASCADE ON UPDATE CASCADE;
