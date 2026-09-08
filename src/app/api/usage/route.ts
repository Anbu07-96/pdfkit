import { getUserIdentity } from "@/lib/auth/session";
import { checkRateLimit } from "@/lib/hardening/distributed-protection";
import { getHardeningConfig } from "@/lib/hardening/config";
import { jsonError, methodNotAllowed } from "@/lib/processing/http";
import { getUsageService } from "@/lib/usage/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/usage` — the caller's current daily quota snapshot (Phase 61).
 *
 * Read-only, same data the /account page shows, so the bulk workspace can
 * display "this batch needs X jobs / Y MB" against the real remaining quota
 * before a batch starts. No body is accepted; identity comes from the NextAuth
 * session with the anonymous fallback, exactly like the processing routes.
 * The shared IP rate limiter still applies.
 */
export async function GET(request: Request): Promise<Response> {
  const rateLimitProblem = await checkRateLimit(
    request,
    getHardeningConfig().rateLimitPerMinute,
  );
  if (rateLimitProblem) return rateLimitProblem;

  try {
    const identity = await getUserIdentity();
    const summary = await getUsageService().getUserSummary(identity);

    return Response.json(summary, {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    console.error("[usage] Failed to read usage summary", error);
    return jsonError(
      "USAGE_SERVICE_UNAVAILABLE",
      "Usage information is temporarily unavailable.",
    );
  }
}

export function POST(): Response {
  return methodNotAllowed();
}
