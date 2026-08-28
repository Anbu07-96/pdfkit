/**
 * Unlock PDF model.
 *
 * Shared by the browser (the workspace controls) and the server (the processor
 * validates everything again). Like `password-protect.ts`, this module stays
 * free of PDF libraries and `server-only`.
 *
 * Honesty notes carried through to the interface and the docs:
 * - Unlock removes a password the user **already has** from their own file.
 *   It is not password recovery or cracking, and the copy never offers that.
 * - The supported schemes are the legacy RC4 ones: 40-bit (V1/R2) and
 *   128-bit (V2/R3), matching what `@pdfsmaller/pdf-decrypt-lite` implements
 *   — and exactly what Password Protect produces. AES-protected files (V4+)
 *   are refused with a clear message, not silently failed.
 * - The password travels once, as a multipart form field, and lives in memory
 *   for the duration of the request only. It never appears in logs, URLs,
 *   file names, response headers or error bodies.
 */

/**
 * Maximum password length, mirroring Password Protect. The password itself
 * may be empty: some PDFs open without a prompt (empty user password) yet
 * carry owner restrictions — removing those needs no entry.
 */
export const MAX_UNLOCK_PASSWORD_LENGTH = 128;

/** Fully validated unlock request. */
export interface UnlockPdfOptions {
  /** The password exactly as typed; `""` when none is needed. */
  password: string;
}

export interface UnlockPdfOptionIssue {
  message: string;
}

export type UnlockPdfParseResult =
  | { ok: true; options: UnlockPdfOptions }
  | { ok: false; issue: UnlockPdfOptionIssue };

/**
 * Parse and validate the raw multipart value. Never trims: an entry is used
 * exactly as submitted. A missing field is treated as an empty password.
 */
export function parseUnlockPdfOptions(raw: {
  password?: unknown;
}): UnlockPdfParseResult {
  const password = typeof raw.password === "string" ? raw.password : "";

  if (password.length > MAX_UNLOCK_PASSWORD_LENGTH) {
    return {
      ok: false,
      issue: {
        message: `The password must be ${MAX_UNLOCK_PASSWORD_LENGTH} characters or fewer.`,
      },
    };
  }

  return { ok: true, options: { password } };
}
