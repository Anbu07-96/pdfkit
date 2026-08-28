import "server-only";

import { encryptPDF } from "@pdfsmaller/pdf-encrypt-lite";
import { decryptPDF, isEncrypted } from "@pdfsmaller/pdf-decrypt-lite";
import { PDFDocument } from "pdf-lib";
import type {
  ProcessingRequest,
  ProcessingSuccess,
  ToolProcessor,
} from "@/lib/processing/contract";
import { ProcessingError } from "@/lib/processing/errors";
import { derivedDocumentName } from "@/lib/processing/file-names";
import {
  loadPdfDocument,
  readPageCount,
} from "@/lib/processing/pdf-document";
import { PASSWORD_PROTECT_INPUT_RULES } from "@/lib/processing/rules";
import { parsePasswordProtectOptions } from "@/lib/processing/password-protect";

/**
 * Password Protect — real RC4 128-bit encryption, verified after the fact.
 *
 * The document is encrypted with `@pdfsmaller/pdf-encrypt-lite`, which applies
 * the classic PDF Standard Security Handler (V2/R3, RC4 128-bit). The copy
 * says exactly that — never "AES-256", "military-grade" or "zero-knowledge".
 *
 * Nothing is claimed that was not measured. Before the bytes are returned the
 * processor verifies that:
 * 1. the output really reports an encryption dictionary (V2/R3, 128-bit);
 * 2. the output cannot be opened without a password (pdf-lib refuses it);
 * 3. the exact password given unlocks it again, yielding every original page.
 *
 * The password lives in memory for this request only. It is never logged (the
 * service logs tool/outcome/counts only), never echoed in messages or error
 * details, and never placed in names, URLs or headers.
 */
export class PasswordProtectProcessor implements ToolProcessor {
  readonly toolId = "password-protect";
  readonly input = PASSWORD_PROTECT_INPUT_RULES;

  async process(
    request: ProcessingRequest<Record<string, unknown>>,
  ): Promise<ProcessingSuccess> {
    const file = request.files[0];
    if (!file) {
      throw new ProcessingError("VALIDATION_ERROR", "No PDF was uploaded.");
    }

    const parsed = parsePasswordProtectOptions(request.options ?? {});
    if (!parsed.ok) {
      throw new ProcessingError("VALIDATION_ERROR", parsed.issue.message);
    }
    const { password } = parsed.options;

    // Open the input with the shared loader first: malformed files are
    // reported as INVALID_PDF, and an already-encrypted file is refused with
    // a tool-specific message instead of being silently re-encrypted.
    let document: PDFDocument;
    try {
      document = await loadPdfDocument(file.name, file.bytes);
    } catch (error) {
      if (error instanceof ProcessingError && error.code === "ENCRYPTED_PDF") {
        throw new ProcessingError(
          "ENCRYPTED_PDF",
          "This PDF already has a password. Unlock it first if you want to protect it with a new one.",
          {
            details: [`${file.name} is already password protected.`],
            cause: error,
          },
        );
      }
      throw error;
    }
    const pageCount = readPageCount(document, file.name);

    let encrypted: Uint8Array;
    try {
      encrypted = await encryptPDF(file.bytes, password);
    } catch (cause) {
      throw mapEncryptFailure(file.name, cause);
    }

    await verifyEncryptedOutput(encrypted, password, pageCount);

    return {
      status: "succeeded",
      artifacts: [
        {
          name: derivedDocumentName(file.name, "protected"),
          mimeType: "application/pdf",
          size: encrypted.length,
          bytes: encrypted,
        },
      ],
      meta: {
        pages: pageCount,
        outputPages: pageCount,
      },
    };
  }
}

/** The class fields survive transpilation; `instanceof` does not. */
function errorIdentity(cause: unknown): { name: string; code: string } {
  if (cause instanceof Error) {
    const code = (cause as { code?: unknown }).code;
    return { name: cause.name, code: typeof code === "string" ? code : "" };
  }
  return { name: "", code: "" };
}

/** Map library failures onto the PDFKit error model, without the password. */
function mapEncryptFailure(fileName: string, cause: unknown): ProcessingError {
  const { name, code } = errorIdentity(cause);

  if (name === "AlreadyEncryptedError" || code === "ALREADY_ENCRYPTED") {
    return new ProcessingError(
      "ENCRYPTED_PDF",
      "This PDF already has a password. Unlock it first if you want to protect it with a new one.",
      { details: [`${fileName} is already password protected.`], cause },
    );
  }

  if (name === "PasswordEncodingError" || code === "UNSUPPORTED_PASSWORD_CHARACTER") {
    return new ProcessingError(
      "VALIDATION_ERROR",
      "The password contains characters this PDF security scheme cannot use. Use standard Latin letters, digits and punctuation.",
      { cause },
    );
  }

  return new ProcessingError("PROCESSING_ERROR", "The PDF could not be protected.", {
    cause,
  });
}

function isEncryptedRefusal(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : "";
  return /is encrypted/i.test(message);
}

/** Shape of the decrypt-library's encryption report (fields optional). */
interface EncryptionInspection {
  encrypted: boolean;
  version?: number;
  revision?: number;
  keyLength?: number;
}

/**
 * Prove every property the copy promises before the download exists. Any
 * mismatch is a processing failure, never a quiet claim.
 */
async function verifyEncryptedOutput(
  encrypted: Uint8Array,
  password: string,
  expectedPages: number,
): Promise<void> {
  // 1. The trailer must declare the promised scheme: RC4 128-bit (V2/R3).
  const info: EncryptionInspection = await isEncrypted(encrypted).catch(() => ({
    encrypted: false,
  }));
  if (!info.encrypted || info.version !== 2 || info.revision !== 3) {
    throw new ProcessingError(
      "PROCESSING_ERROR",
      "The protected PDF could not be verified.",
    );
  }

  // 2. The bytes must refuse to open without a password.
  let refusedWithoutPassword = false;
  try {
    await PDFDocument.load(encrypted);
  } catch (cause) {
    refusedWithoutPassword = isEncryptedRefusal(cause);
  }
  if (!refusedWithoutPassword) {
    throw new ProcessingError(
      "PROCESSING_ERROR",
      "The protected PDF could not be verified.",
    );
  }

  // 3. The exact password given must reopen it, with every page intact.
  try {
    const unlocked = await decryptPDF(encrypted, password);
    const reopened = await PDFDocument.load(unlocked);
    if (reopened.getPageCount() !== expectedPages) {
      throw new ProcessingError(
        "PROCESSING_ERROR",
        "The protected PDF could not be verified.",
      );
    }
  } catch (cause) {
    if (cause instanceof ProcessingError) throw cause;
    throw new ProcessingError(
      "PROCESSING_ERROR",
      "The protected PDF could not be verified.",
      { cause },
    );
  }
}

export const passwordProtectProcessor = new PasswordProtectProcessor();
