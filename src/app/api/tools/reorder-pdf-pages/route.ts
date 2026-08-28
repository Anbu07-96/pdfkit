import { handleProcessingRequest, methodNotAllowed } from "@/lib/hardening/route";
import type { ReorderPdfPagesOptions } from "@/lib/processing/processors/reorder-pdf-pages";

/**
 * Reorder PDF Pages API.
 *
 * POST multipart/form-data with:
 * - `files` — exactly one PDF
 * - `order` — the complete new page order, e.g. `5,3,1,2,4`
 *
 * The order must list every page of the document exactly once. Responds with
 * `application/pdf` containing the same pages in the requested order, or a
 * structured JSON error (`INVALID_PAGE_ORDER`, 400).
 *
 * No PDF logic here: `order` is an untrusted string that the processor
 * validates against the real document.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleProcessingRequest<ReorderPdfPagesOptions>(request, {
    toolId: "reorder-pdf-pages",
    fallbackFileName: "reordered.pdf",
    readOptions: (form) => ({
      order: typeof form.get("order") === "string"
        ? String(form.get("order"))
        : undefined,
    }),
  });
}

export function GET(): Response {
  return methodNotAllowed();
}
