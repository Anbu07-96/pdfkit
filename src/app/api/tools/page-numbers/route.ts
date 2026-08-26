import { handleProcessingRequest, methodNotAllowed } from "@/lib/hardening/route";

/**
 * Page Numbers API.
 *
 * POST multipart/form-data with:
 * - `files` — exactly one PDF
 * - `position` — `bottom-left`, `bottom-center` or `bottom-right`
 * - `start` — starting number, a whole number 1-9999
 * - `size` — font size, a whole number 8-24
 * - `format` — `number` ("1"), `page` ("Page 1") or `page-of` ("Page 1 of 10")
 * - `pages` — `all`, `first` or `last`
 *
 * Responds with `application/pdf` containing the same document with vector
 * page numbers on the selected pages. `Page X of Y` always uses the document's
 * real page count; the count of numbered pages is reported in
 * `X-PDFKit-Numbered-Pages`.
 *
 * No PDF logic here: the raw strings below are validated by the processor on
 * the server.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleProcessingRequest<Record<string, unknown>>(request, {
    toolId: "page-numbers",
    fallbackFileName: "numbered.pdf",
    readOptions: (form) => {
      const options: Record<string, unknown> = {};
      for (const field of ["position", "start", "size", "format", "pages"]) {
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
