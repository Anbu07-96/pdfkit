import { handleProcessingRequest, methodNotAllowed } from "@/lib/hardening/route";

/**
 * Unlock PDF API.
 *
 * POST multipart/form-data with:
 * - `files` — exactly one protected PDF
 * - `password` — the password for the file (optional: some PDFs open without
 *   a prompt yet carry owner restrictions; removing those needs no entry)
 *
 * Responds with `application/pdf` containing the decrypted document — the
 * `/Encrypt` dictionary is stripped, so it is an ordinary PDF again. Only the
 * legacy RC4 schemes are supported (40-bit V1/R2 and 128-bit V2/R3 — the
 * latter is what Password Protect writes). AES-protected files are refused
 * with `UNSUPPORTED_ENCRYPTION`, unprotected files with `PDF_NOT_ENCRYPTED`,
 * and a mismatched entry with `WRONG_PASSWORD`.
 *
 * This is not password recovery: the supplied password is only authenticated.
 * It is held in memory for this request only and never appears in logs, URLs,
 * file names, response headers or error bodies.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleProcessingRequest<Record<string, unknown>>(request, {
    toolId: "unlock-pdf",
    fallbackFileName: "unlocked.pdf",
    readOptions: (form) => {
      const password = form.get("password");
      return typeof password === "string" ? { password } : {};
    },
  });
}

export function GET(): Response {
  return methodNotAllowed();
}
