import { handleProcessingRequest, methodNotAllowed } from "@/lib/hardening/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleProcessingRequest<Record<string, unknown>>(request, {
    toolId: "annotations",
    fallbackFileName: "annotated.pdf",
    readOptions: (form) => {
      const options: Record<string, unknown> = {};
      for (const field of [
        "type",
        "placement",
        "text",
        "author",
        "url",
        "width",
        "height",
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
