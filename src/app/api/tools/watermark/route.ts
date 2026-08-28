import { handleProcessingRequest, methodNotAllowed } from "@/lib/hardening/route";

/**
 * Watermark API.
 *
 * POST multipart/form-data with:
 * - `files` — exactly one PDF
 * - `text` — the watermark text (1-200 characters, trimmed)
 * - `opacity` — `25`, `50` or `75` (percent)
 * - `rotation` — `0`, `45` or `-45` (degrees)
 * - `placement` — `center`, `diagonal-tiled` or `corner` (bottom-right)
 * - `pages` — `all`, `first` or `last`
 *
 * Responds with `application/pdf` containing the same document with vector
 * text stamps on the selected pages — pages are never rasterised. The count
 * of stamped pages is reported in `X-PDFKit-Watermarked-Pages`. A visible
 * watermark is a deterrent, not protection.
 *
 * No PDF logic here: the raw strings below are validated by the processor on
 * the server.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleProcessingRequest<Record<string, unknown>>(request, {
    toolId: "watermark",
    fallbackFileName: "watermarked.pdf",
    readOptions: (form) => {
      const options: Record<string, unknown> = {};
      for (const field of ["text", "opacity", "rotation", "placement", "pages"]) {
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
