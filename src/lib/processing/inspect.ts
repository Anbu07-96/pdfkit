import "server-only";

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

  return { fileName: file.name, size: file.bytes.length, pageCount };
}
