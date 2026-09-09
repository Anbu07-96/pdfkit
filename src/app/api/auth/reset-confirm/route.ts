import "server-only";

import { confirmPasswordReset } from "@/lib/auth/password-reset";
import { checkRateLimit } from "@/lib/hardening/distributed-protection";
import { JSON_RESPONSE_HEADERS, methodNotAllowed } from "@/lib/processing/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/auth/reset-confirm` — complete a password reset (Phase 66).
 *
 * - Rate-limited under its own scope (token guessing is throttled and each
 *   token is 64 hex chars of entropy anyway).
 * - Responses distinguish only INVALID_TOKEN / WEAK_PASSWORD / success —
 *   never whether an address exists.
 * - A successful reset invalidates pre-reset sessions (passwordResetAt).
 */
export async function POST(request: Request): Promise<Response> {
  const rateLimitProblem = await checkRateLimit(request, 10, "auth-reset-confirm");
  if (rateLimitProblem) return rateLimitProblem;

  let token: string | undefined;
  let password: string | undefined;
  try {
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const body = (await request.json()) as { token?: string; password?: string };
      token = body.token;
      password = body.password;
    }
  } catch {
    // Handled by validation below.
  }

  const result = await confirmPasswordReset(token, password);
  if (!result.success) {
    return Response.json(
      {
        error: {
          code: result.code === "WEAK_PASSWORD" ? "WEAK_PASSWORD" : "INVALID_TOKEN",
          message: result.message,
        },
      },
      { status: result.code === "WEAK_PASSWORD" ? 400 : 400, headers: JSON_RESPONSE_HEADERS },
    );
  }

  return Response.json(
    { message: result.message },
    { status: 200, headers: JSON_RESPONSE_HEADERS },
  );
}

export function GET(): Response {
  return methodNotAllowed("POST");
}
