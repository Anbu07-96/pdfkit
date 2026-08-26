import "server-only";

import type {
  ProcessingContext,
  ProcessingRequest,
  ProcessingSuccess,
  ToolProcessor,
} from "@/lib/processing/contract";
import { ProcessingError } from "@/lib/processing/errors";
import { baseDocumentName } from "@/lib/processing/file-names";
import { extractPdfPageTexts } from "@/lib/thumbnails/renderer";
import {
  createExcelWorkbookBuffer,
  parseTextToTableRows,
  type ExtractedTable,
} from "@/lib/processing/tables";
import { PDF_TO_EXCEL_INPUT_RULES } from "@/lib/processing/rules";

export const pdfToExcelProcessor: ToolProcessor<Record<string, unknown>> = {
  toolId: "pdf-to-excel",
  input: PDF_TO_EXCEL_INPUT_RULES,

  async process(
    request: ProcessingRequest<Record<string, unknown>>,
    context: ProcessingContext,
  ): Promise<ProcessingSuccess> {
    if (request.files.length !== 1) {
      throw new ProcessingError(
        "TOO_MANY_FILES",
        "Send exactly one PDF document to convert to Excel.",
      );
    }

    const file = request.files[0];
    const { pageCount, texts } = await extractPdfPageTexts(file.bytes, {
      maxPages: context.limits.maxConversionPages,
    });

    const tables: ExtractedTable[] = [];
    let totalRows = 0;

    texts.forEach((text, index) => {
      const rows = parseTextToTableRows(text);
      tables.push({
        pageNumber: index + 1,
        rows: rows.length > 0 ? rows : [["[This page contains no extractable tabular text]"]],
      });
      totalRows += rows.length;
    });

    const xlsxBytes = await createExcelWorkbookBuffer(tables);
    const baseName = baseDocumentName(file.name);

    return {
      status: "succeeded",
      artifacts: [
        {
          name: `${baseName}.xlsx`,
          mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          size: xlsxBytes.length,
          bytes: xlsxBytes,
        },
      ],
      meta: {
        pages: pageCount,
        tablesFound: tables.length,
        rowsExtracted: totalRows,
      },
    };
  },
};
