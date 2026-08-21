import "server-only";

import { PDFiumLibrary } from "@hyzyla/pdfium";
import { ProcessingError } from "@/lib/processing/errors";
import { encodePng } from "@/lib/thumbnails/png";
import { rotateRgba } from "@/lib/thumbnails/rotate-pixels";
import type { PageThumbnail, RenderThumbnailsOptions } from "@/lib/thumbnails/types";

/**
 * Page rasterizer — the only module that knows how PDF pages become images.
 *
 * ## Why pdfium (WASM)
 *
 * Rendering a PDF page needs a real rasterizer. The options were:
 *
 * - **mupdf** — excellent quality, but **AGPL-3.0**, which is not an acceptable
 *   licence for this product.
 * - **pdfjs-dist + @napi-rs/canvas** — Apache-2.0/MIT, but ~35 MB and it needs a
 *   platform-specific native canvas binary at runtime.
 * - **@hyzyla/pdfium** (chosen) — MIT wrapper around Google's pdfium
 *   (BSD-3-Clause), shipped as **WebAssembly**. No native binaries, no
 *   node-gyp, no browser automation; it runs anywhere Node runs and was
 *   verified in this environment before adoption.
 *
 * pdfium returns raw RGBA pixels, which `png.ts` encodes with fflate — so no
 * imaging dependency (sharp/canvas/jimp) was needed either.
 *
 * ## Execution model
 *
 * The WASM module is initialised once per server process and reused. Jobs are
 * serialised through a small queue so several requests cannot inflate the WASM
 * heap at the same time. Everything happens in memory: no temporary files, no
 * filesystem writes, nothing under `public/`.
 */

/** Tallest render allowed, as a multiple of the target width. */
const MAX_ASPECT_RATIO = 4;

let libraryPromise: Promise<PDFiumLibrary> | null = null;

function getLibrary(): Promise<PDFiumLibrary> {
  libraryPromise ??= PDFiumLibrary.init();
  return libraryPromise;
}

/** Serialises rendering jobs; the WASM module is a single shared instance. */
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  // Keep the chain alive even when a job rejects.
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function isEncrypted(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return message.includes("password") || message.includes("encrypt");
}

/**
 * Render the requested pages of a PDF as PNG thumbnails.
 *
 * `pages` are 1-based and are returned in the order given. The caller is
 * responsible for validating the document itself (signature, size); this
 * function additionally rejects page numbers outside the document.
 */
export async function renderPdfPageThumbnails(
  bytes: Uint8Array,
  { pages, width, maxImageBytes, rotations = {} }: RenderThumbnailsOptions,
): Promise<{ pageCount: number; thumbnails: PageThumbnail[] }> {
  return enqueue(async () => {
    const library = await getLibrary();

    let document;
    try {
      document = await library.loadDocument(bytes);
    } catch (cause) {
      if (isEncrypted(cause)) {
        throw new ProcessingError(
          "ENCRYPTED_PDF",
          "Password-protected PDFs cannot be previewed yet.",
          { cause },
        );
      }
      throw new ProcessingError(
        "INVALID_PDF",
        "This PDF could not be opened for previewing.",
        { cause },
      );
    }

    try {
      const pageCount = document.getPageCount();
      if (!Number.isInteger(pageCount) || pageCount < 1) {
        throw new ProcessingError("INVALID_PDF", "This PDF contains no pages.");
      }

      const requestedPages = typeof pages === "function" ? pages(pageCount) : pages;
      const thumbnails: PageThumbnail[] = [];

      for (const pageNumber of requestedPages) {
        if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pageCount) {
          throw new ProcessingError(
            "PAGE_OUT_OF_RANGE",
            `Page ${pageNumber} does not exist. This PDF has ${pageCount} ${
              pageCount === 1 ? "page" : "pages"
            }.`,
          );
        }

        let rendered;
        try {
          // pdfium's `width` option stretches the page to that width; scaling
          // from the real page size is what preserves the aspect ratio.
          // A page object is single-use, so each call gets a fresh one.
          const { originalWidth, originalHeight } = document
            .getPage(pageNumber - 1)
            .getOriginalSize();

          if (!(originalWidth > 0) || !(originalHeight > 0)) {
            throw new ProcessingError(
              "INVALID_PDF",
              "A page of this PDF has no usable size.",
            );
          }

          // Guard against pathological page ratios (a very tall page would
          // otherwise allocate a huge bitmap).
          const maxHeight = width * MAX_ASPECT_RATIO;
          const scale = Math.min(
            width / originalWidth,
            maxHeight / originalHeight,
          );

          rendered = await document.getPage(pageNumber - 1).render({
            scale,
            render: "bitmap",
          });
        } catch (cause) {
          if (cause instanceof ProcessingError) throw cause;
          throw new ProcessingError(
            "PROCESSING_ERROR",
            "A page preview could not be generated.",
            { cause },
          );
        }

        // pdfium renders the page as the document declares it; any extra
        // rotation the caller asked for is applied to the bitmap afterwards.
        const rotation = rotations[pageNumber] ?? 0;
        const image = rotateRgba(
          // pdfium hands back RGBA pixels; `png.test.ts` locks that assumption.
          rendered.data,
          rendered.width,
          rendered.height,
          rotation,
        );

        const png = encodePng({
          width: image.width,
          height: image.height,
          pixels: image.pixels,
        });

        if (png.length > maxImageBytes) {
          throw new ProcessingError(
            "PROCESSING_ERROR",
            "A page preview was too large to return.",
          );
        }

        thumbnails.push({
          pageNumber,
          rotation,
          width: image.width,
          height: image.height,
          mimeType: "image/png",
          bytes: png,
        });
      }

      return { pageCount, thumbnails };
    } finally {
      // Always release the WASM-side document, on success and on failure.
      document.destroy();
    }
  });
}

/** Page count according to the rasterizer. Used by tests and diagnostics. */
export async function readPdfPageCountForPreview(bytes: Uint8Array): Promise<number> {
  const { pageCount } = await renderPdfPageThumbnails(bytes, {
    pages: [],
    width: 1,
    maxImageBytes: 1,
  });
  return pageCount;
}
