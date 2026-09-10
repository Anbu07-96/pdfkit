import "server-only";

import type {
  ConversionEngine,
  EngineDescriptor,
  EngineResult,
} from "@/lib/engines/types";
import { describeInputFile } from "@/lib/engines/profile";
import { assessConversionQuality } from "@/lib/engines/quality";
import { validateEngineResult } from "@/lib/engines/validation";
import type { ProcessingArtifact, ToolProcessor } from "@/lib/processing/contract";
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

interface CurrentEngineSpec<TOptions = Record<string, unknown>> {
  descriptor: EngineDescriptor;
  processor: ToolProcessor<TOptions>;
}

/**
 * Upper bound for the marker-only scan: text artifacts above this size are
 * certainly not marker-only (a 50-page marker-only output is a few KiB).
 */
/** Exported for boundary tests (Phase 70); the value is policy, not secret. */
export const MARKER_SCAN_MAX_BYTES = 1024 * 1024;

const PAGE_MARKER_PATTERNS = [
  /--- Page \d+ ---/g,
  /\[Page \d+ contains no extractable text\]/g,
];

/**
 * Derive (without retaining anything) whether every text artifact consists
 * entirely of the current processors' page markers — the honest signal that
 * a PDF → text conversion extracted no source text. Boolean only: no
 * content leaves this function.
 */
function textArtifactsMarkerOnly(artifacts: readonly ProcessingArtifact[]): boolean | undefined {
  let sawTextArtifact = false;
  for (const artifact of artifacts) {
    if (!artifact.mimeType.toLowerCase().startsWith("text/")) continue;
    sawTextArtifact = true;
    if (artifact.bytes.length === 0 || artifact.bytes.length > MARKER_SCAN_MAX_BYTES) {
      return false;
    }
    let text = new TextDecoder().decode(artifact.bytes);
    for (const pattern of PAGE_MARKER_PATTERNS) {
      text = text.replace(pattern, "");
    }
    if (text.trim().length > 0) return false;
  }
  return sawTextArtifact ? true : undefined;
}

/** Wrap an existing processor as a conversion engine. */
export function currentEngineAdapter<TOptions>(
  spec: CurrentEngineSpec<TOptions>,
): ConversionEngine<TOptions> {
  const { descriptor, processor } = spec;
  return {
    descriptor,
    input: processor.input,
    async run(request, context) {
      const startedAt = Date.now();
      const success = await processor.process(request, context);
      const result: EngineResult = {
        ...success,
        engineId: descriptor.id,
        attempt: 1,
        durationMs: Date.now() - startedAt,
        warnings: [],
        validation: { status: "not-evaluated" },
        // Signature-tier input description (Phase 68): one scan of the
        // first KiB, no parsing, never a routing input. Present whenever
        // the request carried a file.
        ...(request.files[0]
          ? { profile: describeInputFile(request.files[0]) }
          : {}),
      };
      // Structural validation (Phase 68) — records the verdict on the
      // result and returns it unchanged either way. Diagnostic only.
      const validated = validateEngineResult(result);

      // QualityGate v1 (Phase 69, Stage 3) — a conservative, diagnostic-only
      // quality verdict from signals the request already produced (profile
      // tier, validation verdict, processor meta, artifact facts). It adds
      // no parsing and never changes the outcome; Stage 4 (PLANNED) will
      // decide what to do with it.
      const outputBytes = validated.artifacts.reduce(
        (total, artifact) => total + artifact.size,
        0,
      );
      return {
        ...validated,
        quality: assessConversionQuality(descriptor.conversionType, {
          profile: validated.profile,
          validation: validated.validation,
          meta: validated.meta,
          artifactCount: validated.artifacts.length,
          outputBytes,
          inputFileCount: request.files.length,
          outputTextMarkerOnly: textArtifactsMarkerOnly(validated.artifacts),
        }),
      };
    },
  };
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
