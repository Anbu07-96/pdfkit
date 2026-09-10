import "server-only";

import type { ApplicabilityEntry } from "@/lib/benchmarks/types";

/**
 * Phase 72 candidate applicability matrix (§2 of the phase spec).
 *
 * Answers ONE question per conversion: can pdfjs-dist meaningfully compete,
 * and if so — on the WHOLE conversion (direct) or only on a parsing/text
 * component? The matrix is data so tests and the evidence report share the
 * exact same statements.
 *
 * Facts this matrix is built on (verified from repository source in Phase 72
 * §1, not from Phase 71's report):
 *
 * - pdf-to-word / pdf-to-excel / pdf-to-text / extract-tables /
 *   compare-documents all consume the SAME shared pdfium component
 *   (`extractPdfPageTexts` in src/lib/thumbnails/renderer.ts). PDF.js can
 *   compete on that parsing/text component, but the assembly stages (docx,
 *   ExcelJS, table heuristics, comparison) are separate repository code the
 *   candidate does not provide.
 * - pdf-to-jpg / pdf-to-png rasterize through pdfium WASM in-process.
 *   PDF.js raster output requires a canvas backend; in Node that means its
 *   OPTIONAL native dependency @napi-rs/canvas (present in node_modules as
 *   pdfjs-dist's optionalDependency, dev-flagged in the lockfile). A
 *   platform-specific native binary violates this repository's standing
 *   no-native-binaries production constraint — and the repository itself
 *   already rejected exactly this path when choosing pdfium for rendering
 *   (see the rationale comment in src/lib/thumbnails/renderer.ts). A
 *   Phase 72 capability probe confirmed rendering WORKS with the native
 *   canvas in this sandbox (RENDER_OK 300x200), so this is a deployment
 *   policy exclusion, not a capability claim.
 * - extract-images reads embedded image XObjects directly via pdf-lib.
 *   PDF.js has no stable public API for embedded image extraction.
 * - images-to-pdf / png-to-pdf / compress-pdf WRITE or rewrite PDFs.
 *   PDF.js is a reader: it cannot produce these outputs at all.
 */

export const CANDIDATE_APPLICABILITY: readonly ApplicabilityEntry[] = [
  {
    conversion: "pdf-to-word",
    currentEngine: "current-pdfium-docx",
    status: "PARTIAL",
    scope: "component",
    reason:
      "PDF.js can replace the shared pdfium text-extraction component (extractPdfPageTexts) that feeds the docx assembly, but provides no DOCX assembly itself. Component evidence only; assembly stage unmeasured.",
  },
  {
    conversion: "pdf-to-excel",
    currentEngine: "current-pdfium-exceljs",
    status: "PARTIAL",
    scope: "component",
    reason:
      "PDF.js can replace the shared pdfium text-extraction component, but provides neither table detection nor XLSX assembly. Component evidence only; assembly stage unmeasured.",
  },
  {
    conversion: "pdf-to-text",
    currentEngine: "current-pdfium-text",
    status: "YES",
    scope: "direct",
    reason:
      "Both engines parse a PDF and emit a text artifact — the same processing role, directly comparable end to end.",
  },
  {
    conversion: "pdf-to-jpg",
    currentEngine: "current-pdfium-jpeg",
    status: "NO",
    scope: "not-comparable",
    reason:
      "Raster rendering via PDF.js requires @napi-rs/canvas, a platform-specific native binary (pdfjs-dist optionalDependency). Native binaries violate the repository's production constraint, and the repository already rejected this path for rendering (src/lib/thumbnails/renderer.ts rationale). No production-viable comparison exists.",
  },
  {
    conversion: "pdf-to-png",
    currentEngine: "current-pdfium-png",
    status: "NO",
    scope: "not-comparable",
    reason:
      "Same rendering constraint as pdf-to-jpg: PDF.js raster output needs the optional native @napi-rs/canvas backend, which the production stack forbids.",
  },
  {
    conversion: "extract-tables",
    currentEngine: "current-pdfium-tables",
    status: "PARTIAL",
    scope: "component",
    reason:
      "PDF.js provides positioned text (x/y per item) that table reconstruction could consume, but implements no table reconstruction itself. Benchmarked at component level (positional signal quality), NOT as a complete extract-tables alternative.",
  },
  {
    conversion: "compare-documents",
    currentEngine: "current-pdfium-compare",
    status: "PARTIAL",
    scope: "component",
    reason:
      "PDF.js can feed text/positions to a comparator, but the comparison logic itself is repository code the candidate does not provide. Only the shared text component is benchmarked; comparison behavior is unmeasured.",
  },
  {
    conversion: "extract-images",
    currentEngine: "current-pdf-lib-extract-images",
    status: "NO",
    scope: "not-comparable",
    reason:
      "PDF.js has no stable public API for extracting embedded image XObjects (only operator-list internals); the current engine reads image objects directly via pdf-lib. Not benchmarked.",
  },
  {
    conversion: "images-to-pdf",
    currentEngine: "current-pdf-lib-images",
    status: "NO",
    scope: "not-comparable",
    reason:
      "PDF.js is a PDF reader; it cannot author PDFs. The conversion's entire role (image → PDF assembly) is outside the candidate.",
  },
  {
    conversion: "png-to-pdf",
    currentEngine: "current-pdf-lib-png",
    status: "NO",
    scope: "not-comparable",
    reason:
      "PDF authoring again: a reader cannot wrap PNGs into a PDF document.",
  },
  {
    conversion: "compress-pdf",
    currentEngine: "current-pdf-lib-compress",
    status: "NO",
    scope: "not-comparable",
    reason:
      "PDF.js parses but does not optimize or rewrite PDF files. The backup candidate for this space is qpdf (Apache-2.0), out of Phase 72 scope.",
  },
];

/** Look up the applicability row for one conversion. */
export function getApplicability(conversion: string): ApplicabilityEntry {
  const entry = CANDIDATE_APPLICABILITY.find(
    (candidate) => candidate.conversion === conversion,
  );
  if (!entry) {
    throw new Error(`No applicability entry for conversion "${conversion}".`);
  }
  return entry;
}

/** Conversions the Phase 72 benchmark actually executes (scope != NO). */
export function benchmarkedConversions(): readonly string[] {
  return [
    ...new Set(
      CANDIDATE_APPLICABILITY.filter((entry) => entry.scope !== "not-comparable")
        // Only conversions with an executed benchmark: direct text + table
        // component. word/excel/compare share the SAME pdfium text
        // component, so the pdf-to-text benchmark IS their component
        // evidence (documented per-case in the report).
        .filter((entry) =>
          ["pdf-to-text", "extract-tables"].includes(entry.conversion),
        )
        .map((entry) => entry.conversion),
    ),
  ];
}
