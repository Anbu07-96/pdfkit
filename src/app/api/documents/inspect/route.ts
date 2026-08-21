import { handleInspectRequest, methodNotAllowed } from "@/lib/processing/http";

/**
 * PDF inspection API.
 *
 * POST multipart/form-data with a single `files` entry and receive the
 * document's real page count:
 *
 * ```json
 * { "fileName": "report.pdf", "size": 248113, "pageCount": 24 }
 * ```
 *
 * Page-level tools use this so the interface can show a genuine page count and
 * validate page ranges before submitting. It is shared infrastructure rather
 * than a tool of its own, which is why it does not live under `/api/tools`.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleInspectRequest(request);
}

export function GET(): Response {
  return methodNotAllowed();
}
