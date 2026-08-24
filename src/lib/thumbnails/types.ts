/**
 * Thumbnail types.
 *
 * Deliberately free of rasterizer detail: nothing outside
 * `lib/thumbnails/renderer.ts` knows that pdfium (or WASM at all) is involved,
 * so the renderer can be replaced without touching the API, the client or the
 * UI. Isomorphic — the browser reuses these shapes.
 */

import type { PageRotation, PageRotationMap } from "@/lib/processing/pages";

export interface PageThumbnail {
  /** 1-based source page number. Identity, never a position. */
  pageNumber: number;
  /** Extra clockwise rotation applied to this preview, in degrees. */
  rotation: PageRotation;
  /** Rendered width in pixels. */
  width: number;
  /** Rendered height in pixels. */
  height: number;
  mimeType: "image/png";
  /** Encoded image bytes. */
  bytes: Uint8Array;
}

/** Wire form of {@link PageThumbnail}: the image as a `data:` URL. */
export interface PageThumbnailPayload {
  pageNumber: number;
  /** Extra clockwise rotation applied to this preview, in degrees. */
  rotation: PageRotation;
  width: number;
  height: number;
  /** `data:image/png;base64,...` — safe to use directly as an `<img src>`. */
  dataUrl: string;
}

export interface ThumbnailResponseBody {
  pageCount: number;
  thumbnails: PageThumbnailPayload[];
}

export interface RenderThumbnailsOptions {
  /**
   * Extra clockwise rotation per page, on top of whatever the document already
   * declares. Pages that are absent are rendered as they are.
   */
  rotations?: PageRotationMap;
  /**
   * 1-based page numbers to render, in the order they should be returned, or a
   * resolver called with the real page count once the document is open (so
   * "the first N pages" needs only one document load).
   */
  pages: number[] | ((pageCount: number) => number[]);
  /** Target width in pixels; height follows the page aspect ratio. */
  width: number;
  /** Reject a produced image larger than this. */
  maxImageBytes: number;
}
