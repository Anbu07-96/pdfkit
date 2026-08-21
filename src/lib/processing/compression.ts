/**
 * Compression level and statistics model.
 *
 * Shared by the browser (the workspace shows levels and server-returned
 * statistics) and the server (the processor computes them, the HTTP layer
 * forwards them as headers). Like `pages.ts`, this module must stay free of
 * PDF libraries and `server-only` so both sides can import it.
 *
 * Honesty rules encoded here:
 * - `wasReduced` is true only when the output is strictly smaller than the
 *   input — never claim a saving the bytes do not prove.
 * - `strategy` says what the returned bytes actually are, so the interface can
 *   distinguish "optimised losslessly", "rasterised (lossy)" and "the original
 *   file, because nothing helped".
 */

/** The three compression strengths the API accepts. */
export type CompressionLevel = "low" | "medium" | "high";

export const COMPRESSION_LEVELS: readonly CompressionLevel[] = [
  "low",
  "medium",
  "high",
];

export function isCompressionLevel(value: unknown): value is CompressionLevel {
  return (
    typeof value === "string" &&
    (COMPRESSION_LEVELS as readonly string[]).includes(value)
  );
}

/** What the returned artifact is. */
export type CompressionStrategy =
  /** The document was rebuilt losslessly (structure and/or streams). */
  | "lossless"
  /** Pages were rasterised to JPEG images — lossy, text becomes pixels. */
  | "rasterized"
  /** Nothing helped; the untouched original bytes are returned. */
  | "original";

/**
 * Why rasterisation was not attempted at `high`, when it was not.
 * Absent means it ran (or the level did not call for it).
 */
export type RasterSkipReason =
  | "no-images"
  | "too-many-pages"
  | "failed";

/** Server-computed statistics, echoed in `meta` and `X-PDFKit-*` headers. */
export interface CompressionStats {
  originalBytes: number;
  outputBytes: number;
  bytesSaved: number;
  /** Whole percent, one decimal, e.g. `33.3`. Never negative. */
  reductionPercent: number;
  wasReduced: boolean;
  compressionLevel: CompressionLevel;
  strategy: CompressionStrategy;
  rasterSkipped?: RasterSkipReason;
}

/**
 * Compute the statistics for a finished job.
 *
 * Pure and deterministic: given the same byte counts it always produces the
 * same numbers, so tests can assert exact values.
 */
export function computeCompressionStats(input: {
  originalBytes: number;
  outputBytes: number;
  compressionLevel: CompressionLevel;
  strategy: CompressionStrategy;
  rasterSkipped?: RasterSkipReason;
}): CompressionStats {
  const { originalBytes, outputBytes } = input;
  if (!(originalBytes > 0)) {
    throw new Error("computeCompressionStats requires a positive original size");
  }

  const wasReduced = outputBytes < originalBytes;
  const bytesSaved = wasReduced ? originalBytes - outputBytes : 0;
  const reductionPercent = wasReduced
    ? Math.round((bytesSaved / originalBytes) * 1000) / 10
    : 0;

  return {
    originalBytes,
    outputBytes,
    bytesSaved,
    reductionPercent,
    wasReduced,
    compressionLevel: input.compressionLevel,
    strategy: wasReduced ? input.strategy : "original",
    ...(input.rasterSkipped ? { rasterSkipped: input.rasterSkipped } : {}),
  };
}

/** Flatten stats into the processor `meta` record (numbers and strings only). */
export function compressionStatsToMeta(stats: CompressionStats): Record<
  string,
  number | string
> {
  return {
    originalBytes: stats.originalBytes,
    outputBytes: stats.outputBytes,
    bytesSaved: stats.bytesSaved,
    reductionPercent: stats.reductionPercent,
    reduced: stats.wasReduced ? "yes" : "no",
    compressionLevel: stats.compressionLevel,
    strategy: stats.strategy,
    ...(stats.rasterSkipped ? { rasterSkipped: stats.rasterSkipped } : {}),
  };
}

/**
 * Read statistics back from processor `meta`.
 *
 * Returns `undefined` when the keys are missing or malformed, so callers can
 * distinguish "no statistics" from "zero saving".
 */
export function compressionStatsFromMeta(
  meta: Record<string, unknown> | undefined,
): CompressionStats | undefined {
  if (!meta) return undefined;

  const originalBytes = meta.originalBytes;
  const outputBytes = meta.outputBytes;
  const compressionLevel = meta.compressionLevel;
  const strategy = meta.strategy;

  if (
    typeof originalBytes !== "number" ||
    typeof outputBytes !== "number" ||
    !isCompressionLevel(compressionLevel) ||
    typeof strategy !== "string"
  ) {
    return undefined;
  }

  const wasReduced = meta.reduced === "yes";
  const bytesSaved = typeof meta.bytesSaved === "number" ? meta.bytesSaved : 0;
  const reductionPercent =
    typeof meta.reductionPercent === "number" ? meta.reductionPercent : 0;
  const rasterSkipped =
    typeof meta.rasterSkipped === "string" ? meta.rasterSkipped : undefined;

  return {
    originalBytes,
    outputBytes,
    bytesSaved,
    reductionPercent,
    wasReduced,
    compressionLevel,
    strategy: strategy as CompressionStrategy,
    ...(rasterSkipped ? { rasterSkipped: rasterSkipped as RasterSkipReason } : {}),
  };
}
