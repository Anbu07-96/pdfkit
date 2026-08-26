import { handleProcessingRequest, methodNotAllowed } from "@/lib/processing/http";
import type { SplitPdfOptions } from "@/lib/processing/processors/split-pdf";
import type { PageSelectionMode } from "@/lib/processing/pages";

/**
 * Split PDF API.
 *
 * POST multipart/form-data with:
 * - `files` — exactly one PDF
 * - `mode`  — `every-page` or `ranges`
 * - `ranges` — required for `ranges` mode, e.g. `1-3, 4-6, 7-10`
 *
 * Responds with `application/pdf` when the split produces a single document, or
 * `application/zip` containing one PDF per output otherwise. Failures return a
 * structured JSON error.
 *
 * The route contains no PDF logic: values read here are untrusted strings that
 * the `split-pdf` processor validates against the real document.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleProcessingRequest<SplitPdfOptions>(request, {
    toolId: "split-pdf",
    fallbackFileName: "split.pdf",
    readOptions: (form) => ({
      mode: (form.get("mode") ?? "") as PageSelectionMode,
      ranges: typeof form.get("ranges") === "string"
        ? String(form.get("ranges"))
        : undefined,
    }),
  });
}

export function GET(): Response {
  return methodNotAllowed();
}
