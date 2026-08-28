import { handleProcessingRequest, methodNotAllowed } from "@/lib/hardening/route";

/**
 * Add Shapes API.
 *
 * POST multipart/form-data with:
 * - `files` — exactly one PDF
 * - `shape` — `rectangle`, `circle`, `ellipse` or `line`
 * - `placement` — one of nine anchors (`top-left` .. `bottom-right`)
 * - `width` — shape width/diameter (1-1000)
 * - `height` — shape height (1-1000)
 * - `strokeWidth` — stroke width (0-50)
 * - `strokeColor` — hex color or `none`/`transparent`
 * - `fillColor` — hex color or `none`/`transparent`
 * - `pages` — `all`, `first` or `last`
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleProcessingRequest<Record<string, unknown>>(request, {
    toolId: "add-shapes",
    fallbackFileName: "shapes-added.pdf",
    readOptions: (form) => {
      const options: Record<string, unknown> = {};
      for (const field of [
        "shape",
        "placement",
        "width",
        "height",
        "strokeWidth",
        "strokeColor",
        "fillColor",
        "pages",
      ]) {
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
