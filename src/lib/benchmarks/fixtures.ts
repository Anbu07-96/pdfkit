import "server-only";

import {
  makeBrokenPdf,
  makeJpeg,
  makePdf,
} from "@/test/pdf-fixtures";
import type { BenchmarkFixture } from "@/lib/benchmarks/types";

/**
 * The Phase 71 benchmark fixture corpus.
 *
 * Every fixture is SYNTHETIC, generated in memory by repository-owned
 * builders (pdf-lib test fixture code and Phase 71 builders below). Nothing
 * is downloaded; no copyrighted or customer documents are used; no personal
 * data exists anywhere in the corpus. Anchor tokens are machine-generated
 * strings (PDFKIT-*) planted so content preservation is objectively
 * measurable — the anchors themselves are the only "content" and are
 * synthetic by construction.
 *
 * The corpus maps the Phase 70 readiness document's categories onto bounded,
 * fast fixtures; the 30-page "large" fixture keeps suite runtime sane while
 * still exercising multi-page state.
 */

/** Column geometry shared by the multicolumn fixture. */
const COLUMN_LEFT_X = 20;
const COLUMN_RIGHT_X = 220;
const COLUMN_TOP_Y = 250;
const COLUMN_ROW_STEP = 30;
const COLUMN_ROWS = 5;

function columnAnchor(side: "L" | "R", row: number): string {
  return `PDFKIT-COL-${side}-${String(row).padStart(2, "0")}`;
}

/** Two text columns; the RIGHT column is drawn FIRST so raw content-stream
 * order differs from reading order — the honest case where positioned text
 * (x/y transforms) can reconstruct the correct order and plain concatenation
 * cannot. */
async function buildMulticolumnPdf(): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([400, 300]);

  // Right column first: content-stream order is deliberately not reading order.
  for (let row = 1; row <= COLUMN_ROWS; row += 1) {
    page.drawText(columnAnchor("R", row), {
      x: COLUMN_RIGHT_X,
      y: COLUMN_TOP_Y - row * COLUMN_ROW_STEP,
      size: 12,
      font,
    });
  }
  for (let row = 1; row <= COLUMN_ROWS; row += 1) {
    page.drawText(columnAnchor("L", row), {
      x: COLUMN_LEFT_X,
      y: COLUMN_TOP_Y - row * COLUMN_ROW_STEP,
      size: 12,
      font,
    });
  }
  return document.save();
}

/** Aligned table rows: three columns separated by wide spaces, the shape the
 * current whitespace heuristic is built for. */
async function buildTablePdf(): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([500, 300]);
  for (let row = 1; row <= 4; row += 1) {
    page.drawText(
      `PDFKIT-T-R${row}C1   PDFKIT-T-R${row}C2   PDFKIT-T-R${row}C3`,
      { x: 20, y: 250 - row * 30, size: 12, font },
    );
  }
  return document.save();
}

/** Page 1 carries text; page 2 is a full-bleed JPEG with no text layer. */
async function buildMixedPdf(): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page1 = document.addPage([300, 300]);
  page1.drawText("PDFKIT-MIXED-TEXT-1", { x: 20, y: 150, size: 14, font });

  const jpeg = await makeJpeg(60, 80);
  const image = await document.embedJpg(jpeg);
  const page2 = document.addPage([300, 300]);
  page2.drawImage(image, { x: 0, y: 0, width: 300, height: 300 });
  return document.save();
}

const PROVENANCE =
  "Synthetic, generated in memory by repository-owned fixture builders (Phase 71); pdf-lib emitted; no downloaded or copyrighted content.";

