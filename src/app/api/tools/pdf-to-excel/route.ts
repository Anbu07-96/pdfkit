import "server-only";

import { handleProcessingRequest, methodNotAllowed } from "@/lib/hardening/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleProcessingRequest(request, {
    toolId: "pdf-to-excel",
    fallbackFileName: "document.xlsx",
  });
}

export function GET(): Response {
  return methodNotAllowed("POST");
}
