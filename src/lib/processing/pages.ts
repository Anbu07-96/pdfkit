/**
 * Page selection infrastructure.
 *
 * Reusable, tool-agnostic model for "which pages does the user mean?". Split
 * PDF is the first consumer; Extract Pages, Delete Pages and Reorder Pages can
 * use the same types, parser and validation without changes.
 *
 * ## Page numbering
 *
 * Everything in this module is **1-based and inclusive**, because that is how
 * people read PDFs: page 1 is the first page, and `1-3` means pages 1, 2 and 3.
 * Conversion to the 0-based indices pdf-lib needs happens in exactly one place
 * ({@link toZeroBasedIndices}), never in UI code or processors.
 *
 * ## Syntax
 *
 * Ranges are written as `1-3, 5, 7-9`. Separators may be commas, semicolons or
 * line breaks, and whitespace around numbers is ignored. A bare number is a
 * single-page range (`5` === `5-5`).
 *
 * This module is isomorphic on purpose (no `server-only`, no pdf-lib): the
 * browser validates with exactly the same code the server enforces, so the two
 * can never disagree.
 */

/** An inclusive, 1-based page range. `{ start: 1, end: 3 }` = pages 1, 2, 3. */
export interface PageRange {
  start: number;
  end: number;
}

/** How a tool decides which pages to act on. */
export type PageSelectionMode = "every-page" | "ranges";

export const PAGE_SELECTION_MODES: readonly PageSelectionMode[] = [
  "every-page",
  "ranges",
] as const;

export function isPageSelectionMode(value: unknown): value is PageSelectionMode {
  return (
    typeof value === "string" &&
    (PAGE_SELECTION_MODES as readonly string[]).includes(value)
  );
}

/** A resolved selection: the mode the user chose and the ranges it produced. */
export interface PageSelection {
  mode: PageSelectionMode;
  /** Ranges in the order the user gave them. Order is meaningful. */
  ranges: PageRange[];
}

export type PageRangeIssueCode =
  | "EMPTY"
  | "SYNTAX"
  | "ZERO_OR_NEGATIVE"
  | "REVERSED"
  | "OUT_OF_RANGE"
  | "OVERLAP";

export interface PageRangeIssue {
  code: PageRangeIssueCode;
  /** Short, user-facing explanation. Safe to render directly. */
  message: string;
}

export type PageRangeParseResult =
  | { ok: true; ranges: PageRange[] }
  | { ok: false; issue: PageRangeIssue };

export const PAGE_RANGE_SYNTAX_HINT =
  "Use page numbers such as 1-3, 5, 7-9. Each range becomes a separate PDF.";

const SEPARATORS = /[,;\n\r]+/;
const SINGLE_PAGE = /^\d+$/;
const PAGE_SPAN = /^(\d+)\s*-\s*(\d+)$/;

function issue(code: PageRangeIssueCode, message: string): PageRangeParseResult {
  return { ok: false, issue: { code, message } };
}

/**
 * Parse user input such as `"1-3, 5, 7-9"` into ordered {@link PageRange}s.
 *
 * Invalid input is reported, never silently corrected: `3-1` is not flipped and
 * `0` is not bumped to `1`.
 */
export function parsePageRanges(input: string): PageRangeParseResult {
  const trimmed = (input ?? "").trim();
  if (trimmed.length === 0) {
    return issue("EMPTY", "Enter at least one page range.");
  }

  const tokens = trimmed
    .split(SEPARATORS)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  if (tokens.length === 0) {
    return issue("EMPTY", "Enter at least one page range.");
  }

  const ranges: PageRange[] = [];

  for (const token of tokens) {
    if (SINGLE_PAGE.test(token)) {
      const page = Number.parseInt(token, 10);
      if (page < 1) {
        return issue(
          "ZERO_OR_NEGATIVE",
          `Page numbers start at 1, so “${token}” is not valid.`,
        );
      }
      ranges.push({ start: page, end: page });
      continue;
    }

    const span = PAGE_SPAN.exec(token);
    if (!span) {
      return issue(
        "SYNTAX",
        `“${token}” is not a valid page range. ${PAGE_RANGE_SYNTAX_HINT}`,
      );
    }

    const start = Number.parseInt(span[1], 10);
    const end = Number.parseInt(span[2], 10);

    if (start < 1 || end < 1) {
      return issue(
        "ZERO_OR_NEGATIVE",
        `Page numbers start at 1, so “${token}” is not valid.`,
      );
    }

    if (start > end) {
      return issue(
        "REVERSED",
        `Range ${start}-${end} is not valid: the first page must not be after the last page.`,
      );
    }

    ranges.push({ start, end });
  }

  return { ok: true, ranges };
}

