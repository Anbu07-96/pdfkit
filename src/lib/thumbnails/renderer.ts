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

/** Open a pdfium document, mapping open failures onto the PDFKit error model. */
async function loadDocumentSafe(
  library: Awaited<ReturnType<typeof getLibrary>>,
  bytes: Uint8Array,
) {
  try {
    return await library.loadDocument(bytes);
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
}

/**
 * Run a job with a pdfium document, through the shared serialised queue.
 *
 * The same single-instance WASM discipline the thumbnail renderer follows:
 * one job at a time, the document is always destroyed, and open failures map
 * onto the standard processing errors. Other server-side consumers (such as
 * PDF compression) reuse this instead of touching pdfium directly.
 */
export async function runWithPdfiumDocument<T>(
  bytes: Uint8Array,
  job: (document: Awaited<ReturnType<PDFiumLibrary["loadDocument"]>>) => Promise<T>,
): Promise<T> {
  return enqueue(async () => {
    const library = await getLibrary();
    const document = await loadDocumentSafe(library, bytes);
    try {
      return await job(document);
    } finally {
      document.destroy();
    }
  });
}

/**
 * A rendered PDF page as raw pixels — the unit of the full-page rendering API.
 * `pixels` is RGBA (`width * height * 4` bytes), row-major, opaque (pdfium
 * paints the page background white).
 */
export interface FullPageBitmap {
  pageNumber: number;
  width: number;
  height: number;
  pixels: Uint8Array;
}

/** Bitmap guards for full-page renders: pathological page sizes must not
 * exhaust memory — a huge page renders at a lower effective resolution. */
const FULL_PAGE_MAX_SIDE_PX = 5000;
const FULL_PAGE_MAX_PIXELS = 12_000_000;

/**
 * Render every page of a PDF at `dpi`, one page at a time.
 *
 * This is the conversion-grade counterpart of the thumbnail renderer: same
 * single-instance WASM discipline, same serialised queue, same guaranteed
 * document destruction — but full pages at a configurable resolution, with
 * limits that are deliberately separate from the thumbnail limits. Only one
 * bitmap exists at a time: `handlePage` receives it, encodes what it needs,
 * and the bitmap is released before the next page renders. Nothing is written
 * to disk.
 */
export async function renderEachPdfPage(
  bytes: Uint8Array,
  options: { dpi: number; maxPages: number },
  handlePage: (page: FullPageBitmap) => void | Promise<void>,
): Promise<{ pageCount: number }> {
  return runWithPdfiumDocument(bytes, async (document) => {
    const pageCount = document.getPageCount();
    if (!Number.isInteger(pageCount) || pageCount < 1) {
      throw new ProcessingError("INVALID_PDF", "This PDF contains no pages.");
    }
    if (pageCount > options.maxPages) {
      throw new ProcessingError(
        "TOO_MANY_OUTPUTS",
        `This PDF has ${pageCount} pages; the limit for image export is ${options.maxPages}.`,
      );
    }

    const scaleWanted = options.dpi / 72;

    for (let index = 0; index < pageCount; index += 1) {
      // Page objects are single-use in pdfium: fetch a fresh one per call.
      const { originalWidth, originalHeight } = document
        .getPage(index)
        .getOriginalSize();

      if (!(originalWidth > 0) || !(originalHeight > 0)) {
        throw new ProcessingError(
          "INVALID_PDF",
          "A page of this PDF has no usable size.",
        );
      }

      const scale = Math.min(
        scaleWanted,
        FULL_PAGE_MAX_SIDE_PX / Math.max(originalWidth, originalHeight),
        Math.sqrt(FULL_PAGE_MAX_PIXELS / (originalWidth * originalHeight)),
      );

      const rendered = await document.getPage(index).render({
        scale,
        render: "bitmap",
      });

      await handlePage({
        pageNumber: index + 1,
        width: rendered.width,
        height: rendered.height,
        // pdfium hands back RGBA pixels; `png.test.ts` locks that assumption.
        pixels: rendered.data as unknown as Uint8Array,
      });
    }

    return { pageCount };
  });
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

    // `loadDocumentSafe` maps any failure onto a `ProcessingError`.
    const document = await loadDocumentSafe(library, bytes);

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
