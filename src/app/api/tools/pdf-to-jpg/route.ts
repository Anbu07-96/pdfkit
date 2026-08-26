import { handleProcessingRequest, methodNotAllowed } from "@/lib/processing/http";

/**
 * PDF to JPG API.
 *
 * POST multipart/form-data with `files` = exactly one PDF. One page responds
 * with `image/jpeg`; several pages respond with a ZIP of one JPG per page,
 * in document order.
 *
 * No logic here: validation, limits (page count, render resolution, output
 * size) and delivery all live in the shared processing layers.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleProcessingRequest(request, {
    toolId: "pdf-to-jpg",
    fallbackFileName: "page-1.jpg",
  });
}

export function GET(): Response {
  return methodNotAllowed();
}
