import { handleProcessingRequest, methodNotAllowed } from "@/lib/processing/http";

/**
 * Images to PDF API.
 *
 * POST multipart/form-data with `files` = one or more JPG/JPEG/PNG images,
 * in the order the pages should follow. Responds with `application/pdf`
 * containing exactly one page per image, in upload order.
 *
 * No logic here: the shared HTTP adapter validates counts, sizes, extensions,
 * MIME types and the real image signatures before the processor runs.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleProcessingRequest(request, {
    toolId: "images-to-pdf",
    fallbackFileName: "images-to-pdf.pdf",
  });
}

export function GET(): Response {
  return methodNotAllowed();
}
