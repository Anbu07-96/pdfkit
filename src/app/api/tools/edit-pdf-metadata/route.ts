import { handleProcessingRequest, methodNotAllowed } from "@/lib/processing/http";
import type { EditPdfMetadataOptions } from "@/lib/processing/processors/edit-pdf-metadata";

/**
 * Edit PDF Metadata API.
 *
 * POST multipart/form-data with:
 * - `files` — exactly one PDF
 * - `title`, `author`, `subject`, `keywords`, `creator` — optional strings.
 *   A missing field leaves the value unchanged; an empty string removes it.
 *
 * Responds with `application/pdf` — the same document with only its Info
 * dictionary changed. Producer and the dates are not editable because pdf-lib
 * re-stamps them on every save.
 *
 * No PDF logic here: the raw strings below are validated by the processor on
 * the server.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleProcessingRequest<EditPdfMetadataOptions>(request, {
    toolId: "edit-pdf-metadata",
    fallbackFileName: "metadata.pdf",
    readOptions: (form) => {
      const options: EditPdfMetadataOptions = {};
      for (const field of ["title", "author", "subject", "keywords", "creator"]) {
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
