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
  complementPages,
  countPagesInRanges,
  formatPageRanges,
  pagesToRanges,
  toZeroBasedIndices,
} from "@/lib/processing/pages";
import {
  copyPagesInto,
  loadPdfDocument,
  readPageCount,
  savePdfDocument,
  stampPdfKitMetadata,
} from "@/lib/processing/pdf-document";
import { resolveRequestedRanges } from "@/lib/processing/processors/page-selection-input";
import { DELETE_PDF_PAGES_INPUT_RULES } from "@/lib/processing/rules";

/** Options accepted by the Delete PDF Pages API. */
export interface DeletePdfPagesOptions {
  /** Pages to REMOVE, e.g. `"2, 4, 7-9"`. Validated server-side. */
  ranges?: string;
}

/**
 * Remove the selected pages and keep everything else.
 *
 * The mirror image of Extract PDF Pages: here the selection is the set of pages
 * to REMOVE, and the output is the complement — the surviving pages, always in
 * their original document order.
 */
export class DeletePdfPagesProcessor
  implements ToolProcessor<DeletePdfPagesOptions>
{
  readonly toolId = "delete-pdf-pages";
  readonly input = DELETE_PDF_PAGES_INPUT_RULES;

  async process(
    request: ProcessingRequest<DeletePdfPagesOptions>,
  ): Promise<ProcessingSuccess> {
    const file = request.files[0];
    if (!file) {
      throw new ProcessingError("VALIDATION_ERROR", "No PDF was uploaded.");
    }

    const source = await loadPdfDocument(file.name, file.bytes);
    const pageCount = readPageCount(source, file.name);

    const removedRanges = resolveRequestedRanges(request.options?.ranges, pageCount);
    const removedCount = countPagesInRanges(removedRanges);

    // The pages that survive, in original order.
    const keptPages = complementPages(removedRanges, pageCount);

    // A PDF cannot exist with zero pages — refuse before creating anything.
    if (keptPages.length === 0) {
      throw new ProcessingError(
        "NO_PAGES_REMAIN",
        "You must keep at least one page. Deselect at least one page and try again.",
      );
    }

    const output = await PDFDocument.create();
    await copyPagesInto(
      output,
      source,
      toZeroBasedIndices(pagesToRanges(keptPages)),
      file.name,
    );
    stampPdfKitMetadata(output);

    const bytes = await savePdfDocument(output);

    return {
      status: "succeeded",
      artifacts: [
        {
          name: derivedDocumentName(file.name, "pages-removed"),
          mimeType: "application/pdf",
          size: bytes.length,
          bytes,
        },
      ],
      meta: {
        pages: pageCount,
        outputPages: keptPages.length,
        removed: removedCount,
        selection: formatPageRanges(removedRanges),
      },
    };
  }
}

export const deletePdfPagesProcessor = new DeletePdfPagesProcessor();
