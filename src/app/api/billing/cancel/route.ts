import "server-only";

import { getUserIdentity } from "@/lib/auth/session";
import { getBillingService } from "@/lib/billing/service";
import {
  isProcessingError,
  toErrorResponseBody,
} from "@/lib/processing/errors";
import { JSON_RESPONSE_HEADERS, methodNotAllowed } from "@/lib/processing/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/billing/cancel` — cancel the signed-in user's subscription at
 * the end of the current paid period (Phase 66).
 *
 * - Requires an authenticated session; the subscription is looked up from
 *   the DATABASE account row (never from the request body), so a client
 *   cannot cancel or affect anyone else's subscription.
 * - The Razorpay API is called with cancelAtCycleEnd=true: access continues
 *   to the end of the paid period, then the subscription.completed webhook
 *   downgrades the account to Free.
 * - Unconfigured billing or no active subscription → clean 400s.
 */
export async function POST(): Promise<Response> {
  try {
    const identity = await getUserIdentity();

    if (!identity.isAuthenticated || identity.userId === "anon") {
      return Response.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Sign in to manage your subscription.",
          },
        },
        { status: 401, headers: JSON_RESPONSE_HEADERS },
      );
    }

    // No request body is trusted (or needed) — identity comes from the
    // session and the subscription from the database.
    const result = await getBillingService().cancelSubscriptionAtPeriodEnd(identity);

    return Response.json(result, { status: 200, headers: JSON_RESPONSE_HEADERS });
  } catch (error) {
    const body = toErrorResponseBody(error);
    const status = isProcessingError(error) ? error.status : 500;
    return Response.json(body, { status, headers: JSON_RESPONSE_HEADERS });
  }
}

export function GET(): Response {
  return methodNotAllowed("POST");
}
