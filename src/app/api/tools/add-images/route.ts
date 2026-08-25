import { handleProcessingRequest, methodNotAllowed } from "@/lib/hardening/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleProcessingRequest<Record<string, unknown>>(request, {
    toolId: "add-images",
    fallbackFileName: "image-added.pdf",
    readOptions: (form) => {
      const options: Record<string, unknown> = {};
      for (const field of [
        "placement",
        "width",
        "height",
        "preserveAspectRatio",
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
