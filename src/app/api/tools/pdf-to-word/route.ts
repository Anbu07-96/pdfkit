import { handleProcessingRequest, methodNotAllowed } from "@/lib/hardening/route";

/**
 * PDF to Word API — text only.
 *
 * POST multipart/form-data with `files` = exactly one PDF. Responds with a
 * real .docx containing the extracted text: one paragraph per line, a page
 * break between pages. Formatting, images, tables and exact layout are not
 * preserved; the headers report the measured extraction
 * (`X-PDFKit-Characters`, `-Paragraphs`, `-Mode: text-only`).
 *
 * No PDF logic here: validation, limits and delivery live in the shared
 * processing layers.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleProcessingRequest(request, {
    toolId: "pdf-to-word",
    fallbackFileName: "document.docx",
  });
}

export function GET(): Response {
  return methodNotAllowed();
}
