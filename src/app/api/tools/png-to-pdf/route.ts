import { handleProcessingRequest, methodNotAllowed } from "@/lib/processing/http";

/**
 * PNG to PDF API.
 *
 * POST multipart/form-data with `files` = one or more PNG images, in the
 * order the pages should follow. Responds with `application/pdf` containing
 * exactly one page per image, in upload order. A file whose bytes are not
 * really PNGs is rejected (`INVALID_IMAGE`, 422) whatever its name claims.
 *
 * No logic here: the shared HTTP adapter validates counts, sizes, extensions,
 * MIME types and the real image signatures before the processor runs.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleProcessingRequest(request, {
    toolId: "png-to-pdf",
    fallbackFileName: "png-to-pdf.pdf",
  });
}

export function GET(): Response {
  return methodNotAllowed();
}
