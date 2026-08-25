import "server-only";

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
import { UNLOCK_PDF_INPUT_RULES } from "@/lib/processing/rules";
import { parseUnlockPdfOptions } from "@/lib/processing/unlock-pdf";

/**
 * Unlock PDF — real decryption with a password the user already has.
 *
 * Uses `@pdfsmaller/pdf-decrypt-lite`, which implements the legacy RC4
 * schemes: 40-bit (V1/R2) and 128-bit (V2/R3) — the latter is exactly what
 * Password Protect writes, so protect → unlock is a real round trip. The
 * decryption strips the `/Encrypt` dictionary from the trailer, producing an
 * ordinary PDF again.
 *
 * Honest about what is refused, with dedicated error codes:
 * - a document that is not protected at all → `PDF_NOT_ENCRYPTED`;
 * - a password that does not authenticate → `WRONG_PASSWORD` (the password
 *   itself is never echoed anywhere);
 * - AES-class encryption (V≥4, e.g. AES-128/AES-256) → `UNSUPPORTED_ENCRYPTION`.
 *
 * Nothing is claimed that was not measured: the unlocked bytes are verified by
 * re-opening them without a password before the download exists. This is not
 * password recovery — there is no guessing, only authentication with the
 * password supplied.
 */
export class UnlockPdfProcessor implements ToolProcessor {
  readonly toolId = "unlock-pdf";
  readonly input = UNLOCK_PDF_INPUT_RULES;

  async process(
    request: ProcessingRequest<Record<string, unknown>>,
  ): Promise<ProcessingSuccess> {
    const file = request.files[0];
    if (!file) {
      throw new ProcessingError("VALIDATION_ERROR", "No PDF was uploaded.");
    }

    const parsed = parseUnlockPdfOptions(request.options ?? {});
    if (!parsed.ok) {
      throw new ProcessingError("VALIDATION_ERROR", parsed.issue.message);
    }
    const { password } = parsed.options;

    // 1. Inspect the encryption dictionary before touching anything else.
    //    The reader throws for AES-class dictionaries and for documents it
    //    cannot parse at all — those are two different honest answers.
    let info: Awaited<ReturnType<typeof isEncrypted>>;
    try {
      info = await isEncrypted(file.bytes);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "";
      if (/unsupported encryption/i.test(message)) {
        throw new ProcessingError(
          "UNSUPPORTED_ENCRYPTION",
          "This PDF uses AES-class encryption, which Unlock PDF does not support. Only RC4-protected files (40-bit and 128-bit) can be unlocked here.",
          { cause },
        );
      }
      throw new ProcessingError("INVALID_PDF", "A PDF could not be opened.", {
        details: [`${file.name} is not a readable PDF document.`],
        cause,
      });
    }

    // 2. Only the legacy RC4 schemes are supported (the reader above already
    //    refuses the rest; this states the gate explicitly, without relying
    //    on library internals).
    if ((info.version ?? 0) > 3 || (info.revision ?? 0) > 4) {
      throw new ProcessingError(
        "UNSUPPORTED_ENCRYPTION",
        `This PDF uses AES-class encryption (V${info.version}/R${info.revision}), which Unlock PDF does not support. Only RC4-protected files (40-bit and 128-bit) can be unlocked here.`,
      );
    }

    if (!info.encrypted) {
      // "Not encrypted" is claimed only after the document genuinely parses —
      // a damaged file that merely lacks an /Encrypt entry is INVALID_PDF,
      // not a clean "nothing to remove".
      const document = await loadPdfDocument(file.name, file.bytes);
      readPageCount(document, file.name);
      throw new ProcessingError(
        "PDF_NOT_ENCRYPTED",
        "This PDF is not password-protected, so there is nothing to remove.",
      );
    }

    // 3. Decrypt with the supplied password. Authentication against the /O
    //    and /U values is all that happens — no recovery, no guessing.
    let decrypted: Uint8Array;
    try {
      decrypted = await decryptPDF(file.bytes, password);
    } catch (cause) {
      throw mapDecryptFailure(cause);
    }

    // 4. Verify what is promised: the output opens without any password and
    //    still carries every page. pdf-lib refuses encrypted input by
    //    default, so a successful load proves /Encrypt is really gone.
    let document: PDFDocument;
    try {
      document = await PDFDocument.load(decrypted, { updateMetadata: false });
    } catch (cause) {
      throw new ProcessingError(
        "PROCESSING_ERROR",
        "The unlocked PDF could not be verified.",
        { cause },
      );
    }
    const pageCount = readPageCount(document, file.name);

    return {
      status: "succeeded",
      artifacts: [
        {
          name: derivedDocumentName(file.name, "unlocked"),
          mimeType: "application/pdf",
          size: decrypted.length,
          bytes: decrypted,
        },
      ],
      meta: {
        pages: pageCount,
        outputPages: pageCount,
      },
    };
  }
}

/** Map library failures onto the PDFKit error model, without the password. */
function mapDecryptFailure(cause: unknown): ProcessingError {
  const message = cause instanceof Error ? cause.message : "";

  if (/incorrect password/i.test(message)) {
    return new ProcessingError(
      "WRONG_PASSWORD",
      "That password does not unlock this PDF. Check the password and try again.",
      { cause },
    );
  }

  if (/not encrypted/i.test(message)) {
    // Defensive: the pre-check above already handles this, but a race with a
    // malformed trailer should still report the honest code.
    return new ProcessingError(
      "PDF_NOT_ENCRYPTED",
      "This PDF is not password-protected, so there is nothing to remove.",
      { cause },
    );
  }

  if (/unsupported encryption/i.test(message)) {
    return new ProcessingError(
      "UNSUPPORTED_ENCRYPTION",
      "This PDF uses an encryption scheme Unlock PDF does not support. Only RC4-protected files (40-bit and 128-bit) can be unlocked here.",
      { cause },
    );
  }

  if (/could not read \/O or \/U/i.test(message)) {
    return new ProcessingError("INVALID_PDF", "A PDF could not be read.", {
      details: ["The encryption information in the PDF is damaged."],
      cause,
    });
  }

  return new ProcessingError("PROCESSING_ERROR", "The PDF could not be unlocked.", {
    cause,
  });
}

export const unlockPdfProcessor = new UnlockPdfProcessor();
