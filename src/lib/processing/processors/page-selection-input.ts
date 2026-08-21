import "server-only";

import { ProcessingError } from "@/lib/processing/errors";
import {
  parsePageRanges,
  validatePageRanges,
  type PageRange,
} from "@/lib/processing/pages";

/**
 * Shared translation of a raw `ranges` form field into validated page ranges.
 *
 * Extract and Delete both take "which pages do you mean?" as free text, so the
 * parse → validate → map-to-error-code path lives here instead of being written
 * twice. The rules themselves stay in `pages.ts`; this only maps page-selection
 * issues onto the processing error model.
 */
export function resolveRequestedRanges(
  rawRanges: string | undefined,
  pageCount: number,
): PageRange[] {
  const parsed = parsePageRanges(rawRanges ?? "");
  if (!parsed.ok) {
    throw new ProcessingError(
      parsed.issue.code === "OUT_OF_RANGE" ? "PAGE_OUT_OF_RANGE" : "INVALID_PAGE_RANGE",
      parsed.issue.message,
    );
  }

  const problem = validatePageRanges(parsed.ranges, pageCount);
  if (problem) {
    throw new ProcessingError(
      problem.code === "OUT_OF_RANGE"
        ? "PAGE_OUT_OF_RANGE"
        : problem.code === "OVERLAP"
          ? "OVERLAPPING_RANGES"
          : "INVALID_PAGE_RANGE",
      problem.message,
    );
  }

  return parsed.ranges;
}
