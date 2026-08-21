import "server-only";

import { PDFDocument } from "pdf-lib";
import type {
  ProcessingRequest,
  ProcessingSuccess,
  ToolProcessor,
} from "@/lib/processing/contract";
import { ProcessingError } from "@/lib/processing/errors";
import { derivedDocumentName } from "@/lib/processing/file-names";
import {
  countPagesInRanges,
  formatPageRanges,
  toZeroBasedIndices,
  type PageRange,
} from "@/lib/processing/pages";
import {
  copyPagesInto,
  loadPdfDocument,
  readPageCount,
  savePdfDocument,
  stampPdfKitMetadata,
} from "@/lib/processing/pdf-document";
import { resolveRequestedRanges } from "@/lib/processing/processors/page-selection-input";
import { EXTRACT_PDF_PAGES_INPUT_RULES } from "@/lib/processing/rules";

/** Options accepted by the Extract PDF Pages API. */
export interface ExtractPdfPagesOptions {
  /** Raw user input, e.g. `"1-3, 5, 8-10"`. Validated server-side. */
  ranges?: string;
}

/**
 * Keep only the selected pages, in the order the user selected them.
 *
 * The selection is the set of pages to KEEP (Delete PDF Pages is the mirror
 * image). Order is meaningful: `8-10, 1-2` produces pages 8, 9, 10, 1, 2.
 */
export class ExtractPdfPagesProcessor
  implements ToolProcessor<ExtractPdfPagesOptions>
{
  readonly toolId = "extract-pdf-pages";
  readonly input = EXTRACT_PDF_PAGES_INPUT_RULES;

  async process(
    request: ProcessingRequest<ExtractPdfPagesOptions>,
  ): Promise<ProcessingSuccess> {
    const file = request.files[0];
    if (!file) {
      throw new ProcessingError("VALIDATION_ERROR", "No PDF was uploaded.");
    }

    const source = await loadPdfDocument(file.name, file.bytes);
    const pageCount = readPageCount(source, file.name);

    // Validated before a single page is copied: no partial output.
    const ranges: PageRange[] = resolveRequestedRanges(
      request.options?.ranges,
      pageCount,
    );
    const keptPages = countPagesInRanges(ranges);

    const output = await PDFDocument.create();
    // One copy call keeps the requested order intact across all ranges.
    await copyPagesInto(output, source, toZeroBasedIndices(ranges), file.name);
    stampPdfKitMetadata(output);

    const bytes = await savePdfDocument(output);

    return {
      status: "succeeded",
      artifacts: [
        {
          name: derivedDocumentName(file.name, "extracted"),
          mimeType: "application/pdf",
          size: bytes.length,
          bytes,
        },
      ],
      meta: {
        pages: pageCount,
        outputPages: keptPages,
        selection: formatPageRanges(ranges),
      },
    };
  }
}

export const extractPdfPagesProcessor = new ExtractPdfPagesProcessor();
