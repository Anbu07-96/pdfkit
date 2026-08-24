import "server-only";

import jpeg from "jpeg-js";
import type {
  ProcessingArtifact,
  ProcessingContext,
  ProcessingRequest,
  ProcessingSuccess,
  ProcessorInputRules,
  ToolProcessor,
} from "@/lib/processing/contract";
import { ProcessingError } from "@/lib/processing/errors";
import { baseDocumentName } from "@/lib/processing/file-names";
import { freshBytes } from "@/lib/processing/images";
import { loadPdfDocument, readPageCount } from "@/lib/processing/pdf-document";
import { SINGLE_PDF_TO_IMAGE_RULES } from "@/lib/processing/rules";
import { encodePng } from "@/lib/thumbnails/png";
import { renderEachPdfPage } from "@/lib/thumbnails/renderer";

/**
 * PDF → JPG/PNG, one shared implementation.
 *
 * Every page is rendered by the existing pdfium rasteriser through the
 * full-page rendering API (`renderEachPdfPage`): display orientation included,
 * aspect ratio exact (the scale derives from the page's own size), one bitmap
 * in memory at a time. The only difference between the two tools is the
 * encoder:
 *
 * - JPG — `jpeg-js` at quality 90: photographic content, small files, no
 *   alpha (pages render on an opaque white background anyway);
 * - PNG — the in-house encoder from the thumbnail stack: lossless, exact
 *   rendered colours, RGBA.
 *
 * One page produces a single image; several pages produce one artifact per
 * page, which the HTTP layer bundles into a ZIP — the same delivery contract
 * Split PDF established. The page-count rejection happens before a single
 * pixel is allocated, and every produced image is checked against the
 * conversion byte limit.
 */

export type RasterImageFormat = "jpeg" | "png";

interface FormatProfile {
  extension: string;
  mimeType: string;
  encode(width: number, height: number, pixels: Uint8Array): Uint8Array;
}

const FORMATS: Record<RasterImageFormat, FormatProfile> = {
  jpeg: {
    extension: "jpg",
    mimeType: "image/jpeg",
    encode: (width, height, pixels) =>
      // Quality 90: visually indistinguishable page renders at a sane size.
      // `freshBytes`: jpeg-js returns pooled Node Buffers at arbitrary byte
      // offsets; the ZIP writer wants plain offset-0 arrays.
      freshBytes(jpeg.encode({ data: pixels, width, height }, 90).data),
  },
  png: {
    extension: "png",
    mimeType: "image/png",
    encode: (width, height, pixels) =>
      encodePng({ width, height, pixels, level: 6 }),
  },
};

/** Shared PDF → image processor; the format selects the encoder and names. */
export class PdfToImageProcessor implements ToolProcessor {
  readonly toolId: string;
  readonly input: ProcessorInputRules = SINGLE_PDF_TO_IMAGE_RULES;
  private readonly profile: FormatProfile;

  constructor(toolId: "pdf-to-jpg" | "pdf-to-png", format: RasterImageFormat) {
    this.toolId = toolId;
    this.profile = FORMATS[format];
  }

  async process(
    request: ProcessingRequest,
    context: ProcessingContext,
  ): Promise<ProcessingSuccess> {
    const file = request.files[0];
    if (!file) {
      throw new ProcessingError("VALIDATION_ERROR", "No PDF was uploaded.");
    }

    // Fail fast on malformed/encrypted documents and excessive page counts
    // — before pdfium allocates anything.
    const document = await loadPdfDocument(file.name, file.bytes);
    const pageCount = readPageCount(document, file.name);
    if (pageCount > context.limits.maxConversionPages) {
      throw new ProcessingError(
        "TOO_MANY_OUTPUTS",
        `This PDF has ${pageCount} pages; the limit for image export is ${context.limits.maxConversionPages}.`,
      );
    }

    const baseName = baseDocumentName(file.name);
    const artifacts: ProcessingArtifact[] = [];

    await renderEachPdfPage(
      file.bytes,
      {
        dpi: context.limits.conversionDpi,
        maxPages: context.limits.maxConversionPages,
      },
      (page) => {
        const bytes = this.profile.encode(page.width, page.height, page.pixels);
        if (bytes.length > context.limits.conversionMaxImageBytes) {
          throw new ProcessingError(
            "OUTPUT_TOO_LARGE",
            "A rendered page produced an image above the export size limit.",
            {
              details: [
                `Page ${page.pageNumber} of ${file.name} rendered larger than the configured maximum. Lower the export resolution (PDFKIT_CONVERSION_DPI) or export fewer pages.`,
              ],
            },
          );
        }
        artifacts.push({
          name: `${baseName}-page-${page.pageNumber}.${this.profile.extension}`,
          mimeType: this.profile.mimeType,
          size: bytes.length,
          bytes,
        });
      },
    );

    return {
      status: "succeeded",
      artifacts,
      ...(artifacts.length > 1
        ? { bundleName: `${baseName}-${this.profile.extension}.zip` }
        : {}),
      meta: {
        pages: pageCount,
        outputPages: pageCount,
        images: artifacts.length,
      },
    };
  }
}

/** PDF to JPG: every page becomes a JPEG image. */
export const pdfToJpgProcessor = new PdfToImageProcessor(
  "pdf-to-jpg",
  "jpeg",
);

/** PDF to PNG: every page becomes a lossless PNG image. */
export const pdfToPngProcessor = new PdfToImageProcessor(
  "pdf-to-png",
  "png",
);
