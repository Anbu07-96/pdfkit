/**
 * Password Protect model.
 *
 * Shared by the browser (the workspace controls) and the server (the processor
 * validates everything again). Like `watermark.ts`, this module stays free of
 * PDF libraries and `server-only` so it can be imported from either side.
 *
 * Honesty notes carried through to the interface and the docs:
 * - The protection applied is RC4 128-bit, the classic PDF Standard Security
 *   Handler (V2/R3), implemented by `@pdfsmaller/pdf-encrypt-lite`. It is a
 *   real password gate — the file cannot be opened without the password — but
 *   it is **not** AES-256, and the copy never says "military-grade" or
 *   "zero-knowledge". RC4 is the widely compatible older scheme; highly
 *   sensitive documents deserve a dedicated encrypted channel instead.
 * - The password travels once, as a multipart form field, and lives in memory
 *   for the duration of the request only. It never appears in logs, URLs,
 *   file names, response headers or error bodies.
 */

/** Minimum password length: an empty password would open without a prompt. */
export const MIN_PROTECT_PASSWORD_LENGTH = 1;

/**
 * Maximum password length. Bounds the work the key derivation does and keeps
 * pasted novels from becoming an accidental denial of service. The legacy
 * security handler only consumes the first 32 bytes anyway.
 */
export const MAX_PROTECT_PASSWORD_LENGTH = 128;

/** Fully validated protect request. */
export interface PasswordProtectOptions {
  /** The password exactly as typed — spaces and case are significant. */
  password: string;
}

export interface PasswordProtectOptionIssue {
  message: string;
}

export type PasswordProtectParseResult =
  | { ok: true; options: PasswordProtectOptions }
  | { ok: false; issue: PasswordProtectOptionIssue };

/**
 * Parse and validate the raw multipart value. The server never repairs a
 * password — it is used exactly as submitted or rejected outright.
 *
 * Character *encodability* (the legacy security handler speaks
 * PDFDocEncoding) is verified server-side by the processor, because the
 * encoder belongs to the PDF library layer which the browser must not import.
 */
export function parsePasswordProtectOptions(raw: {
  password?: unknown;
}): PasswordProtectParseResult {
  const password = typeof raw.password === "string" ? raw.password : "";

  if (password.length < MIN_PROTECT_PASSWORD_LENGTH) {
    return { ok: false, issue: { message: "Choose a password." } };
  }
  if (password.length > MAX_PROTECT_PASSWORD_LENGTH) {
    return {
      ok: false,
      issue: {
        message: `The password must be ${MAX_PROTECT_PASSWORD_LENGTH} characters or fewer.`,
      },
    };
  }

  return { ok: true, options: { password } };
}

/** Client-side mirror of the validity rule, for enabling the action button. */
export function isProtectPasswordAcceptable(password: string): boolean {
  return (
    password.length >= MIN_PROTECT_PASSWORD_LENGTH &&
    password.length <= MAX_PROTECT_PASSWORD_LENGTH
  );
}
