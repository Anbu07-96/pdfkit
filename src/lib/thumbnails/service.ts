import "server-only";

import type { ProcessingInputFile } from "@/lib/processing/contract";
import { ProcessingError } from "@/lib/processing/errors";
import { getProcessingLimits, type ProcessingLimits } from "@/lib/processing/limits";
import { SINGLE_PDF_INPUT_RULES } from "@/lib/processing/rules";
import { validateProcessingInput } from "@/lib/processing/validation/pdf-input";
import { getThumbnailLimits, type ThumbnailLimits } from "@/lib/thumbnails/limits";
import { renderPdfPageThumbnails } from "@/lib/thumbnails/renderer";
import type {
  PageThumbnailPayload,
  ThumbnailResponseBody,
} from "@/lib/thumbnails/types";

/**
 * Thumbnail service.
 *
 * Same shape as the processing service: validate the untrusted document with
 * the shared rules first, apply the thumbnail-specific limits, then call the
 * rasterizer. Nothing here knows what the rasterizer is.
 */

export interface CreateThumbnailsOptions {
  /** 1-based pages to render. Empty or omitted renders from page 1 up to the limit. */
  pages?: number[];
  processingLimits?: ProcessingLimits;
  thumbnailLimits?: ThumbnailLimits;
}

/** Parse a `pages` form value such as `"1,3,5"`. Rejects anything else. */
export function parseRequestedPages(value: string | null | undefined): number[] {
  if (value === null || value === undefined) return [];
  const trimmed = value.trim();
  if (trimmed === "") return [];

  const pages: number[] = [];
  for (const token of trimmed.split(/[\s,;]+/).filter(Boolean)) {
    if (!/^\d+$/.test(token)) {
      throw new ProcessingError(
        "VALIDATION_ERROR",
        `“${token}” is not a valid page number.`,
      );
    }
    const page = Number.parseInt(token, 10);
    if (page < 1) {
      throw new ProcessingError("VALIDATION_ERROR", "Page numbers start at 1.");
    }
    // Duplicates would waste work for an identical image.
    if (!pages.includes(page)) pages.push(page);
  }
  return pages;
}

export async function createPageThumbnails(
  file: ProcessingInputFile,
  {
    pages = [],
    processingLimits = getProcessingLimits(),
    thumbnailLimits = getThumbnailLimits(),
  }: CreateThumbnailsOptions = {},
): Promise<ThumbnailResponseBody> {
  // Same untrusted-document checks every processor gets.
  validateProcessingInput({
    files: [file],
    rules: SINGLE_PDF_INPUT_RULES,
    limits: processingLimits,
  });

  if (pages.length > thumbnailLimits.maxPages) {
    throw new ProcessingError(
      "TOO_MANY_OUTPUTS",
      `Previews are limited to ${thumbnailLimits.maxPages} pages per request. You asked for ${pages.length}.`,
    );
  }

  // An empty request means "the first N pages", where N is the limit.
  const { pageCount, thumbnails } = await renderPdfPageThumbnails(file.bytes, {
    // A resolver keeps this to a single document load: when the caller did not
    // choose pages we render the first N, where N is bounded by the limit and
    // by the document itself.
    pages:
      pages.length > 0
        ? pages
        : (count) =>
            Array.from(
              { length: Math.min(count, thumbnailLimits.maxPages) },
              (_, index) => index + 1,
            ),
    width: thumbnailLimits.width,
    maxImageBytes: thumbnailLimits.maxImageBytes,
  });

  return {
    pageCount,
    thumbnails: thumbnails.map(toPayload),
  };
}

function toPayload(thumbnail: {
  pageNumber: number;
  width: number;
  height: number;
  bytes: Uint8Array;
}): PageThumbnailPayload {
  return {
    pageNumber: thumbnail.pageNumber,
    width: thumbnail.width,
    height: thumbnail.height,
    // Data URLs keep the response self-contained: no temporary files, no
    // storage, nothing to clean up, and no object URL for the browser to leak.
    dataUrl: `data:image/png;base64,${Buffer.from(thumbnail.bytes).toString("base64")}`,
  };
}
