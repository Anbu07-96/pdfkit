import "server-only";

import { randomBytes } from "node:crypto";
import { sendEmail, isEmailTransportError } from "@/lib/email/transport";
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
 * Provider-neutral email transport (Phase 66): real SMTP delivery when
 * configured; a clean "not delivered" signal otherwise. In development the
 * one-time link is logged for local testing (no PII in the line); in
 * production a missing SMTP configuration fails loudly.
 */
export async function sendVerificationEmail(
  email: string,
  token: string,
): Promise<boolean> {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  const verifyUrl = `${siteUrl}/api/auth/verify?token=${token}`;

  const result = await sendEmail({
    to: email,
    subject: "Verify your PDFKit email address",
    text: `Welcome to PDFKit!\n\nConfirm your email address to finish setting up your account:\n${verifyUrl}\n\nThis link expires in 24 hours and can only be used once.\n\nIf you did not create a PDFKit account, you can ignore this email.`,
    html: `<p>Welcome to PDFKit!</p><p>Confirm your email address to finish setting up your account:</p><p><a href="${verifyUrl}">Verify my email</a></p><p>This link expires in 24 hours and can only be used once.</p><p>If you did not create a PDFKit account, you can ignore this email.</p>`,
  }).catch((error: unknown) => {
    if (isEmailTransportError(error) && process.env.NODE_ENV !== "production") {
      return { delivered: false as const, reason: "smtp-not-configured" as const };
    }
    throw error;
  });

  if (!result.delivered) {
    // No email address in logs (Phase 65 privacy review): the link token is
    // a single-use secret that expires in 24h; the address itself is PII.
    console.info(`[auth-email] Verification link generated (SMTP not configured): ${verifyUrl}`);
  }
  return true;
}
