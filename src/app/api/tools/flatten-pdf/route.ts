import { handleProcessingRequest, methodNotAllowed } from "@/lib/hardening/route";

/**
 * Flatten PDF API.
 *
 * POST multipart/form-data with:
 * - `files` — exactly one PDF
 *
 * Responds with `application/pdf` whose interactive form fields have been
 * flattened into permanent page content (vector flattening with pdf-lib —
 * pages are never rasterised, so text stays selectable and links keep
 * working). Page count, order and rotation are unchanged. The number of
 * flattened fields is reported in `X-PDFKit-Flattened-Fields`.
 *
 * Honesty, enforced by the processor:
 * - Signed PDFs are rejected with a structured `SIGNED_PDF` error before any
 *   mutation — flattening would invalidate the signature.
 * - Document-level JavaScript and OpenActions are NOT removed. Flattening is
 *   not a sanitisation or security feature.
 * - Flattening is irreversible: fields become ordinary page content.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleProcessingRequest(request, {
    toolId: "flatten-pdf",
    fallbackFileName: "flattened.pdf",
  });
}

export function GET(): Response {
  return methodNotAllowed();
}
