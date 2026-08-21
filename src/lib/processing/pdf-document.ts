import "server-only";

import { EncryptedPDFError, PDFDocument } from "pdf-lib";
import { ProcessingError } from "@/lib/processing/errors";

/**
 * Shared, defensive pdf-lib access.
 *
 * Every processor opens documents through here so that malformed and
 * password-protected files are reported identically, and so the lazy-parsing
 * traps only have to be handled once.
 */

/**
 * pdf-lib's error classes are transpiled in a way that breaks `instanceof`
 * across module boundaries, so the message is checked as well.
 */
function isEncryptedPdfError(error: unknown): boolean {
  if (error instanceof EncryptedPDFError) return true;
  const message = error instanceof Error ? error.message : "";
  return /is encrypted/i.test(message);
}

/** Open a document, mapping library failures onto the PDFKit error model. */
export async function loadPdfDocument(
  name: string,
  bytes: Uint8Array,
): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes, {
      // Encrypted documents must be reported, not silently mangled.
      ignoreEncryption: false,
      updateMetadata: false,
    });
  } catch (cause) {
    if (isEncryptedPdfError(cause)) {
      throw new ProcessingError(
        "ENCRYPTED_PDF",
        "Password-protected PDFs cannot be processed yet.",
        {
          details: [`${name} is password protected. Unlock it and try again.`],
          cause,
        },
      );
    }

    throw new ProcessingError("INVALID_PDF", "A PDF could not be opened.", {
      details: [`${name} is not a readable PDF document.`],
      cause,
    });
  }
}

/**
 * Read the page count.
 *
 * pdf-lib parses lazily, so a damaged document often loads without complaint
 * and only fails when its page tree is touched — that failure is caught here.
 */
export function readPageCount(document: PDFDocument, name: string): number {
  let pageCount: number;
  try {
    pageCount = document.getPageCount();
  } catch (cause) {
    throw new ProcessingError("INVALID_PDF", "A PDF could not be read.", {
      details: [`${name} could not be read — the file may be damaged.`],
      cause,
    });
  }

  if (pageCount === 0) {
    throw new ProcessingError("INVALID_PDF", "A PDF contains no pages.", {
      details: [`${name} has no pages.`],
    });
  }

  return pageCount;
}

/** Page indices (0-based) of a document, guarded the same way. */
export function readPageIndices(document: PDFDocument, name: string): number[] {
  try {
    return document.getPageIndices();
  } catch (cause) {
    throw new ProcessingError("INVALID_PDF", "A PDF could not be read.", {
      details: [`${name} could not be read — the file may be damaged.`],
      cause,
    });
  }
}

/**
 * Copy pages (0-based indices) from `source` into `target`, in the given order.
 * Copy failures are reported rather than producing a partial document.
 */
export async function copyPagesInto(
  target: PDFDocument,
  source: PDFDocument,
  indices: readonly number[],
  name: string,
): Promise<void> {
  let copied;
  try {
    copied = await target.copyPages(source, [...indices]);
  } catch (cause) {
    throw new ProcessingError("INVALID_PDF", "A PDF could not be read completely.", {
      details: [`${name} could not be processed — the file may be damaged.`],
      cause,
    });
  }

  for (const page of copied) target.addPage(page);
}

/** Serialise a document, mapping failures onto a safe processing error. */
export async function savePdfDocument(document: PDFDocument): Promise<Uint8Array> {
  try {
    return await document.save({ useObjectStreams: true });
  } catch (cause) {
    throw new ProcessingError(
      "PROCESSING_ERROR",
      "The resulting PDF could not be created.",
      { cause },
    );
  }
}

/** Marks documents PDFKit produces. pdf-lib always stamps its own Producer. */
export function stampPdfKitMetadata(document: PDFDocument): void {
  document.setCreator("PDFKit");
  document.setCreationDate(new Date());
  document.setModificationDate(new Date());
}
