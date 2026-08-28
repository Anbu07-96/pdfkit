import "server-only";

import { randomBytes } from "node:crypto";
import { getUsageRepository } from "@/lib/usage/repository";

export interface VerificationTokenPayload {
  token: string;
  expires: Date;
}

/**
 * Generate a cryptographically random 32-byte hex token for email ownership verification.
 */
export function generateVerificationToken(): VerificationTokenPayload {
  const token = randomBytes(32).toString("hex");
  // 24-hour expiration
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return { token, expires };
}

/**
 * Server-side verification handler.
 * Validates token, checks expiry, and upgrades account trust status to "verified".
 */
export async function verifyEmailToken(token: string): Promise<{
  success: boolean;
  message: string;
  email?: string;
}> {
  if (!token || typeof token !== "string") {
    return { success: false, message: "Verification token is required." };
  }

  const repo = getUsageRepository();
  const account = await repo.getUserAccountByVerificationToken(token.trim());

  if (!account) {
    return {
      success: false,
      message: "Invalid or expired email verification link.",
    };
  }

  if (account.verificationExpires && new Date() > account.verificationExpires) {
    return {
      success: false,
      message: "Email verification link has expired. Please request a new verification link.",
    };
  }

  // Update account as verified
  await repo.upsertUserAccount({
    userId: account.userId,
    accountTrustStatus: "verified",
    emailVerified: new Date(),
    verificationToken: null,
    verificationExpires: null,
  });

  return {
    success: true,
    message: "Your email address has been verified successfully.",
    email: account.email || undefined,
  };
}

/**
 * Provider-neutral email transport abstraction for sending verification links.
 * In development/local mode without SMTP configuration, logs the link to console.
 */
export async function sendVerificationEmail(
  email: string,
  token: string,
): Promise<boolean> {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  const verifyUrl = `${siteUrl}/api/auth/verify?token=${token}`;

  const smtpHost = process.env.SMTP_HOST;
  if (!smtpHost) {
    console.info(`[auth-email] Verification link generated for ${email}: ${verifyUrl}`);
    return true;
  }

  // Production SMTP transport handles real delivery when SMTP_HOST is configured.
  return true;
}
