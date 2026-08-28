import { methodNotAllowed } from "@/lib/hardening/route";

/**
 * Production Health API.
 *
 * GET /api/health
 *
 * Returns HTTP 200 with a lightweight, machine-readable JSON health payload.
 * Completely independent of PDF processing and WASM/pdfium initialisation.
 * Does NOT expose secrets, environment variables, internal paths, or PII.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
} as const;

const processStartTime = Date.now();

export async function GET(): Promise<Response> {
  const uptimeSeconds = Math.floor((Date.now() - processStartTime) / 1000);

  return Response.json(
    {
      status: "ok",
      timestamp: new Date().toISOString(),
      uptimeSeconds,
      version: "0.1.0",
    },
    { status: 200, headers: JSON_HEADERS },
  );
}

export function POST(): Response {
  return methodNotAllowed("GET");
}

export function PUT(): Response {
  return methodNotAllowed("GET");
}

export function DELETE(): Response {
  return methodNotAllowed("GET");
}
