import "server-only";

import type { ConversionEngine } from "@/lib/engines/types";
import {
  processorEngineAdapter,
  type ProcessorEngineSpec,
} from "@/lib/engines/adapters/processor-engine";

// Re-exported for existing importers (Phase 70 hardening tests, benchmark
// runner): the marker-scan utilities moved to the shared adapter module in
// Phase 73 so the alternative pdfjs engine uses the identical quality
// signal computation.
export {
  MARKER_SCAN_MAX_BYTES,
  textArtifactsMarkerOnly,
} from "@/lib/engines/adapters/processor-engine";
import { compareDocumentsProcessor } from "@/lib/processing/processors/compare-documents";
import { compressPdfProcessor } from "@/lib/processing/processors/compress-pdf";
import { extractImagesProcessor } from "@/lib/processing/processors/extract-images";
import { extractTablesProcessor } from "@/lib/processing/processors/extract-tables";
import {
  imagesToPdfProcessor,
  pngToPdfProcessor,
} from "@/lib/processing/processors/images-to-pdf";
import { pdfToExcelProcessor } from "@/lib/processing/processors/pdf-to-excel";
import {
  pdfToJpgProcessor,
  pdfToPngProcessor,
} from "@/lib/processing/processors/pdf-to-image";
import { pdfToTextProcessor } from "@/lib/processing/processors/pdf-to-text";
import { pdfToWordProcessor } from "@/lib/processing/processors/pdf-to-word";

/**
 * Thin adapters for the engines PDFKit ships today.
 *
 * Each adapter delegates straight to an existing tool processor:
 *
 * - `input` rules are borrowed from the processor (never redefined), so
 *   request validation is identical;
 * - `run()` calls `processor.process()` with the untouched request and
 *   context — the very same objects, no copies — exactly once per run;
 * - a success is wrapped with engine-layer facts (`engineId`, `attempt`,
 *   `durationMs`, empty `warnings`, the signature-tier input `profile`);
 * - the wrapped result is passed through the structural OutputValidator
 *   (Phase 68), which fills `validation` — diagnostic only, never a
 *   failure path;
 * - a failure propagates as the original `ProcessingError` instance: no
 *   catching, no wrapping, no classification.
 *
 * No conversion logic lives here. The algorithms stay in the processors,
 * unchanged — this file only establishes the abstraction boundary.
 */

/**
 * Phase 73: the wrapping, validation and quality logic lives in the shared
 * `processorEngineAdapter` (adapters/processor-engine.ts) so the alternative
 * pdfjs engine goes through the exact same path. `currentEngineAdapter`
 * remains as the historical name every current engine uses.
 */
export function currentEngineAdapter<TOptions>(
  spec: ProcessorEngineSpec<TOptions>,
): ConversionEngine<TOptions> {
  return processorEngineAdapter(spec);
}

/** PDF → Word: pdfium (WASM) text extraction + docx generation. */
export const currentPdfToWordEngine = currentEngineAdapter({
  descriptor: {
    id: "current-pdfium-docx",
    name: "PDFium text extraction → docx",
    conversionType: "pdf-to-word",
    toolId: "pdf-to-word",
    capabilities: ["text-extraction", "document-generation"],
    executionClass: "in-process",
    costClass: "local",
    license:
      "MIT (@hyzyla/pdfium, WASM build of Google pdfium, BSD-3-Clause) + MIT (docx)",
    version: "1.0.0",
    available: true,
  },
  processor: pdfToWordProcessor,
});

/** PDF → Excel: pdfium text extraction + whitespace table heuristic + exceljs. */
export const currentPdfToExcelEngine = currentEngineAdapter({
  descriptor: {
    id: "current-pdfium-exceljs",
    name: "PDFium text extraction → ExcelJS workbook",
    conversionType: "pdf-to-excel",
    toolId: "pdf-to-excel",
    capabilities: ["text-extraction", "table-heuristics", "document-generation"],
    executionClass: "in-process",
    costClass: "local",
    license:
      "MIT (@hyzyla/pdfium) + MIT (exceljs)",
    version: "1.0.0",
    available: true,
  },
  processor: pdfToExcelProcessor,
});

/** PDF → Text: pdfium text extraction, page by page. */
export const currentPdfToTextEngine = currentEngineAdapter({
  descriptor: {
    id: "current-pdfium-text",
    name: "PDFium text extraction",
    conversionType: "pdf-to-text",
    toolId: "pdf-to-text",
    capabilities: ["text-extraction"],
    executionClass: "in-process",
    costClass: "local",
    license: "MIT (@hyzyla/pdfium)",
    version: "1.0.0",
    available: true,
  },
  processor: pdfToTextProcessor,
});

/** PDF → JPG: pdfium rasterization + jpeg-js encoding (quality 90). */
export const currentPdfToJpgEngine = currentEngineAdapter({
  descriptor: {
    id: "current-pdfium-jpeg",
    name: "PDFium rasterization → JPEG",
    conversionType: "pdf-to-jpg",
    toolId: "pdf-to-jpg",
    capabilities: ["rasterization", "image-encoding"],
    executionClass: "in-process",
    costClass: "local",
    license:
      "MIT (@hyzyla/pdfium) + BSD-3-Clause (jpeg-js)",
    version: "1.0.0",
    available: true,
  },
  processor: pdfToJpgProcessor,
});

