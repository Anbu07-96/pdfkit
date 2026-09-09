-- Phase 66: password reset fields on UserAccount.
-- passwordResetTokenHash stores the SHA-256 hex digest of the one-time
-- reset token (the raw token only ever exists inside the emailed link);
-- passwordResetExpires bounds its validity; passwordResetAt marks the last
-- successful reset so pre-reset JWT sessions can be rejected.
ALTER TABLE "UserAccount" ADD COLUMN "passwordResetTokenHash" TEXT;
ALTER TABLE "UserAccount" ADD COLUMN "passwordResetExpires" TIMESTAMP(3);
ALTER TABLE "UserAccount" ADD COLUMN "passwordResetAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "UserAccount_passwordResetTokenHash_key" ON "UserAccount"("passwordResetTokenHash");
