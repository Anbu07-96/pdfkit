import { handleProcessingRequest, methodNotAllowed } from "@/lib/processing/http";
import type { RotatePdfOptions } from "@/lib/processing/processors/rotate-pdf";

/**
 * Rotate PDF API.
 *
 * POST multipart/form-data with:
 * - `files` — exactly one PDF
 * - `rotations` — JSON object of page → clockwise degrees, e.g.
 *   `{"1":90,"3":180}`. Pages that are absent keep their orientation, so a
 *   client can send only what changed.
 *
 * Rotation is additive to any rotation the page already carries. Responds with
 * `application/pdf` containing the same pages, in the same order, or a
 * structured JSON error (`INVALID_PAGE_ROTATION`, 400).
 *
 * No PDF logic here: the value read below is an untrusted string that the
 * `rotate-pdf` processor parses and validates against the real document.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleProcessingRequest<RotatePdfOptions>(request, {
    toolId: "rotate-pdf",
    fallbackFileName: "rotated.pdf",
    readOptions: (form) => ({
      rotations: typeof form.get("rotations") === "string"
        ? String(form.get("rotations"))
        : undefined,
    }),
  });
}

export function GET(): Response {
  return methodNotAllowed();
}
