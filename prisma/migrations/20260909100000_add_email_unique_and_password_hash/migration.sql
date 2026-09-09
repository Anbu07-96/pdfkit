/*
  Phase 65 (2026-09-09): real credentials authentication.

  Why this migration is genuinely required:
  Registration previously called signIn() directly — no account record with a
  password was ever stored, and authorize() minted a session for ANY
  policy-valid email/password pair (email-only account access). Fixing that
  requires (a) a password hash column on UserAccount and (b) a UNIQUE index
  on email so an email address maps to exactly one credentials account.

  Additive only: new nullable column + new unique index. PostgreSQL treats
  NULLs as distinct, so anonymous placeholder accounts (email = NULL) are
  unaffected. A database with pre-existing duplicate non-null emails would
  fail this migration loudly — none exists (staging databases are created by
  migrations from scratch; production has never run).
*/

-- AddColumn
ALTER TABLE "UserAccount" ADD COLUMN "passwordHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "UserAccount_email_key" ON "UserAccount"("email");
