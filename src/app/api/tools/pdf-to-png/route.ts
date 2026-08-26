import { handleProcessingRequest, methodNotAllowed } from "@/lib/processing/http";

/**
 * PDF to PNG API.
 *
 * POST multipart/form-data with `files` = exactly one PDF. One page responds
 * with `image/png`; several pages respond with a ZIP of one lossless PNG per
 * page, in document order.
 *
 * No logic here: validation, limits (page count, render resolution, output
 * size) and delivery all live in the shared processing layers.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleProcessingRequest(request, {
    toolId: "pdf-to-png",
    fallbackFileName: "page-1.png",
  });
}

export function GET(): Response {
  return methodNotAllowed();
}
