import "server-only";

import { requestPasswordReset } from "@/lib/auth/password-reset";
import { checkRateLimit } from "@/lib/hardening/distributed-protection";
import {
  isProcessingError,
  toErrorResponseBody,
} from "@/lib/processing/errors";
import { JSON_RESPONSE_HEADERS, methodNotAllowed } from "@/lib/processing/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/auth/reset-request` — request a password-reset email (Phase 66).
 *
 * - Rate-limited under its own scope (10/min per client): reset requests are
 *   an abuse surface (mail flooding, enumeration attempts).
 * - The response is GENERIC for any address (known, unknown, OAuth-only) so
 *   the endpoint cannot be used to enumerate registered accounts. The same
 *   body, the same status, always.
 * - The `devToken` convenience (no-SMTP development/test environments) is
 *   NEVER included when NODE_ENV=production.
 * - No addresses, tokens or passwords are logged.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const rateLimitProblem = await checkRateLimit(request, 10, "auth-reset-request");
    if (rateLimitProblem) return rateLimitProblem;

    let email: string | undefined;
    try {
      const contentType = request.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const body = (await request.json()) as { email?: string };
        email = body.email;
      }
    } catch {
      // Malformed body → generic response below.
    }

    const result = await requestPasswordReset(email);

    return Response.json(
      {
        message:
          "If an account exists for that address, a password-reset link has been sent. The link expires in 1 hour and works once.",
        ...(result.devToken && process.env.NODE_ENV !== "production"
          ? { devToken: result.devToken }
          : {}),
      },
      { status: 200, headers: JSON_RESPONSE_HEADERS },
    );
  } catch (error) {
    // Production SMTP failure: generic 503 (email system unavailable) —
    // never a per-address difference, never transport details.
    console.error("[auth] Password-reset request failed (no addresses logged)");
    const body = isProcessingError(error)
      ? toErrorResponseBody(error)
      : {
          error: {
            code: "SERVICE_UNAVAILABLE",
            message: "Password reset is temporarily unavailable. Please try again shortly.",
          },
        };
    return Response.json(body, {
      status: isProcessingError(error) ? error.status : 503,
      headers: JSON_RESPONSE_HEADERS,
    });
  }
}

export function GET(): Response {
  return methodNotAllowed("POST");
}
