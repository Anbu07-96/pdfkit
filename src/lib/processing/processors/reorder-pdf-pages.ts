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
  isIdentityPageOrder,
  parsePageOrder,
  validatePageOrder,
  type PageOrder,
} from "@/lib/processing/pages";
import {
  copyPagesInto,
  loadPdfDocument,
  readPageCount,
  savePdfDocument,
  stampPdfKitMetadata,
} from "@/lib/processing/pdf-document";
import { REORDER_PDF_PAGES_INPUT_RULES } from "@/lib/processing/rules";

/** Options accepted by the Reorder PDF Pages API. */
export interface ReorderPdfPagesOptions {
  /**
   * The complete new order, e.g. `"5,3,1,2,4"`. Must list every page of the
   * document exactly once. Validated here, against the real page count.
   */
  order?: string;
}

/**
 * Reorder the pages of one PDF.
 *
 * Unlike Extract ("keep these") and Delete ("remove these"), Reorder requires a
 * **complete permutation**: the output has exactly the same pages as the input,
 * each once, in the requested order. Anything else — a missing page, a
 * duplicate, an extra, a short list — is rejected before a page is copied.
 */
export class ReorderPdfPagesProcessor
  implements ToolProcessor<ReorderPdfPagesOptions>
{
  readonly toolId = "reorder-pdf-pages";
  readonly input = REORDER_PDF_PAGES_INPUT_RULES;

  async process(
    request: ProcessingRequest<ReorderPdfPagesOptions>,
  ): Promise<ProcessingSuccess> {
    const file = request.files[0];
    if (!file) {
      throw new ProcessingError("VALIDATION_ERROR", "No PDF was uploaded.");
    }

    const source = await loadPdfDocument(file.name, file.bytes);
    const pageCount = readPageCount(source, file.name);
    const order = this.resolveOrder(request.options?.order, pageCount);

    const output = await PDFDocument.create();
    // 1-based order → 0-based indices, in exactly the requested sequence.
    await copyPagesInto(
      output,
      source,
      order.map((page) => page - 1),
      file.name,
    );
    stampPdfKitMetadata(output);

    const bytes = await savePdfDocument(output);

    return {
      status: "succeeded",
      artifacts: [
        {
          name: derivedDocumentName(file.name, "reordered"),
          mimeType: "application/pdf",
          size: bytes.length,
          bytes,
        },
      ],
      meta: {
        pages: pageCount,
        outputPages: order.length,
        // Safe, non-identifying diagnostics only.
        changed: isIdentityPageOrder(order) ? "no" : "yes",
      },
    };
  }

  /** Parse and validate the requested order; never repairs bad input. */
  private resolveOrder(raw: string | undefined, pageCount: number): PageOrder {
    const parsed = parsePageOrder(raw ?? "");
    if (!parsed.ok) {
      throw new ProcessingError("INVALID_PAGE_ORDER", parsed.issue.message);
    }

    const problem = validatePageOrder(parsed.order, pageCount);
    if (problem) {
      throw new ProcessingError(
        problem.code === "OUT_OF_RANGE" ? "PAGE_OUT_OF_RANGE" : "INVALID_PAGE_ORDER",
        problem.message,
      );
    }

    return parsed.order;
  }
}

export const reorderPdfPagesProcessor = new ReorderPdfPagesProcessor();
