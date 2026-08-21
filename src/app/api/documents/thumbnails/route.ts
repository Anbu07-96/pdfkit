import { ProcessingError, toErrorResponseBody } from "@/lib/processing/errors";
import {
  methodNotAllowed,
  readSingleUploadedPdf,
  JSON_RESPONSE_HEADERS,
} from "@/lib/processing/http";
import { createPageThumbnails, parseRequestedPages } from "@/lib/thumbnails/service";

/**
 * Page thumbnail API.
 *
 * POST multipart/form-data with:
 * - `files` — exactly one PDF
 * - `pages` — optional 1-based page numbers, e.g. `1,3,5`. Omitted renders the
 *   first N pages, where N is the configured limit.
 *
 * Responds with JSON:
 *
 * ```json
 * {
 *   "pageCount": 12,
 *   "thumbnails": [
 *     { "pageNumber": 1, "width": 220, "height": 311, "dataUrl": "data:image/png;base64,..." }
 *   ]
 * }
 * ```
 *
 * Data URLs keep the response self-contained and ephemeral: no temporary files,
 * no storage, no URLs anyone else could fetch, and nothing for the browser to
 * revoke. Shared infrastructure rather than a tool, hence `/api/documents/`.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const upload = await readSingleUploadedPdf(request);
  if ("response" in upload) return upload.response;

  try {
    const pages = parseRequestedPages(upload.form.get("pages") as string | null);
    const body = await createPageThumbnails(upload.file, { pages });

    return Response.json(body, { status: 200, headers: JSON_RESPONSE_HEADERS });
  } catch (error) {
    if (!(error instanceof ProcessingError)) {
      console.error("[thumbnails] unexpected failure while rendering previews", error);
    }
    return Response.json(toErrorResponseBody(error), {
      status: error instanceof ProcessingError ? error.status : 500,
      headers: JSON_RESPONSE_HEADERS,
    });
  } finally {
    // Release the document bytes as soon as the previews are encoded.
    upload.release();
  }
}

export function GET(): Response {
  return methodNotAllowed();
}
