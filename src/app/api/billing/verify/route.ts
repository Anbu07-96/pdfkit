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
            message: "Sign in to verify payment.",
          },
        },
        { status: 401, headers: JSON_RESPONSE_HEADERS },
      );
    }

    const body = (await request.json()) as {
      razorpayPaymentId?: string;
      razorpaySubscriptionId?: string;
      razorpaySignature?: string;
    };

    if (
      !body.razorpayPaymentId ||
      !body.razorpaySubscriptionId ||
      !body.razorpaySignature
    ) {
      return Response.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Missing Razorpay payment signature parameters.",
          },
        },
        { status: 400, headers: JSON_RESPONSE_HEADERS },
      );
    }

    const result = await getBillingService().verifyPayment({
      identity,
      razorpayPaymentId: body.razorpayPaymentId,
      razorpaySubscriptionId: body.razorpaySubscriptionId,
      razorpaySignature: body.razorpaySignature,
    });

    return Response.json(result, { status: 200, headers: JSON_RESPONSE_HEADERS });
  } catch (error) {
    const body = toErrorResponseBody(error);
    const status = isProcessingError(error) ? error.status : 400;
    return Response.json(body, { status, headers: JSON_RESPONSE_HEADERS });
  }
}

export function GET(): Response {
  return methodNotAllowed("POST");
}