export interface ValidatePageRangesOptions {
  /**
   * Whether the same page may appear in more than one range.
   *
   * PDFKit rejects overlaps by default: for Split PDF, overlapping ranges
   * almost always mean a typo, and silently duplicating pages across outputs
   * would be a surprising result rather than a helpful one.
   */
  allowOverlap?: boolean;
}

/** Check parsed ranges against a real document. Returns `null` when valid. */
export function validatePageRanges(
  ranges: readonly PageRange[],
  pageCount: number,
  { allowOverlap = false }: ValidatePageRangesOptions = {},
): PageRangeIssue | null {
  if (ranges.length === 0) {
    return { code: "EMPTY", message: "Enter at least one page range." };
  }

  for (const range of ranges) {
    if (range.start < 1 || range.end < 1) {
      return {
        code: "ZERO_OR_NEGATIVE",
        message: `Page numbers start at 1, so ${formatPageRange(range)} is not valid.`,
      };
    }
    if (range.start > range.end) {
      return {
        code: "REVERSED",
        message: `Range ${range.start}-${range.end} is not valid: the first page must not be after the last page.`,
      };
    }
    if (range.end > pageCount) {
      return {
        code: "OUT_OF_RANGE",
        message:
          pageCount === 1
            ? `Page ${range.end} does not exist. This PDF has 1 page.`
            : `Page ${range.end} does not exist. This PDF has ${pageCount} pages.`,
      };
    }
  }

  if (!allowOverlap) {
    const seen = new Map<number, PageRange>();
    for (const range of ranges) {
      for (let page = range.start; page <= range.end; page += 1) {
        const owner = seen.get(page);
        if (owner) {
          return {
            code: "OVERLAP",
            message: `Ranges ${formatPageRange(owner)} and ${formatPageRange(
              range,
            )} both include page ${page}. Overlapping ranges are not supported.`,
          };
        }
        seen.set(page, range);
      }
    }
  }

  return null;
}

/** Parse and validate in one step, against a known page count. */
export function parseAndValidatePageRanges(
  input: string,
  pageCount: number,
  options?: ValidatePageRangesOptions,
): PageRangeParseResult {
  const parsed = parsePageRanges(input);
  if (!parsed.ok) return parsed;

  const problem = validatePageRanges(parsed.ranges, pageCount, options);
  return problem ? { ok: false, issue: problem } : parsed;
}

/** One single-page range per page: the "split every page" selection. */
export function everyPageRanges(pageCount: number): PageRange[] {
  if (!Number.isInteger(pageCount) || pageCount < 1) return [];
  return Array.from({ length: pageCount }, (_, index) => ({
    start: index + 1,
    end: index + 1,
  }));
}

/** Build the selection for a mode. `ranges` mode requires parsed input. */
export function resolvePageSelection(
  mode: PageSelectionMode,
  pageCount: number,
  ranges?: readonly PageRange[],
): PageSelection {
  if (mode === "every-page") {
    return { mode, ranges: everyPageRanges(pageCount) };
  }
  return { mode, ranges: [...(ranges ?? [])] };
}

/** `{ start: 2, end: 4 }` → `[2, 3, 4]` (1-based page numbers). */
export function expandPageRange(range: PageRange): number[] {
  const pages: number[] = [];
  for (let page = range.start; page <= range.end; page += 1) pages.push(page);
  return pages;
}

/** All pages covered by the ranges, in order (1-based, may repeat if allowed). */
export function expandPageRanges(ranges: readonly PageRange[]): number[] {
  return ranges.flatMap(expandPageRange);
}

/**
 * The single conversion point to the 0-based indices pdf-lib expects.
 * `{ start: 1, end: 3 }` → `[0, 1, 2]`.
 */
export function toZeroBasedIndices(
  ranges: PageRange | readonly PageRange[],
): number[] {
  const list = Array.isArray(ranges) ? ranges : [ranges as PageRange];
  return expandPageRanges(list).map((page) => page - 1);
}

/** How many pages the ranges cover in total. */
export function countPagesInRanges(ranges: readonly PageRange[]): number {
  return ranges.reduce((total, range) => total + (range.end - range.start + 1), 0);
}

/** `{ start: 5, end: 5 }` → `"5"`, `{ start: 1, end: 3 }` → `"1-3"`. */
export function formatPageRange(range: PageRange): string {
  return range.start === range.end ? `${range.start}` : `${range.start}-${range.end}`;
}

export function formatPageRanges(ranges: readonly PageRange[]): string {
  return ranges.map(formatPageRange).join(", ");
}
