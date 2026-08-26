import "server-only";

import ExcelJS from "exceljs";

export interface ExtractedTable {
  pageNumber: number;
  rows: string[][];
}

/**
 * Sanitizes cell text to prevent formula injection in Excel/CSV viewers.
 * Cells starting with =, +, -, @, \t, or \r are prepended with a single quote.
 */
export function sanitizeCellText(cell: string): string {
  if (typeof cell !== "string") return "";
  const isFormula = /^[=+\-@\t\r]/.test(cell) || /^[=+\-@\t\r]/.test(cell.trim());
  const trimmed = cell.trim();
  if (isFormula && trimmed.length > 0) {
    return `'${trimmed}`;
  }
  return trimmed;
}

/**
 * Extracts tabular text rows from plain text lines.
 */
export function parseTextToTableRows(text: string): string[][] {
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  const rows: string[][] = [];

  for (const line of lines) {
    if (line.startsWith("--- Page ")) continue;
    // Split on 2 or more spaces or tab characters to separate columns
    const cells = line
      .split(/\t+|\s{2,}/)
      .map((c) => sanitizeCellText(c))
      .filter((c) => c.length > 0);

    if (cells.length > 0) {
      rows.push(cells);
    }
  }

  return rows;
}

/**
 * Generates an Excel XLSX buffer from table rows using exceljs.
 */
export async function createExcelWorkbookBuffer(
  tables: ExtractedTable[],
): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "PDFKit";
  workbook.created = new Date();

  for (const table of tables) {
    const sheet = workbook.addWorksheet(`Page ${table.pageNumber}`);
    for (const row of table.rows) {
      const sanitizedRow = row.map((cell) => sanitizeCellText(cell));
      sheet.addRow(sanitizedRow);
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}

/**
 * Converts table rows to CSV format string with formula injection protection.
 */
export function createCsvString(tables: ExtractedTable[]): string {
  const lines: string[] = [];

  for (const table of tables) {
    lines.push(`--- Page ${table.pageNumber} ---`);
    for (const row of table.rows) {
      const csvRow = row
        .map((cell) => {
          const sanitized = sanitizeCellText(cell);
          return `"${sanitized.replace(/"/g, '""')}"`;
        })
        .join(",");
      lines.push(csvRow);
    }
    lines.push("");
  }

  return lines.join("\n");
}
