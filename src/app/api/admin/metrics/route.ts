import "server-only";

import { timingSafeEqual } from "node:crypto";
import { checkRateLimit } from "@/lib/hardening/distributed-protection";
import { getHardeningConfig } from "@/lib/hardening/config";
import { activeJobCount } from "@/lib/hardening/guards";
import { getTelemetrySnapshot } from "@/lib/monitoring/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/admin/metrics` — internal operational metrics (Phase 63, Step 5).
 *
 * SECURITY MODEL — fail closed:
 *
 * - Disabled entirely unless `PDFKIT_ADMIN_METRICS_TOKEN` is configured.
 *   When unconfigured the endpoint answers 404: it does not exist publicly.
 * - When configured, requires the exact token via `Authorization: Bearer …`
 *   or the `x-pdfkit-admin-token` header, compared in constant time.
 *   Missing/wrong token → 401 with no information about the snapshot.
 * - The endpoint sits behind the shared IP rate limiter under its own scope,
 *   so token guessing is additionally throttled.
 * - The snapshot contains aggregates only: no user identities, IPs, file
 *   names, document data, secrets or connection strings (by construction of
 *   the telemetry model and its tests).
 */

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
} as const;

function notFound(): Response {
  return Response.json(
    { error: { code: "NOT_FOUND", message: "Not found." } },
    { status: 404, headers: JSON_HEADERS },
  );
}

function unauthorized(): Response {
  return Response.json(
    { error: { code: "UNAUTHORIZED", message: "Authentication required." } },
    { status: 401, headers: JSON_HEADERS },
  );
}

/** Constant-time token comparison; both sides must be equal length first. */
function tokensMatch(expected: string, provided: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function extractToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim() || null;
  }
  const alt = request.headers.get("x-pdfkit-admin-token");
  return alt?.trim() || null;
}

export async function GET(request: Request): Promise<Response> {
  const expected = process.env.PDFKIT_ADMIN_METRICS_TOKEN;
  if (!expected) {
    // Fail closed: no token configured → the endpoint does not exist.
    return notFound();
  }

  // Throttle token guessing independently of the processing budget.
  const rateLimitProblem = await checkRateLimit(
    request,
    Math.min(getHardeningConfig().rateLimitPerMinute, 30),
    "admin-metrics",
  );
  if (rateLimitProblem) return rateLimitProblem;

  const provided = extractToken(request);
  if (!provided || !tokensMatch(expected, provided)) {
    return unauthorized();
  }

  const memory = process.memoryUsage();
  const snapshot = getTelemetrySnapshot({
    activeJobs: activeJobCount(),
    rssBytes: memory.rss,
    heapUsedBytes: memory.heapUsed,
  });

  return Response.json(snapshot, { status: 200, headers: JSON_HEADERS });
}

export function POST(): Response {
  return notFound();
}

export function PUT(): Response {
  return notFound();
}

export function DELETE(): Response {
  return notFound();
}
