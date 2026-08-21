import "server-only";

import { PDFDocument } from "pdf-lib";
import type {
  ProcessingRequest,
  ProcessingSuccess,
  ToolProcessor,
} from "@/lib/processing/contract";
import {
  copyPagesInto,
  loadPdfDocument,
  readPageCount,
  readPageIndices,
  savePdfDocument,
  stampPdfKitMetadata,
} from "@/lib/processing/pdf-document";
import { MERGE_PDF_INPUT_RULES } from "@/lib/processing/rules";

export interface MergePdfOptions {
  /** File name offered to the browser. Sanitised by the API layer. */
  outputFileName?: string;
}

const DEFAULT_OUTPUT_NAME = "merged.pdf";

/**
 * Merge several PDFs into one, preserving the order the caller supplies.
 *
 * Runs entirely in memory: documents are parsed, their pages copied into a new
 * document, and the result serialised straight back to the caller. Nothing is
 * written to disk and nothing is retained after the request.
 */
export class MergePdfProcessor implements ToolProcessor<MergePdfOptions> {
  readonly toolId = "merge-pdf";
  // Merging needs at least two documents to be meaningful.
  readonly input = MERGE_PDF_INPUT_RULES;

  async process(
    request: ProcessingRequest<MergePdfOptions>,
  ): Promise<ProcessingSuccess> {
    const { files, options } = request;

    const merged = await PDFDocument.create();
    let totalPages = 0;

    // Order matters: iterate exactly in the order the user arranged the files.
    for (const file of files) {
      const source = await loadPdfDocument(file.name, file.bytes);
      const pageCount = readPageCount(source, file.name);
      const pageIndices = readPageIndices(source, file.name);

      await copyPagesInto(merged, source, pageIndices, file.name);
      totalPages += pageCount;
    }

    stampPdfKitMetadata(merged);
    const bytes = await savePdfDocument(merged);

    return {
      status: "succeeded",
      artifacts: [
        {
          name: options?.outputFileName?.trim() || DEFAULT_OUTPUT_NAME,
          mimeType: "application/pdf",
          size: bytes.length,
          bytes,
        },
      ],
      meta: {
        inputFiles: files.length,
        pages: totalPages,
      },
    };
  }
}

export const mergePdfProcessor = new MergePdfProcessor();