/** PDF → PNG: pdfium rasterization + the in-house PNG encoder (fflate). */
export const currentPdfToPngEngine = currentEngineAdapter({
  descriptor: {
    id: "current-pdfium-png",
    name: "PDFium rasterization → PNG",
    conversionType: "pdf-to-png",
    toolId: "pdf-to-png",
    capabilities: ["rasterization", "image-encoding"],
    executionClass: "in-process",
    costClass: "local",
    license: "MIT (@hyzyla/pdfium, fflate)",
    version: "1.0.0",
    available: true,
  },
  processor: pdfToPngProcessor,
});

/** PDF → images: pdf-lib image XObject extraction + fflate decompression. */
export const currentExtractImagesEngine = currentEngineAdapter({
  descriptor: {
    id: "current-pdf-lib-extract-images",
    name: "pdf-lib embedded-image extraction",
    conversionType: "extract-images",
    toolId: "extract-images",
    capabilities: ["image-decoding", "image-encoding"],
    executionClass: "in-process",
    costClass: "local",
    license: "MIT (pdf-lib, fflate)",
    version: "1.0.0",
    available: true,
  },
  processor: extractImagesProcessor,
});

/** PDF → XLSX/CSV tables: pdfium text + table heuristic + exceljs. */
export const currentExtractTablesEngine = currentEngineAdapter({
  descriptor: {
    id: "current-pdfium-tables",
    name: "PDFium text → table heuristic → ExcelJS",
    conversionType: "extract-tables",
    toolId: "extract-tables",
    capabilities: ["text-extraction", "table-heuristics", "document-generation"],
    executionClass: "in-process",
    costClass: "local",
    license: "MIT (@hyzyla/pdfium, exceljs)",
    version: "1.0.0",
    available: true,
  },
  processor: extractTablesProcessor,
});

/** JPG/PNG → PDF: pdf-lib image embedding. */
export const currentImagesToPdfEngine = currentEngineAdapter({
  descriptor: {
    id: "current-pdf-lib-images",
    name: "pdf-lib image embedding",
    conversionType: "images-to-pdf",
    toolId: "images-to-pdf",
    capabilities: ["image-decoding", "document-generation"],
    executionClass: "in-process",
    costClass: "local",
    license: "MIT (pdf-lib)",
    version: "1.0.0",
    available: true,
  },
  processor: imagesToPdfProcessor,
});

/** PNG → PDF: pdf-lib PNG embedding (alpha preserved). */
export const currentPngToPdfEngine = currentEngineAdapter({
  descriptor: {
    id: "current-pdf-lib-png",
    name: "pdf-lib PNG embedding",
    conversionType: "png-to-pdf",
    toolId: "png-to-pdf",
    capabilities: ["image-decoding", "document-generation"],
    executionClass: "in-process",
    costClass: "local",
    license: "MIT (pdf-lib)",
    version: "1.0.0",
    available: true,
  },
  processor: pngToPdfProcessor,
});

/**
 * PDF → PDF compression: pdf-lib/fflate lossless optimisation, plus a
 * pdfium+jpeg-js rasterisation pass for the aggressive `high` level.
 */
export const currentCompressPdfEngine = currentEngineAdapter({
  descriptor: {
    id: "current-pdf-lib-compress",
    name: "pdf-lib/fflate lossless + PDFium raster compression",
    conversionType: "compress-pdf",
    toolId: "compress-pdf",
    capabilities: ["lossless-optimization", "rasterization", "image-encoding"],
    executionClass: "in-process",
    costClass: "local",
    license: "MIT (pdf-lib, fflate, @hyzyla/pdfium) + BSD-3-Clause (jpeg-js)",
    version: "1.0.0",
    available: true,
  },
  processor: compressPdfProcessor,
});

/** 2×PDF → comparison report: pdfium text extraction + text comparison. */
export const currentCompareDocumentsEngine = currentEngineAdapter({
  descriptor: {
    id: "current-pdfium-compare",
    name: "PDFium text comparison",
    conversionType: "compare-documents",
    toolId: "compare-documents",
    capabilities: ["text-extraction", "text-comparison"],
    executionClass: "in-process",
    costClass: "local",
    license: "MIT (@hyzyla/pdfium)",
    version: "1.0.0",
    available: true,
  },
  processor: compareDocumentsProcessor,
});

/**
 * Every engine PDFKit ships today, in deterministic (sorted by conversion
 * type) order. The default registry registers exactly these — nothing else
 * exists, so the router can never select an engine that is not real.
 */
export const CURRENT_ENGINES: readonly ConversionEngine[] = [
  currentCompareDocumentsEngine,
  currentCompressPdfEngine,
  currentExtractImagesEngine,
  currentExtractTablesEngine,
  currentImagesToPdfEngine,
  currentPdfToExcelEngine,
  currentPdfToJpgEngine,
  currentPdfToPngEngine,
  currentPdfToTextEngine,
  currentPdfToWordEngine,
  currentPngToPdfEngine,
].sort((a, b) =>
  a.descriptor.conversionType.localeCompare(b.descriptor.conversionType),
);
