import "server-only";

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
    const rawBody = await request.text();
    const signature = request.headers.get("stripe-signature");

    if (!signature) {
      return Response.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Missing stripe-signature header.",
          },
        },
        { status: 400, headers: JSON_RESPONSE_HEADERS },
      );
    }

    const result = await getBillingService().handleWebhookEvent(rawBody, signature);

    return Response.json(
      { received: true, status: result.status, eventType: result.eventType },
      { status: 200, headers: JSON_RESPONSE_HEADERS },
    );
  } catch (error) {
    const body = toErrorResponseBody(error);
    const status = isProcessingError(error) ? error.status : 400;
    return Response.json(body, { status, headers: JSON_RESPONSE_HEADERS });
  }
}

export function GET(): Response {
  return methodNotAllowed("POST");
}
