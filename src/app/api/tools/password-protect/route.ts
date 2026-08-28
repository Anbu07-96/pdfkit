import { handleProcessingRequest, methodNotAllowed } from "@/lib/hardening/route";

/**
 * Password Protect API.
 *
 * POST multipart/form-data with:
 * - `files` — exactly one PDF
 * - `password` — the password that will be required to open the document
 *   (1-128 characters, used exactly as typed; spaces and case are significant)
 *
 * Responds with `application/pdf` encrypted with RC4 128-bit (PDF Standard
 * Security Handler, V2/R3) — the classic, widely compatible scheme. It is a
 * real password gate, but it is NOT AES-256; the copy and the docs say so.
 *
 * The password is held in memory for this request only. It never appears in
 * logs, URLs, file names, response headers or error bodies.
 *
 * No PDF logic here: the raw value below is validated by the processor on the
 * server, which also verifies the encrypted output before it is returned.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleProcessingRequest<Record<string, unknown>>(request, {
    toolId: "password-protect",
    fallbackFileName: "protected.pdf",
    readOptions: (form) => {
      const password = form.get("password");
      return typeof password === "string" ? { password } : {};
    },
  });
}

export function GET(): Response {
  return methodNotAllowed();
}
