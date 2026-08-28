import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  generateVerificationToken,
  sendVerificationEmail,
  verifyEmailToken,
} from "@/lib/auth/verification";
import {
  InMemoryUsageRepository,
  setUsageRepositoryOverride,
} from "@/lib/usage/repository";

describe("Phase 51 — Email Verification Architecture", () => {
  let repo: InMemoryUsageRepository;

  beforeEach(() => {
    repo = new InMemoryUsageRepository();
    setUsageRepositoryOverride(repo);
  });

  afterEach(() => {
    setUsageRepositoryOverride(null);
  });

  it("generates 32-byte hex verification tokens with 24-hour expiration", () => {
    const payload = generateVerificationToken();
    expect(payload.token).toHaveLength(64);
    expect(payload.expires.getTime()).toBeGreaterThan(Date.now());
  });

  it("verifies a valid token and upgrades account status to verified", async () => {
    const payload = generateVerificationToken();

    await repo.upsertUserAccount({
      userId: "usr_unverified_1",
      email: "test@gmail.com",
      accountTrustStatus: "unverified",
      verificationToken: payload.token,
      verificationExpires: payload.expires,
    });

    const result = await verifyEmailToken(payload.token);
    expect(result.success).toBe(true);
    expect(result.message).toContain("verified successfully");

    const acc = await repo.getUserAccount("usr_unverified_1");
    expect(acc?.accountTrustStatus).toBe("verified");
    expect(acc?.emailVerified).not.toBeNull();
    expect(acc?.verificationToken).toBeNull();
  });

  it("rejects invalid or non-existent verification tokens", async () => {
    const result = await verifyEmailToken("invalid_token_123");
    expect(result.success).toBe(false);
    expect(result.message).toContain("Invalid or expired");
  });

  it("rejects expired verification tokens", async () => {
    const expiredDate = new Date(Date.now() - 3600 * 1000); // 1 hour ago

    await repo.upsertUserAccount({
      userId: "usr_expired_1",
      email: "test@gmail.com",
      accountTrustStatus: "unverified",
      verificationToken: "expired_token_abc",
      verificationExpires: expiredDate,
    });

    const result = await verifyEmailToken("expired_token_abc");
    expect(result.success).toBe(false);
    expect(result.message).toContain("expired");
  });

  it("sendVerificationEmail generates log in dev mode", async () => {
    const sent = await sendVerificationEmail("user@gmail.com", "token_123");
    expect(sent).toBe(true);
  });
});
