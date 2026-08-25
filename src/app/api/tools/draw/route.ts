import { handleProcessingRequest, methodNotAllowed } from "@/lib/hardening/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleProcessingRequest<Record<string, unknown>>(request, {
    toolId: "draw",
    fallbackFileName: "drawn.pdf",
    readOptions: (form) => {
      const options: Record<string, unknown> = {};
      for (const field of [
        "preset",
        "placement",
        "width",
        "height",
        "strokeWidth",
        "strokeColor",
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
