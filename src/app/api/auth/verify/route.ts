import "server-only";

import { verifyEmailToken } from "@/lib/auth/verification";
import { JSON_RESPONSE_HEADERS, methodNotAllowed } from "@/lib/processing/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");

  if (!token) {
    return Response.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Missing verification token parameter.",
        },
      },
      { status: 400, headers: JSON_RESPONSE_HEADERS },
    );
  }

  const result = await verifyEmailToken(token);

  if (!result.success) {
    return Response.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: result.message,
        },
      },
      { status: 400, headers: JSON_RESPONSE_HEADERS },
    );
  }

  return Response.json(
    {
      success: true,
      message: result.message,
      email: result.email,
    },
    { status: 200, headers: JSON_RESPONSE_HEADERS },
  );
}

export function POST(): Response {
  return methodNotAllowed("GET");
}
