import "server-only";

import { handleProcessingRequest, methodNotAllowed } from "@/lib/hardening/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleProcessingRequest(request, {
    toolId: "redact-information",
    fallbackFileName: "redacted.pdf",
    readOptions: (form) => {
      const pages = form.get("pages")?.toString();
      const fillColor = form.get("fillColor")?.toString();
      const areasRaw = form.get("areas")?.toString();

      let areas: unknown[] | undefined;
      if (areasRaw) {
        try {
          areas = JSON.parse(areasRaw);
        } catch {
          // Fall back to default options
        }
      }

      return {
        ...(pages ? { pages } : {}),
        ...(fillColor ? { fillColor } : {}),
        ...(areas ? { areas } : {}),
      };
    },
  });
}

export function GET(): Response {
  return methodNotAllowed("POST");
}
