import "server-only";

import {
  checkRateLimit,
} from "@/lib/hardening/distributed-protection";
import { JSON_RESPONSE_HEADERS, methodNotAllowed } from "@/lib/processing/http";
import { getUsageRepository } from "@/lib/usage/repository";
import { validateAndNormalizeEmail, validatePassword } from "@/lib/auth/validation";
import { hashPassword } from "@/lib/auth/password";
import {
  generateVerificationToken,
  sendVerificationEmail,
} from "@/lib/auth/verification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/auth/register` — create a credentials account (Phase 65).
 *
 * Before Phase 65 the register page called signIn() directly: no account
 * record and no password were ever stored, and authorize() accepted ANY
 * policy-valid email/password pair (email-only account access). This route
 * creates the account with a scrypt password hash (node:crypto — zero native
 * dependencies) plus an email-verification token (existing columns/flow).
 *
 * Behavior:
 * - email must be valid, non-disposable, normalized to lower case;
 * - password must satisfy the existing policy (min 8, letters+numbers, no
 *   email local-part, no common passwords);
 * - 409 when the email is already registered (no enumeration detail beyond
 *   that — registration requires providing a new address);
 * - rate-limited under its own scope (registration is an abuse surface);
 * - responses never echo the password or the hash.
 */
export async function POST(request: Request): Promise<Response> {
  const rateLimitProblem = await checkRateLimit(request, 10, "auth-register");
  if (rateLimitProblem) return rateLimitProblem;

  let body: { email?: unknown; password?: unknown };
  try {
    body = (await request.json()) as { email?: unknown; password?: unknown };
  } catch {
    return Response.json(
      { error: { code: "VALIDATION_ERROR", message: "Request body must be JSON." } },
      { status: 400, headers: JSON_RESPONSE_HEADERS },
    );
  }

  const email = typeof body.email === "string" ? body.email : "";
  const password = typeof body.password === "string" ? body.password : "";

  const emailResult = validateAndNormalizeEmail(email);
  if (!emailResult.isValid || !emailResult.normalizedEmail) {
    return Response.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Enter a valid, non-disposable email address.",
        },
      },
      { status: 400, headers: JSON_RESPONSE_HEADERS },
    );
  }
  const normalizedEmail = emailResult.normalizedEmail;

  const passwordResult = validatePassword(password, normalizedEmail);
  if (!passwordResult.isValid) {
    return Response.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message:
            passwordResult.error ??
            "Password must be at least 8 characters and contain letters and numbers.",
        },
      },
      { status: 400, headers: JSON_RESPONSE_HEADERS },
    );
  }

  const repo = getUsageRepository();

  // Duplicate check by email (unique index backs this up on real PostgreSQL).
  const existing = await repo.getUserAccountAuthByEmail(normalizedEmail);
  if (existing) {
    return Response.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "An account with this email already exists. Sign in instead.",
        },
      },
      { status: 409, headers: JSON_RESPONSE_HEADERS },
    );
  }

  // Stable public user id derived from the normalized email — same
  // convention the previous session token used, so usage history and Razorpay
  // customer links keep working for existing deployments.
  const userId = `usr_${Buffer.from(normalizedEmail).toString("hex").slice(0, 12)}`;

  const passwordHash = await hashPassword(password);
  const { token } = generateVerificationToken();

  await repo.upsertUserAccount({
    userId,
    email: normalizedEmail,
    name: normalizedEmail.split("@")[0] || "User",
    tier: "free",
    status: "active",
    authProvider: "credentials",
    verificationToken: token,
    verificationExpires: new Date(Date.now() + 24 * 60 * 60 * 1000),
    passwordHash,
  });

  // Delivery is provider-neutral: without SMTP configuration the link is
  // logged server-side (see sendVerificationEmail); staging verification can
  // also complete via the token stored on the account.
  await sendVerificationEmail(normalizedEmail, token).catch((err: unknown) => {
    console.error("[auth-register] verification email failed", err instanceof Error ? err.message : err);
  });

  return Response.json(
    { ok: true, message: "Account created. You can now sign in." },
    { status: 201, headers: JSON_RESPONSE_HEADERS },
  );
}

export function GET(): Response {
  return methodNotAllowed();
}
