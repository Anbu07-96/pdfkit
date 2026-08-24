import "server-only";

import { PDFName, type PDFDocument } from "pdf-lib";
import type { DocumentMetadata } from "@/lib/processing/metadata";
import { loadPdfDocument, readPageCount } from "@/lib/processing/pdf-document";
import type { ProcessingInputFile } from "@/lib/processing/contract";
import { getProcessingLimits, type ProcessingLimits } from "@/lib/processing/limits";
import { SINGLE_PDF_INPUT_RULES } from "@/lib/processing/rules";
import { validateProcessingInput } from "@/lib/processing/validation/pdf-input";

/**
 * Document inspection.
 *
 * Reading a document's page count is page-level infrastructure rather than a
 * tool: Split PDF needs it today, and Extract/Delete/Reorder Pages will need
 * exactly the same thing. The server is the only authority on page count — the
 * browser never reports it.
 */

export interface PdfInspection {
  fileName: string;
  size: number;
  pageCount: number;
  /**
   * Document metadata (Phase 11). Absent entries are reported as `null`, never
   * invented. Additive: consumers that only need the page count simply ignore it.
   */
  metadata: DocumentMetadata;
}

/** `undefined` from pdf-lib's getters becomes an honest `null`. */
function textOrNull(value: string | undefined): string | null {
  return value === undefined ? null : value;
}

function dateOrNull(value: Date | undefined): string | null {
  return value === undefined ? null : value.toISOString();
}

/**
 * Read the common Info-dictionary properties of a loaded document.
 *
 * pdf-lib keeps Keywords as one decoded string (its array setter joins with
 * spaces), so the readout splits the stored string on commas; a document
 * without commas simply reports a one-entry list.
 */
export function readDocumentMetadata(document: PDFDocument): DocumentMetadata {
  const rawKeywords = document.getKeywords();
  const keywords = rawKeywords
    ? rawKeywords
        .split(",")
        .map((keyword) => keyword.trim())
        .filter((keyword) => keyword.length > 0)
    : null;

  return {
    title: textOrNull(document.getTitle()),
    author: textOrNull(document.getAuthor()),
    subject: textOrNull(document.getSubject()),
    keywords,
    creator: textOrNull(document.getCreator()),
    producer: textOrNull(document.getProducer()),
    creationDate: dateOrNull(document.getCreationDate()),
    modificationDate: dateOrNull(document.getModificationDate()),
    // The XMP stream hangs off the catalog as /Metadata; presence is all the
    // readout reports — its contents are never parsed or echoed.
    xmpPresent: document.catalog.get(PDFName.of("Metadata")) !== undefined,
  };
}

export async function inspectPdf(
  file: ProcessingInputFile,
  limits: ProcessingLimits = getProcessingLimits(),
): Promise<PdfInspection> {
  // Same validation any processor gets: type, size, emptiness, PDF signature.
  validateProcessingInput({
    files: [file],
    rules: SINGLE_PDF_INPUT_RULES,
    limits,
  });

  const document = await loadPdfDocument(file.name, file.bytes);
  const pageCount = readPageCount(document, file.name);

  return {
    fileName: file.name,
    size: file.bytes.length,
    pageCount,
    metadata: readDocumentMetadata(document),
  };
}
