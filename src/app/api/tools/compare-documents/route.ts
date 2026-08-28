import "server-only";

import { handleProcessingRequest, methodNotAllowed } from "@/lib/hardening/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleProcessingRequest(request, {
    toolId: "compare-documents",
    fallbackFileName: "document-comparison-report.txt",
  });
}

export function GET(): Response {
  return methodNotAllowed("POST");
}
