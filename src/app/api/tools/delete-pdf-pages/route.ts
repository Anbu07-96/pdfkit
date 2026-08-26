import { handleProcessingRequest, methodNotAllowed } from "@/lib/processing/http";
import type { DeletePdfPagesOptions } from "@/lib/processing/processors/delete-pdf-pages";

/**
 * Delete PDF Pages API.
 *
 * POST multipart/form-data with:
 * - `files`  — exactly one PDF
 * - `ranges` — the pages to REMOVE, e.g. `2, 4, 7-9`
 *
 * Responds with `application/pdf` containing the surviving pages in their
 * original order, or a structured JSON error. Removing every page is rejected
 * with `NO_PAGES_REMAIN` — a PDF cannot have zero pages.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleProcessingRequest<DeletePdfPagesOptions>(request, {
    toolId: "delete-pdf-pages",
    fallbackFileName: "pages-removed.pdf",
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