export const BENCHMARK_FIXTURES: readonly BenchmarkFixture[] = [
  {
    id: "F-01-text-single",
    version: 1,
    category: "text",
    purpose: "Baseline single-page text extraction fidelity.",
    provenance: PROVENANCE,
    build: () => makePdf(["PDFKIT-ANCHOR-SINGLE"]),
    expected: { pageCount: 1, anchors: ["PDFKIT-ANCHOR-SINGLE"] },
  },
  {
    id: "F-02-text-multi",
    version: 1,
    category: "text",
    purpose: "Multi-page coverage: every page's anchor must survive.",
    provenance: PROVENANCE,
    build: () =>
      makePdf([
        "PDFKIT-ANCHOR-P1",
        "PDFKIT-ANCHOR-P2",
        "PDFKIT-ANCHOR-P3",
        "PDFKIT-ANCHOR-P4",
        "PDFKIT-ANCHOR-P5",
      ]),
    expected: {
      pageCount: 5,
      anchors: [
        "PDFKIT-ANCHOR-P1",
        "PDFKIT-ANCHOR-P2",
        "PDFKIT-ANCHOR-P3",
        "PDFKIT-ANCHOR-P4",
        "PDFKIT-ANCHOR-P5",
      ],
    },
  },
  {
    id: "F-03-table-aligned",
    version: 1,
    category: "table",
    purpose: "Aligned-column table rows for row/column preservation.",
    provenance: PROVENANCE,
    build: buildTablePdf,
    expected: {
      pageCount: 1,
      anchors: ["PDFKIT-T-R1C1", "PDFKIT-T-R4C3"],
      tableRowsExpected: 4,
    },
  },
  {
    id: "F-04-multicolumn",
    version: 1,
    category: "multicolumn",
    purpose:
      "Reading-order reconstruction: positioned text can restore left-before-right; plain concatenation of the content stream cannot.",
    provenance: PROVENANCE,
    build: buildMulticolumnPdf,
    expected: {
      pageCount: 1,
      anchors: Array.from({ length: COLUMN_ROWS }, (_, index) =>
        columnAnchor("L", index + 1),
      ).concat(
        Array.from({ length: COLUMN_ROWS }, (_, index) =>
          columnAnchor("R", index + 1),
        ),
      ),
      columnPairs: Array.from({ length: COLUMN_ROWS }, (_, index) => [
        columnAnchor("L", index + 1),
        columnAnchor("R", index + 1),
      ] as const),
    },
  },
  {
    id: "F-05-mixed-text-image",
    version: 1,
    category: "mixed",
    purpose: "Text page + image-only page: partial-text documents.",
    provenance: PROVENANCE,
    build: buildMixedPdf,
    expected: { pageCount: 2, anchors: ["PDFKIT-MIXED-TEXT-1"], imageOnlyPages: [2] },
  },
  {
    id: "F-06-scanned",
    version: 1,
    category: "scanned",
    purpose:
      "Image-only pages: no OCR exists; honest engines report no text rather than fabricating it.",
    provenance: PROVENANCE,
    build: () => makeScannedPdfFixture(),
    expected: { pageCount: 2, anchors: [], imageOnlyPages: [1, 2] },
  },
  {
    id: "F-07-large",
    version: 1,
    category: "large",
    purpose: "30-page document: multi-page state, performance and page coverage.",
    provenance: PROVENANCE,
    build: async () =>
      makePdf(Array.from({ length: 30 }, (_, index) => `PDFKIT-ANCHOR-L${index + 1}`)),
    expected: {
      pageCount: 30,
      anchors: ["PDFKIT-ANCHOR-L1", "PDFKIT-ANCHOR-L15", "PDFKIT-ANCHOR-L30"],
    },
  },
  {
    id: "F-08-malformed",
    version: 1,
    category: "malformed",
    purpose: "Bytes that claim to be a PDF but are not: failure behavior.",
    provenance: PROVENANCE,
    build: async () => makeBrokenPdf(),
    expected: { pageCount: 0, anchors: [], expectsFailure: true },
  },
];

/** The scanned fixture uses the existing repo builder (deterministic noise). */
async function makeScannedPdfFixture(): Promise<Uint8Array> {
  const { makeScannedPdf } = await import("@/test/pdf-fixtures");
  return makeScannedPdf(2);
}

export function getFixture(id: string): BenchmarkFixture {
  const fixture = BENCHMARK_FIXTURES.find((candidate) => candidate.id === id);
  if (!fixture) throw new Error(`Unknown benchmark fixture: ${id}`);
  return fixture;
}
