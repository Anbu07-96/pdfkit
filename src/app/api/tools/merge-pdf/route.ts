import {
  handleProcessingRequest,
  methodNotAllowed,
} from "@/lib/hardening/route";

/**
 * Merge PDF API.
 *
 * POST multipart/form-data with one or more `files` fields, in the order the
 * documents should appear in the result. Responds with `application/pdf` on
 * success, or a structured JSON error.
 *
 * The route itself contains no PDF logic: it delegates to the processing HTTP
 * adapter, which validates input and calls the registered `merge-pdf`
 * processor.
 */

// pdf-lib and the processing layer are Node-only; never run this on the edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleProcessingRequest(request, {
    toolId: "merge-pdf",
    fallbackFileName: "merged.pdf",
  });
}

export function GET(): Response {
  return methodNotAllowed();
}
