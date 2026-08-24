import "server-only";

import jpeg from "jpeg-js";
import { PDFDocument } from "pdf-lib";
import { ProcessingError } from "@/lib/processing/errors";
import { freshBytes } from "@/lib/processing/images";
import { runWithPdfiumDocument } from "@/lib/thumbnails/renderer";

/**
 * Lossy rasterisation pass for aggressive compression (`high` level).
 *
 * Every page is rendered with pdfium exactly as a reader displays it — page
 * rotation included, opaque white background — encoded as a baseline JPEG and
 * placed in a fresh PDF. This is the trade real "strong compression" makes:
 *
 * - scanned / image-heavy documents shrink dramatically, because large images
 *   are re-encoded at a lower resolution and JPEG quality;
 * - text pages usually get **larger** (a JPEG of a page dwarfs its vector
 *   text), which is exactly why the caller only keeps the rasterised output
 *   when it is smaller than both the original and the lossless result;
 * - text becomes pixels: it is no longer selectable or searchable, links and
 *   form fields are gone. The interface says so before the user chooses it.
 *
 * `jpeg-js` (BSD-3-Clause, zero dependencies, ~76 KB, pure JavaScript, no
 * native binaries) was verified in this environment before adoption; see
 * `ARCHITECTURE.md` for the full decision.
 */

/** Target resolution, dots per inch. 110 keeps small text readable. */
const RASTER_DPI = 110;

/** JPEG quality (0–100). 60 is the sweet spot measured on scanned pages. */
const JPEG_QUALITY = 60;

/**
 * Bitmap guards for pathological page sizes: a single page may not exceed
 * 5000 px per side or 12 million pixels (~48 MB RGBA buffer).
 */
const MAX_SIDE_PIXELS = 5000;
const MAX_TOTAL_PIXELS = 12_000_000;

/** 72 points per inch — the PDF user-space unit. */
const POINTS_PER_INCH = 72;

/** Round to two decimals, avoiding 594.9999999 style page sizes. */
function roundPt(value: number): number {
  return Math.round(value * 100) / 100;
}

// Encoded bytes are copied into fresh offset-0 arrays before embedding:
// jpeg-js returns pooled Node Buffers, which pdf-lib's JPEG scanner
// (it reads `.buffer` from offset 0) would misread. See `images.ts`.

export interface RasterizeResult {
  bytes: Uint8Array;
  pageCount: number;
}

/**
 * Rasterise every page of `bytes` into a new PDF of full-page JPEGs.
 *
 * Throws `ProcessingError` when pdfium cannot render the document; the caller
 * decides whether to fall back to the lossless result.
 */
export async function rasterizePdfForCompression(
  bytes: Uint8Array,
): Promise<RasterizeResult> {
  try {
    return await runWithPdfiumDocument(bytes, async (source) => {
      const pageCount = source.getPageCount();
      if (pageCount < 1) {
        throw new ProcessingError("INVALID_PDF", "This PDF contains no pages.");
      }

      const output = await PDFDocument.create();
      const scaleCap = RASTER_DPI / POINTS_PER_INCH;

      for (let index = 0; index < pageCount; index += 1) {
        // Page objects are single-use in pdfium: fetch a fresh one per call.
        const { originalWidth, originalHeight } = source
          .getPage(index)
          .getOriginalSize();

        if (!(originalWidth > 0) || !(originalHeight > 0)) {
          throw new ProcessingError(
            "INVALID_PDF",
            "A page of this PDF has no usable size.",
          );
        }

        // Bound the bitmap for huge pages: lower effective resolution beats
        // exhausting memory.
        const sideCap = MAX_SIDE_PIXELS / Math.max(originalWidth, originalHeight);
        const areaCap = Math.sqrt(
          MAX_TOTAL_PIXELS / (originalWidth * originalHeight),
        );
        const scale = Math.min(scaleCap, sideCap, areaCap);

        const rendered = await source.getPage(index).render({
          scale,
          render: "bitmap",
        });

        // pdfium returns RGBA; blank areas are opaque white, so the alpha
        // channel can be dropped by the JPEG encoder safely.
        const encoded = jpeg.encode(
          {
            data: rendered.data as unknown as Uint8Array,
            width: rendered.width,
            height: rendered.height,
          },
          JPEG_QUALITY,
        );

        const image = await output.embedJpg(freshBytes(encoded.data));
        // Keep the original geometry: rendered pixels ÷ scale = PDF points.
        const width = roundPt(rendered.width / scale);
        const height = roundPt(rendered.height / scale);
        output.addPage([width, height]).drawImage(image, {
          x: 0,
          y: 0,
          width,
          height,
        });
      }

      output.setCreator("PDFKit");
      return {
        bytes: await output.save({ useObjectStreams: true }),
        pageCount,
      };
    });
  } catch (cause) {
    if (cause instanceof ProcessingError) throw cause;
    throw new ProcessingError(
      "PROCESSING_ERROR",
      "This PDF could not be compressed aggressively.",
      { cause },
    );
  }
}
