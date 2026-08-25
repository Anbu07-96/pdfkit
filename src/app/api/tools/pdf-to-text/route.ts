import { handleProcessingRequest, methodNotAllowed } from "@/lib/hardening/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleProcessingRequest<Record<string, unknown>>(request, {
    toolId: "pdf-to-text",
    fallbackFileName: "text.txt",
    readOptions: (form) => {
      const options: Record<string, unknown> = {};
      for (const field of ["pages"]) {
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
