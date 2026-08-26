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
  createCsvString,
  createExcelWorkbookBuffer,
  parseTextToTableRows,
  type ExtractedTable,
} from "@/lib/processing/tables";
import { EXTRACT_TABLES_INPUT_RULES } from "@/lib/processing/rules";

export const extractTablesProcessor: ToolProcessor<Record<string, unknown>> = {
  toolId: "extract-tables",
  input: EXTRACT_TABLES_INPUT_RULES,

  async process(
    request: ProcessingRequest<Record<string, unknown>>,
    context: ProcessingContext,
  ): Promise<ProcessingSuccess> {
    if (request.files.length !== 1) {
      throw new ProcessingError(
        "TOO_MANY_FILES",
        "Send exactly one PDF document to extract tables.",
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
      if (rows.length > 0) {
        tables.push({ pageNumber: index + 1, rows });
        totalRows += rows.length;
      }
    });

    const format = typeof request.options?.format === "string" ? request.options.format : "xlsx";
    const baseName = baseDocumentName(file.name);

    if (format === "csv") {
      const csvContent = createCsvString(tables);
      const csvBytes = new TextEncoder().encode(csvContent);

      return {
        status: "succeeded",
        artifacts: [
          {
            name: `${baseName}-tables.csv`,
            mimeType: "text/csv; charset=utf-8",
            size: csvBytes.length,
            bytes: csvBytes,
          },
        ],
        meta: {
          pages: pageCount,
          tablesFound: tables.length,
          rowsExtracted: totalRows,
        },
      };
    }

    const xlsxBytes = await createExcelWorkbookBuffer(tables);

    return {
      status: "succeeded",
      artifacts: [
        {
          name: `${baseName}-tables.xlsx`,
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
