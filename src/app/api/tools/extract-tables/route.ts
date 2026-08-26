import "server-only";

import { handleProcessingRequest, methodNotAllowed } from "@/lib/hardening/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleProcessingRequest(request, {
    toolId: "extract-tables",
    fallbackFileName: "tables.xlsx",
    readOptions: (form) => {
      const format = form.get("format")?.toString();
      return { ...(format ? { format } : {}) };
    },
  });
}

export function GET(): Response {
  return methodNotAllowed("POST");
}
