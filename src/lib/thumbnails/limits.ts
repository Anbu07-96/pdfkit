import "server-only";

/**
 * Thumbnail limits.
 *
 * Separate from the processing limits (`lib/processing/limits.ts`) because they
 * bound a different resource: rasterising pages costs memory proportional to
 * width × height × pages, independent of the upload size. Same pattern though —
 * environment variables with conservative defaults, read on each call.
 *
 * | Variable                        | Default | Meaning                        |
 * | ------------------------------- | ------- | ------------------------------ |
 * | PDFKIT_THUMBNAIL_MAX_PAGES      | 60      | pages rendered in one request  |
 * | PDFKIT_THUMBNAIL_WIDTH          | 220     | rendered width in pixels       |
 * | PDFKIT_THUMBNAIL_MAX_BYTES      | 500000  | maximum size of one PNG        |
 */

export interface ThumbnailLimits {
  /** Maximum number of pages rendered in a single request. */
  maxPages: number;
  /** Target width of a rendered page, in pixels. */
  width: number;
  /** Maximum size of a single produced PNG, in bytes. */
  maxImageBytes: number;
}

export const DEFAULT_THUMBNAIL_LIMITS: ThumbnailLimits = {
  maxPages: 60,
  width: 220,
  maxImageBytes: 500_000,
};

/** Hard ceilings, so a misconfigured environment cannot exhaust memory. */
const MAX_ALLOWED = {
  maxPages: 200,
  width: 600,
  maxImageBytes: 4_000_000,
} as const;

function readPositiveInt(
  value: string | undefined,
  fallback: number,
  ceiling: number,
): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, ceiling);
}

export function getThumbnailLimits(): ThumbnailLimits {
  return {
    maxPages: readPositiveInt(
      process.env.PDFKIT_THUMBNAIL_MAX_PAGES,
      DEFAULT_THUMBNAIL_LIMITS.maxPages,
      MAX_ALLOWED.maxPages,
    ),
    width: readPositiveInt(
      process.env.PDFKIT_THUMBNAIL_WIDTH,
      DEFAULT_THUMBNAIL_LIMITS.width,
      MAX_ALLOWED.width,
    ),
    maxImageBytes: readPositiveInt(
      process.env.PDFKIT_THUMBNAIL_MAX_BYTES,
      DEFAULT_THUMBNAIL_LIMITS.maxImageBytes,
      MAX_ALLOWED.maxImageBytes,
    ),
  };
}
