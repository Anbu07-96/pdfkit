import "server-only";

import type {
  ProcessingContext,
  ProcessingRequest,
  ProcessingSuccess,
  ToolProcessor,
} from "@/lib/processing/contract";
import { ProcessingError } from "@/lib/processing/errors";
import { comparePageTexts, formatComparisonReport } from "@/lib/processing/compare";
import { extractPdfPageTexts } from "@/lib/thumbnails/renderer";
import { COMPARE_DOCUMENTS_INPUT_RULES } from "@/lib/processing/rules";

export const compareDocumentsProcessor: ToolProcessor<Record<string, unknown>> = {
  toolId: "compare-documents",
  input: COMPARE_DOCUMENTS_INPUT_RULES,

  async process(
    request: ProcessingRequest<Record<string, unknown>>,
    context: ProcessingContext,
  ): Promise<ProcessingSuccess> {
    if (request.files.length !== 2) {
      throw new ProcessingError(
        "VALIDATION_ERROR",
        "Upload exactly two PDF documents to compare (Document A and Document B).",
      );
    }

    const fileA = request.files[0];
    const fileB = request.files[1];

    const [resA, resB] = await Promise.all([
      extractPdfPageTexts(fileA.bytes, { maxPages: context.limits.maxConversionPages }),
      extractPdfPageTexts(fileB.bytes, { maxPages: context.limits.maxConversionPages }),
    ]);

    const comparison = comparePageTexts(fileA.name, fileB.name, resA.texts, resB.texts);
    const reportText = formatComparisonReport(comparison);
    const reportBytes = new TextEncoder().encode(reportText);

    return {
      status: "succeeded",
      artifacts: [
        {
          name: "document-comparison-report.txt",
          mimeType: "text/plain; charset=utf-8",
          size: reportBytes.length,
          bytes: reportBytes,
        },
      ],
      meta: {
        pagesDocA: resA.pageCount,
        pagesDocB: resB.pageCount,
        modifiedPages: comparison.pageDiffs.filter((p) => !p.identical).length,
      },
    };
  },
};
