import "server-only";

import { PDFDocument } from "pdf-lib";
import type {
  ProcessingContext,
  ProcessingArtifact,
  ProcessingRequest,
  ProcessingSuccess,
  ToolProcessor,
} from "@/lib/processing/contract";
import { ProcessingError } from "@/lib/processing/errors";
import {
  everyPageRanges,
  formatPageRanges,
  isPageSelectionMode,
  parsePageRanges,
  toZeroBasedIndices,
  validatePageRanges,
  type PageRange,
  type PageSelectionMode,
} from "@/lib/processing/pages";
import {
  copyPagesInto,
  loadPdfDocument,
  readPageCount,
  savePdfDocument,
  stampPdfKitMetadata,
} from "@/lib/processing/pdf-document";
import { SPLIT_PDF_INPUT_RULES } from "@/lib/processing/rules";

/**
 * Options accepted by the Split PDF API.
 *
 * `ranges` is the raw string the user typed (`"1-3, 5, 7-9"`). It is parsed and
 * validated here, on the server, against the real page count — the client's
 * own validation is a convenience, never a source of truth.
 */
export interface SplitPdfOptions {
  mode: PageSelectionMode;
  ranges?: string;
}

/** `Q3 report.pdf` → `Q3 report`; used to name the outputs. */
function baseNameOf(fileName: string): string {
  const withoutPath = fileName.split(/[/\\]/).pop() ?? fileName;
  const withoutExtension = withoutPath.replace(/\.pdf$/i, "");
  const cleaned = withoutExtension
    // Strip C0 control characters.
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[^A-Za-z0-9._()\- \u00c0-\u024f]/g, "_")
    .trim()
    .slice(0, 80)
    .trim();
  return cleaned.length > 0 ? cleaned : "document";
}

/**
 * Split one PDF into several documents.
 *
 * Two modes:
 * - `every-page` — one output per page (`document-1.pdf`, `document-2.pdf`, …)
 * - `ranges` — one output per requested range (`document-part-1.pdf`, …)
 *
 * Page order always follows the requested ranges. Everything runs in memory and
 * the whole job fails cleanly rather than returning partial output.
 */
export class SplitPdfProcessor implements ToolProcessor<SplitPdfOptions> {
  readonly toolId = "split-pdf";
  readonly input = SPLIT_PDF_INPUT_RULES;

  async process(
    request: ProcessingRequest<SplitPdfOptions>,
    context: ProcessingContext,
  ): Promise<ProcessingSuccess> {
    const file = request.files[0];
    if (!file) {
      throw new ProcessingError("VALIDATION_ERROR", "No PDF was uploaded.");
    }

    const mode = request.options?.mode;
    if (!isPageSelectionMode(mode)) {
      throw new ProcessingError(
        "INVALID_SPLIT_CONFIGURATION",
        "Choose how the PDF should be split: every page, or by page ranges.",
      );
    }

    const source = await loadPdfDocument(file.name, file.bytes);
    const pageCount = readPageCount(source, file.name);

    const ranges = this.resolveRanges(mode, request.options?.ranges, pageCount);

    // Reject before generating anything: no partial output, ever.
    const maxOutputs = context.limits.maxOutputs;
    if (ranges.length > maxOutputs) {
      throw new ProcessingError(
        "TOO_MANY_OUTPUTS",
        `This would create ${ranges.length} PDFs, above the limit of ${maxOutputs}. ` +
          (mode === "every-page"
            ? "Split by page ranges instead, or use a shorter document."
            : "Use fewer ranges."),
      );
    }

    const baseName = baseNameOf(file.name);
    const suffix = mode === "every-page" ? "" : "part-";
    const artifacts: ProcessingArtifact[] = [];

    for (const [index, range] of ranges.entries()) {
      const output = await PDFDocument.create();
      await copyPagesInto(output, source, toZeroBasedIndices(range), file.name);
      stampPdfKitMetadata(output);

      const bytes = await savePdfDocument(output);
      artifacts.push({
        name: `${baseName}-${suffix}${index + 1}.pdf`,
        mimeType: "application/pdf",
        size: bytes.length,
        bytes,
      });
    }

    return {
      status: "succeeded",
      artifacts,
      bundleName: `${baseName}-split.zip`,
      meta: {
        pages: pageCount,
        outputs: artifacts.length,
        mode,
        selection: formatPageRanges(ranges),
      },
    };
  }

  /** Turn the requested mode into concrete, validated ranges. */
  private resolveRanges(
    mode: PageSelectionMode,
    rawRanges: string | undefined,
    pageCount: number,
  ): PageRange[] {
    if (mode === "every-page") {
      return everyPageRanges(pageCount);
    }

    const parsed = parsePageRanges(rawRanges ?? "");
    if (!parsed.ok) {
      throw new ProcessingError(
        parsed.issue.code === "OUT_OF_RANGE"
          ? "PAGE_OUT_OF_RANGE"
          : "INVALID_PAGE_RANGE",
        parsed.issue.message,
      );
    }

    const problem = validatePageRanges(parsed.ranges, pageCount);
    if (problem) {
      throw new ProcessingError(
        problem.code === "OUT_OF_RANGE"
          ? "PAGE_OUT_OF_RANGE"
          : problem.code === "OVERLAP"
            ? "OVERLAPPING_RANGES"
            : "INVALID_PAGE_RANGE",
        problem.message,
      );
    }

    return parsed.ranges;
  }
}

export const splitPdfProcessor = new SplitPdfProcessor();
