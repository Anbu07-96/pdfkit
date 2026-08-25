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

export async function POST(request: Request): Promise<Response> {
  try {
    const identity = await getUserIdentity();

    if (!identity.isAuthenticated || identity.userId === "anon") {
      return Response.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Sign in to upgrade your account plan.",
          },
        },
        { status: 401, headers: JSON_RESPONSE_HEADERS },
      );
    }

    let planId = "pro";
    let successUrl: string | undefined;
    let cancelUrl: string | undefined;

    try {
      const contentType = request.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const body = (await request.json()) as {
          planId?: string;
          successUrl?: string;
          cancelUrl?: string;
        };
        if (body.planId) planId = body.planId;
        if (body.successUrl) successUrl = body.successUrl;
        if (body.cancelUrl) cancelUrl = body.cancelUrl;
      }
    } catch {
      // Non-JSON or empty payload defaults to planId = "pro"
    }

    if (planId !== "pro") {
      return Response.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Only the PRO plan is currently available for checkout.",
          },
        },
        { status: 400, headers: JSON_RESPONSE_HEADERS },
      );
    }

    const sessionResult = await getBillingService().createCheckoutSession({
      identity,
      planId: "pro",
      successUrl,
      cancelUrl,
    });

    return Response.json(
      { sessionId: sessionResult.sessionId, url: sessionResult.url },
      { status: 200, headers: JSON_RESPONSE_HEADERS },
    );
  } catch (error) {
    const body = toErrorResponseBody(error);
    const status = isProcessingError(error) ? error.status : 500;
    return Response.json(body, { status, headers: JSON_RESPONSE_HEADERS });
  }
}

export function GET(): Response {
  return methodNotAllowed("POST");
}
