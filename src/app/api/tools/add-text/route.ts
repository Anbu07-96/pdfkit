import { handleProcessingRequest, methodNotAllowed } from "@/lib/hardening/route";

/**
 * Add Text API.
 *
 * POST multipart/form-data with:
 * - `files` — exactly one PDF
 * - `text` — the text to add (1-500 characters, up to 20 lines)
 * - `placement` — one of the nine anchors: `top-left`, `top-center`,
 *   `top-right`, `center-left`, `center`, `center-right`, `bottom-left`,
 *   `bottom-center`, `bottom-right`
 * - `size` — `12`, `16`, `24` or `36` (points)
 * - `pages` — `all`, `first` or `last`
 *
 * Responds with `application/pdf` containing the same document with the text
 * drawn as real vector text on the selected pages — pages are never
 * rasterised, so the output stays a real, searchable PDF. The standard Latin
 * font cannot encode characters outside its range; those are rejected with a
 * clear `INVALID_TEXT_CONFIGURATION` message. Text that would overflow the
 * page is scaled down to fit, never clipped silently. The number of pages
 * that received text is reported in `X-PDFKit-Text-Pages`.
 *
 * No PDF logic here: the raw strings below are validated by the processor on
 * the server.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleProcessingRequest<Record<string, unknown>>(request, {
    toolId: "add-text",
    fallbackFileName: "text-added.pdf",
    readOptions: (form) => {
      const options: Record<string, unknown> = {};
      for (const field of ["text", "placement", "size", "pages"]) {
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
