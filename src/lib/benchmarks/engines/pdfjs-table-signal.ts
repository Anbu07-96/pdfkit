import "server-only";

import type { BenchmarkEngine } from "@/lib/benchmarks/types";
import {
  loadPositionedTextPages,
  type PdfjsDocumentLoader,
  type PositionedTextItem,
} from "@/lib/processing/pdfjs/positioned-text";

/**
 * BENCHMARK-ONLY component engine (Phase 72): PDF.js positioned text as a
 * TABLE SIGNAL.
 *
 * IMPORTANT SCOPE (§10 of the phase spec): this is COMPONENT-LEVEL
 * evidence. PDF.js does not implement table reconstruction; this adapter
 * applies a simple, fully documented grouping of PDF.js positioned items
 * (the parsing component an extract-tables engine could consume) and emits
 * the same CSV artifact shape the current engine produces, so both sides
 * are scored by the SAME ground-truth metrics. It is NOT a complete
 * extract-tables alternative and must never be presented as one.
 *
 * The documented algorithm (no ground truth is used anywhere in it):
 *
 * 1. group positioned items into visual lines by y (2-unit buckets);
 * 2. sort each line by x;
 * 3. split a line into cells where the x-gap to the previous run exceeds
 *    TABLE_CELL_GAP_UNITS, AND additionally split inside a run wherever it
 *    contains 2+ consecutive spaces (single-run rows must still split);
 * 4. emit one CSV section per page, mirroring the current engine's CSV
 *    artifact shape so metrics are computed identically.
 */

/**
 * Horizontal gap (PDF units) that separates two cells on a visual line.
 * Geometric rationale: a single space at 12 pt Helvetica spans ~3.3 units
 * (within-cell word gap), while a 3-space cell separator spans ~10 units.
 * A 6-unit threshold splits cells without splitting words.
 */
const TABLE_CELL_GAP_UNITS = 6;

/** Group positioned items into visual lines (y-bucketed, top of page first). */
function groupIntoLines(items: readonly PositionedTextItem[]): PositionedTextItem[][] {
  const lines = new Map<number, PositionedTextItem[]>();
  for (const piece of items) {
    const key = Math.round(piece.y / 2) * 2;
    const bucket = lines.get(key);
    if (bucket) bucket.push(piece);
    else lines.set(key, [piece]);
  }
  return [...lines.keys()].sort((a, b) => b - a).map((key) => {
    const line = lines.get(key)!;
    line.sort((a, b) => a.x - b.x);
    return line;
  });
}

/** Split one visual line into cell strings. */
function lineToCells(line: readonly PositionedTextItem[]): string[] {
  const cells: string[] = [];
  let current: string[] = [];
  let previousEnd: number | null = null;
  const flush = () => {
    const joined = current.join(" ").trim();
    if (joined.length > 0) cells.push(joined);
    current = [];
  };
  for (const piece of line) {
    const gap = previousEnd === null ? 0 : piece.x - previousEnd;
    if (previousEnd !== null && gap > TABLE_CELL_GAP_UNITS) flush();
    // Inside one run, wide internal spaces also separate cells.
    const segments = piece.str
      .split(/\s{2,}/)
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0);
    segments.forEach((segment, index) => {
      if (index > 0) flush();
      current.push(segment);
    });
    previousEnd = piece.x + (piece.width ?? piece.str.length * 6);
  }
  flush();
  return cells;
}

/** The PDF.js table-signal component: positioned text → grouped CSV rows. */
export function createPdfjsTableSignalCandidate(
  options: { loadDocument?: PdfjsDocumentLoader } = {},
): BenchmarkEngine {
  return {
    id: "candidate-pdfjs-table-signal",
    version: "0.2.0 (production pdfjs positioned-item core)",
    conversion: "extract-tables",
    async run(file) {
      const { numPages, pages } = await loadPositionedTextPages(
        file.bytes,
        options.loadDocument ? { loadDocument: options.loadDocument } : {},
      );
      const sections: string[] = [];
      let totalRows = 0;
      let tablesFound = 0;
      pages.forEach((items, index) => {
        const rows = groupIntoLines(items)
          .map(lineToCells)
          .filter((cells) => cells.length > 0);
        if (rows.length > 0) {
          tablesFound += 1;
          sections.push(`--- Page ${index + 1} ---`);
          for (const row of rows) {
            sections.push(row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(","));
          }
          totalRows += rows.length;
        }
      });
      const csv = sections.join("\n");
      const bytes = new TextEncoder().encode(csv);
      return {
        artifacts: [
          {
            name: "benchmark-table-signal.csv",
            mimeType: "text/csv; charset=utf-8",
            size: bytes.length,
            bytes,
          },
        ],
        meta: {
          pages: numPages,
          tablesFound,
          rowsExtracted: totalRows,
        },
      };
    },
  };
}
