import type { BulkFileResult } from "@/lib/bulk/runner";

/**
 * Client-side batch result CSV (Phase 62).
 *
 * One row per input file, generated entirely in the browser — nothing about
 * the batch is uploaded or stored to produce it. Rows contain only
 * operational facts (names, sizes, statuses, durations, error codes); never
 * document contents, text, passwords or tokens.
 *
 * Safety:
 * - RFC 4180 escaping: fields containing commas, quotes or line breaks are
 *   quoted, embedded quotes are doubled.
 * - Spreadsheet formula injection: filenames come from the user's own files,
 *   but a name like `=HYPERLINK(...)` would execute when the CSV is opened in
 *   Excel/Sheets. Any field starting with `=`, `+`, `-` or `@` is prefixed
 *   with an apostrophe so it renders as text.
 * - Output is UTF-8 (callers prepend a BOM for spreadsheet compatibility).
 */

export interface BatchCsvInput {
  /** Bulk operation id, e.g. "pdf-to-word". */
  operation: string;
  /** Per-file results in batch order. */
  results: readonly BulkFileResult[];
}

const CSV_COLUMNS = [
  "filename",
  "operation",
  "status",
  "output_filename",
  "input_bytes",
  "output_bytes",
  "duration_ms",
  "error_code",
  "error_message",
] as const;

/** Characters that turn a CSV field into a formula in spreadsheet apps. */
const FORMULA_PREFIX = /^[=+\-@]/;

function escapeCsvField(value: string): string {
  // Formula guard first: a leading =, +, - or @ must never reach a
  // spreadsheet engine as the start of a cell.
  let field = value;
  if (FORMULA_PREFIX.test(field)) {
    field = `'${field}`;
  }

  // RFC 4180: quote when the field contains a comma, a quote, or any line
  // break; double embedded quotes.
  if (/[",\r\n]/.test(field)) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

/**
 * Build the batch summary CSV (without BOM).
 */
export function buildBatchCsv({
  operation,
  results,
}: BatchCsvInput): string {
  const lines: string[] = [CSV_COLUMNS.join(",")];

  for (const result of results) {
    lines.push(
      [
        result.name,
        operation,
        result.status,
        result.fileName ?? "",
        String(result.size),
        result.blob ? String(result.blob.size) : "",
        result.durationMs !== undefined ? String(result.durationMs) : "",
        result.error?.code ?? "",
        result.error?.message ?? "",
      ]
        .map(escapeCsvField)
        .join(","),
    );
  }

  // Trailing CRLF per RFC 4180; embedded newlines inside quoted fields are
  // preserved as-is.
  return `${lines.join("\r\n")}\r\n`;
}

/** Suggested download filename for a batch CSV. */
export function batchCsvFileName(operation: string): string {
  return `${operation}-batch-results.csv`;
}
