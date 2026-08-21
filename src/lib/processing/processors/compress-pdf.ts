import "server-only";

import type {
  ProcessingContext,
  ProcessingRequest,
  ProcessingSuccess,
  ToolProcessor,
} from "@/lib/processing/contract";
import {
  computeCompressionStats,
  compressionStatsToMeta,
  isCompressionLevel,
  type CompressionLevel,
  type CompressionStrategy,
  type RasterSkipReason,
} from "@/lib/processing/compression";
import { ProcessingError } from "@/lib/processing/errors";
import { derivedDocumentName } from "@/lib/processing/file-names";
import {
  hasImageObjects,
  optimiseDocumentLosslessly,
} from "@/lib/processing/optimize/lossless";
import { rasterizePdfForCompression } from "@/lib/processing/optimize/rasterize";
import {
  loadPdfDocument,
  readPageCount,
  savePdfDocument,
} from "@/lib/processing/pdf-document";
import { COMPRESS_PDF_INPUT_RULES } from "@/lib/processing/rules";

/**
 * Options accepted by the Compress PDF API.
 *
 * `level` is the raw form value (`"low" | "medium" | "high"`). It is parsed
 * and validated here, on the server — the client's own validation is a
 * convenience, never a source of truth. An omitted level means `medium`.
 */
export interface CompressPdfOptions {
  level?: string;
}

/**
 * Reduce the size of one PDF.
 *
 * What each level really does (measured on representative documents):
 *
 * - `low` — lossless structural optimisation: the file is re-saved with PDF
 *   object streams and a compressed cross-reference stream, and document
 *   metadata (XMP, Info entries like Title/Author) is removed. Fast, and often
 *   a large win on files saved the classic way; no help for already-optimised
 *   files.
 * - `medium` (default) — everything `low` does, plus every safe stream is
 *   re-compressed with maximum deflate effort (uncompressed streams become
 *   FlateDecode; already-deflated streams are re-deflated when that is
 *   strictly smaller). Still lossless: readers decode identical bytes.
 * - `high` — everything `medium` does, plus an aggressive pass that renders
 *   each page with pdfium and rebuilds the document from full-page JPEGs
 *   (~110 DPI, quality 60). This is **lossy**: image detail is reduced and
 *   text becomes pixels. The pass only runs when the document contains image
 *   objects and is within the configured page limit, and its output is only
 *   kept when it beats both the original and the lossless result.
 *
 * Honesty is the contract of this processor: whatever comes out, the reported
 * statistics describe the bytes actually returned. When nothing makes the file
 * smaller, the untouched original bytes are returned with `wasReduced: false`.
 */
export class CompressPdfProcessor implements ToolProcessor<CompressPdfOptions> {
  readonly toolId = "compress-pdf";
  readonly input = COMPRESS_PDF_INPUT_RULES;

  async process(
    request: ProcessingRequest<CompressPdfOptions>,
    context: ProcessingContext,
  ): Promise<ProcessingSuccess> {
    const file = request.files[0];
    if (!file) {
      throw new ProcessingError("VALIDATION_ERROR", "No PDF was uploaded.");
    }

    const level = this.resolveLevel(request.options?.level);

    const document = await loadPdfDocument(file.name, file.bytes);
    const pageCount = readPageCount(document, file.name);

    // 1. Lossless pass — always runs, at the level's depth.
    const losslessReport = optimiseDocumentLosslessly(document, {
      recompressStreams: level !== "low",
    });
    let selected: Uint8Array = await savePdfDocument(document);
    let strategy: CompressionStrategy = "lossless";

    // 2. Aggressive pass — `high` only, and only when it can plausibly help.
    let rasterSkipped: RasterSkipReason | undefined;
    if (level === "high") {
      const skipReason = this.rasterSkipReason(
        document,
        pageCount,
        context.limits.maxCompressRasterPages,
      );

      if (skipReason) {
        rasterSkipped = skipReason;
      } else {
        try {
          const raster = await rasterizePdfForCompression(file.bytes);
          if (raster.bytes.length < selected.length) {
            selected = raster.bytes;
            strategy = "rasterized";
          }
        } catch (error) {
          // Never surface internals; degrade to the (valid) lossless result.
          console.warn(
            "[compress] aggressive pass failed; keeping the lossless result:",
            error instanceof Error ? error.message : String(error),
          );
          rasterSkipped = "failed";
        }
      }
    }

    // 3. Never return a larger file and call it compressed.
    const original = file.bytes;
    if (selected.length >= original.length) {
      selected = original;
      strategy = "original";
    }

    const stats = computeCompressionStats({
      originalBytes: original.length,
      outputBytes: selected.length,
      compressionLevel: level,
      strategy,
      ...(rasterSkipped ? { rasterSkipped } : {}),
    });

    return {
      status: "succeeded",
      artifacts: [
        {
          name: derivedDocumentName(file.name, "compressed"),
          mimeType: "application/pdf",
          size: selected.length,
          bytes: selected,
        },
      ],
      meta: {
        pages: pageCount,
        outputPages: pageCount,
        streamsRewritten: losslessReport.streamsRewritten,
        ...compressionStatsToMeta(stats),
      },
    };
  }

  /** Parse the requested level; the server never repairs bad input. */
  private resolveLevel(raw: string | undefined): CompressionLevel {
    if (raw === undefined || raw === "") return "medium";
    if (!isCompressionLevel(raw)) {
      throw new ProcessingError(
        "VALIDATION_ERROR",
        "Choose a compression level: low, medium or high.",
        { details: [`“${raw.slice(0, 40)}” is not a compression level.`] },
      );
    }
    return raw;
  }

  /**
   * Why the aggressive pass should not run, or `undefined` when it should.
   *
   * Documents without a single image object cannot shrink by rasterising
   * (a JPEG of a text page is far larger than the page itself), and documents
   * beyond the configured page limit are too expensive to raster. Both cases
   * keep `high` lossless, and the result says so via `rasterSkipped`.
   */
  private rasterSkipReason(
    document: Parameters<typeof hasImageObjects>[0],
    pageCount: number,
    maxRasterPages: number,
  ): RasterSkipReason | undefined {
    if (!hasImageObjects(document)) return "no-images";
    if (pageCount > maxRasterPages) return "too-many-pages";
    return undefined;
  }
}

export const compressPdfProcessor = new CompressPdfProcessor();
