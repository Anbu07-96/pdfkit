import { handleProcessingRequest, methodNotAllowed } from "@/lib/processing/http";
import type { CompressPdfOptions } from "@/lib/processing/processors/compress-pdf";

/**
 * Compress PDF API.
 *
 * POST multipart/form-data with:
 * - `files` — exactly one PDF
 * - `level` — `low`, `medium` or `high`. Omitted defaults to `medium`.
 *
 * Responds with `application/pdf` plus `X-PDFKit-*` headers carrying the
 * measured statistics (original bytes, output bytes, bytes saved, reduction
 * percent, and which strategy produced the output). When nothing can shrink
 * the file, the original bytes are returned and the headers say so.
 *
 * No PDF logic here: the level read below is an untrusted string that the
 * `compress-pdf` processor validates on the server.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleProcessingRequest<CompressPdfOptions>(request, {
    toolId: "compress-pdf",
    fallbackFileName: "compressed.pdf",
    readOptions: (form) => ({
      level:
        typeof form.get("level") === "string" ? String(form.get("level")) : undefined,
    }),
  });
}

export function GET(): Response {
  return methodNotAllowed();
}
