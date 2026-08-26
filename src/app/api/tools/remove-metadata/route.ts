import { handleProcessingRequest, methodNotAllowed } from "@/lib/hardening/route";

/**
 * Remove Metadata API.
 *
 * POST multipart/form-data with `files` = exactly one PDF. Responds with
 * `application/pdf` containing the same document with its Title, Author,
 * Subject, Keywords, Creator and XMP metadata removed — verified by re-reading
 * the output before it is returned. Producer and timestamps are re-stamped by
 * the saving library and are reported as such; the result is never claimed to
 * be completely metadata-free.
 *
 * No PDF logic here: validation, limits and delivery live in the shared
 * processing layers.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleProcessingRequest(request, {
    toolId: "remove-metadata",
    fallbackFileName: "metadata-removed.pdf",
  });
}

export function GET(): Response {
  return methodNotAllowed();
}
