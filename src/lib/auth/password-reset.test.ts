import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  requestPasswordReset,
  confirmPasswordReset,
} from "@/lib/auth/password-reset";
import { sendEmail } from "@/lib/email/transport";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import {
  InMemoryUsageRepository,
  setUsageRepositoryOverride,
} from "@/lib/usage/repository";

/**
 * Phase 66 — password reset security tests: enumeration safety, hashed token
 * storage, expiry, one-time use, session-invalidation stamping.
 */

const EMAIL = "reset-user@phase66.test";
const PASSWORD = "OriginalPass2026";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

describe("Phase 66 — Password reset", () => {
  let repo: InMemoryUsageRepository;

  beforeEach(async () => {
    repo = new InMemoryUsageRepository();
    setUsageRepositoryOverride(repo);
    // Seed a credentials account.
    await repo.upsertUserAccount({
      userId: "usr_reset_test",
      email: EMAIL,
      tier: "free",
      passwordHash: await hashPassword(PASSWORD),
    });
    vi.stubEnv("NODE_ENV", "development");
  });

  afterEach(() => {
    setUsageRepositoryOverride(null);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe("requestPasswordReset", () => {
    it("stores only the SHA-256 hash of the token with a 1-hour expiry", async () => {
      const result = await requestPasswordReset(EMAIL);
      expect(result.accepted).toBe(true);
      expect(result.devToken).toBeDefined(); // development convenience

      const account = await repo.getUserAccount("usr_reset_test");
      expect(account?.passwordResetTokenHash).toBe(sha256(result.devToken!));
      expect(account?.passwordResetTokenHash).not.toBe(result.devToken); // never the raw token
      const msLeft = (account?.passwordResetExpires?.getTime() ?? 0) - Date.now();
      expect(msLeft).toBeGreaterThan(55 * 60 * 1000);
      expect(msLeft).toBeLessThanOrEqual(60 * 60 * 1000);
    });

    it("responds identically for unknown addresses (no enumeration)", async () => {
      const known = await requestPasswordReset(EMAIL);
      const unknown = await requestPasswordReset("nobody-here@example.com");
      // The public contract: both accepted, neither reveals existence.
      expect(known.accepted).toBe(true);
      expect(unknown.accepted).toBe(true);
      expect(unknown.devToken).toBeUndefined(); // nothing was sent for the unknown address
      // And nothing was stored for the unknown address.
      const account = await repo.getUserAccount("usr_reset_test");
      expect(account?.passwordResetTokenHash).toBe(sha256(known.devToken!));
    });

    it("does not create reset tokens for OAuth-only accounts (no password)", async () => {
      await repo.upsertUserAccount({
        userId: "usr_oauth_only",
        email: "oauth-only@example.com",
        tier: "free",
        authProvider: "google",
        passwordHash: null,
      });
      const result = await requestPasswordReset("oauth-only@example.com");
      expect(result.accepted).toBe(true);
      const account = await repo.getUserAccount("usr_oauth_only");
      expect(account?.passwordResetTokenHash).toBeNull();
    });

    it("sends the link by email when SMTP is available", async () => {
      vi.stubEnv("SMTP_HOST", "smtp.test.local");
      const spy = vi
        .spyOn(await import("@/lib/email/transport"), "sendEmail")
        .mockResolvedValue({ delivered: true });
      const result = await requestPasswordReset(EMAIL);
      expect(result.emailSent).toBe(true);
      expect(result.devToken).toBeUndefined(); // no token leaked back to the caller
      expect(spy).toHaveBeenCalledOnce();
      spy.mockRestore();
    });
  });

  describe("confirmPasswordReset", () => {
    async function requestToken(): Promise<string> {
      const result = await requestPasswordReset(EMAIL);
      return result.devToken!;
    }

    it("sets a new scrypt hash, stamps passwordResetAt and clears the token (single use)", async () => {
      const token = await requestToken();
      const result = await confirmPasswordReset(token, "NewSecure2026pass");
      expect(result.success).toBe(true);

      const account = await repo.getUserAccount("usr_reset_test");
      expect(account?.passwordResetTokenHash).toBeNull();
      expect(account?.passwordResetExpires).toBeNull();
      expect(account?.passwordResetAt).toBeDefined();
      // New password verifies; old one does not (auth view exposes the hash).
      const auth = await repo.getUserAccountAuthByEmail(EMAIL);
      expect(await verifyPassword("NewSecure2026pass", auth?.passwordHash ?? null)).toBe(true);
      expect(await verifyPassword(PASSWORD, auth?.passwordHash ?? null)).toBe(false);
    });

    it("rejects a replayed (already used) token", async () => {
      const token = await requestToken();
      await confirmPasswordReset(token, "NewSecure2026pass");
      const replay = await confirmPasswordReset(token, "Another2026pass");
      expect(replay).toMatchObject({ success: false, code: "INVALID_TOKEN" });
    });

    it("rejects an expired token", async () => {
      const token = await requestToken();
      // Force-expire the stored token.
      const account = await repo.getUserAccount("usr_reset_test");
      await repo.upsertUserAccount({
        userId: "usr_reset_test",
        passwordResetExpires: new Date(Date.now() - 1000),
      });
      void account;
      const result = await confirmPasswordReset(token, "NewSecure2026pass");
      expect(result).toMatchObject({ success: false, code: "INVALID_TOKEN" });
    });

    it("rejects a weak new password (policy enforced)", async () => {
      const token = await requestToken();
      const result = await confirmPasswordReset(token, "short");
      expect(result).toMatchObject({ success: false, code: "WEAK_PASSWORD" });
    });

    it("rejects a malformed token outright", async () => {
      const result = await confirmPasswordReset("garbage", "NewSecure2026pass");
      expect(result).toMatchObject({ success: false, code: "INVALID_TOKEN" });
    });
  });
});

describe("Phase 66 — Email transport fail-safe", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns not-delivered (no throw) outside production without SMTP", async () => {
    vi.stubEnv("NODE_ENV", "development");
    delete process.env.SMTP_HOST;
    const result = await sendEmail({ to: "x@example.com", subject: "s", text: "t", html: "t" });
    expect(result.delivered).toBe(false);
    expect(result.reason).toBe("smtp-not-configured");
  });

  it("THROWS in production without SMTP (fail clearly, never pretend)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.SMTP_HOST;
    await expect(
      sendEmail({ to: "x@example.com", subject: "s", text: "t", html: "t" }),
    ).rejects.toThrow(/SMTP_HOST/);
  });
});
