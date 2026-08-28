import { handleProcessingRequest, methodNotAllowed } from "@/lib/hardening/route";

/**
 * Crop API.
 *
 * POST multipart/form-data with:
 * - `files` — exactly one PDF
 * - `mode` — `rectangle` or `margins`
 * - rectangle mode: `x`, `y`, `width`, `height` (points, bottom-left origin)
 * - margins mode: `top`, `right`, `bottom`, `left` (points)
 * - `ranges` — optional page ranges, e.g. "1-3, 5". Omitted means every page.
 *
 * Responds with `application/pdf` whose selected pages carry a new CropBox.
 * MediaBox, content, rotation and page order are untouched; cropped-out
 * content remains in the file and stays recoverable — this is **not**
 * redaction. The cropped count is reported in `X-PDFKit-Cropped-Pages`.
 *
 * No PDF logic here: the raw strings below are validated by the processor on
 * the server (reject, never clamp).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleProcessingRequest<Record<string, unknown>>(request, {
    toolId: "crop",
    fallbackFileName: "cropped.pdf",
    readOptions: (form) => {
      const options: Record<string, unknown> = {};
      for (const field of [
        "mode",
        "x",
        "y",
        "width",
        "height",
        "top",
        "right",
        "bottom",
        "left",
        "ranges",
      ]) {
        const value = form.get(field);
        if (typeof value === "string") options[field] = value;
      }
      return options;
    },
  });
}

export function GET(): Response {
  return methodNotAllowed();
}
