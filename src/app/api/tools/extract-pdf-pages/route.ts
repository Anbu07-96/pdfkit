import { handleProcessingRequest, methodNotAllowed } from "@/lib/hardening/route";
import type { ExtractPdfPagesOptions } from "@/lib/processing/processors/extract-pdf-pages";

/**
 * Extract PDF Pages API.
 *
 * POST multipart/form-data with:
 * - `files`  — exactly one PDF
 * - `ranges` — the pages to KEEP, e.g. `1-3, 5, 8-10`
 *
 * Responds with `application/pdf` containing those pages in the requested
 * order, or a structured JSON error. No PDF logic lives here: the value read
 * below is an untrusted string that the `extract-pdf-pages` processor validates
 * against the real document.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleProcessingRequest<ExtractPdfPagesOptions>(request, {
    toolId: "extract-pdf-pages",
    fallbackFileName: "extracted.pdf",
    readOptions: (form) => ({
      ranges: typeof form.get("ranges") === "string"
        ? String(form.get("ranges"))
        : undefined,
    }),
  });
}

export function GET(): Response {
  return methodNotAllowed();
}
