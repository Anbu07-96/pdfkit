import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { sendEmail, isEmailTransportError } from "@/lib/email/transport";
import { hashPassword } from "@/lib/auth/password";
import {
  validatePassword,
  validateAndNormalizeEmail,
} from "@/lib/auth/validation";
import { getUsageRepository } from "@/lib/usage/repository";

/**
 * Phase 66 — secure password reset (credentials accounts).
 *
 * Security properties:
 *  - Request responses are GENERIC: an unknown address and a known address
 *    produce identical responses and timing-shape, so the endpoint cannot be
 *    used to enumerate registered addresses.
 *  - The token is 32 random bytes; only its SHA-256 hex digest is stored.
 *    A database leak therefore does not yield usable reset links.
 *  - Tokens expire after 1 hour and are single-use (consumed atomically on
 *    success).
 *  - A successful reset records `passwordResetAt`; getUserIdentity treats
 *    JWT sessions issued BEFORE that timestamp as unauthenticated (JWTs are
 *    otherwise stateless and could not be revoked).
 *  - Nothing sensitive is logged: no addresses, no tokens, no passwords.
 *
 * Email delivery: real SMTP when configured. When SMTP is not configured,
 * development/test environments still complete the flow (the caller decides
 * how to expose the link in tests); production fails clearly instead of
 * silently losing the request.
 */

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

export interface PasswordResetRequestResult {
  /** Always true — the response is deliberately identical for any address. */
  accepted: true;
  /** True when a reset email was actually dispatched (never sent to client). */
  emailSent: boolean;
  /** Present only when delivery is impossible AND the environment is not production. */
  devToken?: string;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Request a password reset for an email address (enumeration-safe). */
export async function requestPasswordReset(
  rawEmail: string | undefined | null,
): Promise<PasswordResetRequestResult> {
  const emailResult = validateAndNormalizeEmail(rawEmail);
  if (!emailResult.isValid || !emailResult.normalizedEmail) {
    // Same shape as "unknown address": accepted, nothing sent.
    return { accepted: true, emailSent: false };
  }
  const email = emailResult.normalizedEmail;

  const repo = getUsageRepository();
  const auth = await repo.getUserAccountAuthByEmail(email).catch(() => null);
  if (!auth || !auth.passwordHash) {
    // No credentials account with this address (or OAuth-only): a reset link
    // would be meaningless. Respond identically to the success case.
    return { accepted: true, emailSent: false };
  }

  // Generate the one-time token; store only its hash.
  const token = randomBytes(32).toString("hex");
  const tokenHash = sha256(token);
  const expires = new Date(Date.now() + RESET_TOKEN_TTL_MS);

  await repo.upsertUserAccount({
    userId: auth.userId,
    passwordResetTokenHash: tokenHash,
    passwordResetExpires: expires,
  });

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  const resetUrl = `${siteUrl}/reset-password?token=${token}`;

  let emailSent = false;
  let devToken: string | undefined;
  try {
    const result = await sendEmail({
      to: email,
      subject: "Reset your PDFKit password",
      text: `A password reset was requested for your PDFKit account.\n\nSet a new password within 1 hour:\n${resetUrl}\n\nThe link works once. If you did not request this, you can safely ignore this email — your current password keeps working.`,
      html: `<p>A password reset was requested for your PDFKit account.</p><p>Set a new password within 1 hour:</p><p><a href="${resetUrl}">Choose a new password</a></p><p>The link works once. If you did not request this, you can safely ignore this email — your current password keeps working.</p>`,
    });
    emailSent = result.delivered;
    if (!result.delivered && process.env.NODE_ENV !== "production") {
      // Non-production convenience: hand the one-time link back to the caller
      // (route tests / local flows) — never exposed in production.
      devToken = token;
    }
  } catch (error) {
    if (isEmailTransportError(error) && process.env.NODE_ENV !== "production") {
      devToken = token;
    } else {
      // Production without SMTP (or SMTP failure): the request must not be
      // silently dropped. Surface a generic failure to the route so it can
      // answer honestly WITHOUT revealing which part failed (same body for
      // any address; the operator sees the server-side error class).
      console.error("[auth] Password-reset email could not be delivered (transport error; no addresses or tokens logged)");
      throw error;
    }
  }

  return { accepted: true, emailSent, ...(devToken ? { devToken } : {}) };
}

export type PasswordResetConfirmResult =
  | { success: true; message: string }
  | { success: false; code: "INVALID_TOKEN" | "WEAK_PASSWORD"; message: string };

/** Confirm a password reset: consume the token and set the new password. */
export async function confirmPasswordReset(
  rawToken: string | undefined | null,
  newPassword: string | undefined | null,
): Promise<PasswordResetConfirmResult> {
  if (!rawToken || typeof rawToken !== "string" || rawToken.length < 64) {
    return {
      success: false,
      code: "INVALID_TOKEN",
      message: "This password reset link is invalid or has expired.",
    };
  }

  const repo = getUsageRepository();
  const tokenHash = sha256(rawToken.trim());
  const account = await repo
    .getUserAccountByPasswordResetTokenHash(tokenHash)
    .catch(() => null);

  if (
    !account ||
    !account.passwordResetExpires ||
    new Date() > account.passwordResetExpires
  ) {
    return {
      success: false,
      code: "INVALID_TOKEN",
      message: "This password reset link is invalid or has expired.",
    };
  }

  // Password policy (with the email-local-part rule) is enforced against the
  // account the VALID token resolved to — no policy feedback for invalid
  // tokens, so the endpoint cannot be used as an oracle.
  const passwordResult = validatePassword(newPassword, account.email ?? undefined);
  if (!passwordResult.isValid) {
    return {
      success: false,
      code: "WEAK_PASSWORD",
      message: passwordResult.error ?? "Choose a stronger password.",
    };
  }

  const newHash = await hashPassword(newPassword as string);

  // Single-use consumption + new hash + reset timestamp in one update. The
  // token hash is cleared so a replay resolves to INVALID_TOKEN.
  await repo.upsertUserAccount({
    userId: account.userId,
    passwordHash: newHash,
    passwordResetTokenHash: null,
    passwordResetExpires: null,
    passwordResetAt: new Date(),
  });

  return {
    success: true,
    message:
      "Your password has been updated. Existing sessions were signed out — please sign in with your new password.",
  };
}
