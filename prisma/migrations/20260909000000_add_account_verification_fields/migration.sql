/*
  Phase 64 (2026-09-09): add account verification columns.

  Why this migration is genuinely required:
  The application's account persistence contract (PersistedUserAccount in
  src/lib/usage/types.ts) and the email-verification flow
  (src/lib/auth/verification.ts: token lookup, expiry check, verified
  upgrade) reference five UserAccount columns that the initial migration
  (20260826000000_init) never created. The development stub Prisma client
  hand-declared them in its .d.ts, so typechecking passed while the real
  generated client — and any real PostgreSQL database — would reject every
  query touching them (email verification would fail on real PostgreSQL).

  Additive only: new columns are nullable or have defaults, so the ALTERs
  are safe on databases that already ran the initial migration. No column
  is renamed, dropped or retyped; no data is lost.
*/

-- AddColumn
ALTER TABLE "UserAccount" ADD COLUMN "accountTrustStatus" TEXT NOT NULL DEFAULT 'unverified';
ALTER TABLE "UserAccount" ADD COLUMN "authProvider" TEXT DEFAULT 'credentials';
ALTER TABLE "UserAccount" ADD COLUMN "emailVerified" TIMESTAMP(3);
ALTER TABLE "UserAccount" ADD COLUMN "verificationToken" TEXT;
ALTER TABLE "UserAccount" ADD COLUMN "verificationExpires" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "UserAccount_verificationToken_key" ON "UserAccount"("verificationToken");
