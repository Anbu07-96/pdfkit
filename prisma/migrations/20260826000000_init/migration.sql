-- CreateTable
CREATE TABLE "UserAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT,
    "name" TEXT,
    "tier" TEXT NOT NULL DEFAULT 'free',
    "status" TEXT NOT NULL DEFAULT 'active',
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
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
CREATE TABLE "StripeWebhookEvent" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StripeWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserAccount_userId_key" ON "UserAccount"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserAccount_stripeCustomerId_key" ON "UserAccount"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "UserAccount_stripeSubscriptionId_key" ON "UserAccount"("stripeSubscriptionId");

-- CreateIndex
CREATE INDEX "UserAccount_userId_idx" ON "UserAccount"("userId");

-- CreateIndex
CREATE INDEX "UserAccount_stripeCustomerId_idx" ON "UserAccount"("stripeCustomerId");

-- CreateIndex
CREATE INDEX "UserAccount_stripeSubscriptionId_idx" ON "UserAccount"("stripeSubscriptionId");

-- CreateIndex
CREATE INDEX "DailyUsage_userId_periodDate_idx" ON "DailyUsage"("userId", "periodDate");

-- CreateIndex
CREATE INDEX "DailyUsage_periodDate_idx" ON "DailyUsage"("periodDate");

-- CreateIndex
CREATE UNIQUE INDEX "DailyUsage_userId_periodDate_key" ON "DailyUsage"("userId", "periodDate");

-- AddForeignKey
ALTER TABLE "DailyUsage" ADD CONSTRAINT "DailyUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "UserAccount"("userId") ON DELETE CASCADE ON UPDATE CASCADE;
