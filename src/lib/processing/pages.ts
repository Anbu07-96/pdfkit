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
  "Use page numbers such as 1-3, 5, 7-9.";

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

/**
 * Collapse ascending page numbers into ranges: `[1, 2, 3, 5]` → `1-3, 5`.
 * Input must already be sorted and free of duplicates.
 */
export function pagesToRanges(pages: readonly number[]): PageRange[] {
  const ranges: PageRange[] = [];

  for (const page of pages) {
    const last = ranges[ranges.length - 1];
    if (last && page === last.end + 1) {
      last.end = page;
    } else {
      ranges.push({ start: page, end: page });
    }
  }

  return ranges;
}

/**
 * Every page of the document that the selection does **not** cover.
 *
 * This is what "delete these pages" means: the complement is the set of pages
 * that survive. The result is always in ascending document order, because the
 * pages that remain keep their original order — unlike a selection, where the
 * order the user typed is meaningful.
 *
 * @example complementPages([{ start: 2, end: 2 }, { start: 4, end: 4 }], 5) // [1, 3, 5]
 */
export function complementPages(
  ranges: readonly PageRange[],
  pageCount: number,
): number[] {
  if (!Number.isInteger(pageCount) || pageCount < 1) return [];

  const removed = new Set(
    expandPageRanges(ranges).filter((page) => page >= 1 && page <= pageCount),
  );

  const kept: number[] = [];
  for (let page = 1; page <= pageCount; page += 1) {
    if (!removed.has(page)) kept.push(page);
  }
  return kept;
}

/** The complement expressed as ranges, in ascending document order. */
export function complementPageRanges(
  ranges: readonly PageRange[],
  pageCount: number,
): PageRange[] {
  return pagesToRanges(complementPages(ranges, pageCount));
}

/* -------------------------------------------------------------------------- */
/* Page rotation                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Clockwise rotation applied to a page, in degrees. PDF only supports these
 * four values, so the type does too — 45° is not "nearly 90°", it is invalid.
 */
export const PAGE_ROTATIONS = [0, 90, 180, 270] as const;

export type PageRotation = (typeof PAGE_ROTATIONS)[number];

/** 1-based page number → clockwise rotation. Omitted pages mean 0°. */
export type PageRotationMap = Record<number, PageRotation>;

export function isPageRotation(value: unknown): value is PageRotation {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    (PAGE_ROTATIONS as readonly number[]).includes(value)
  );
}

/** 0 → 90 → 180 → 270 → 0. */
export function rotateClockwise(rotation: PageRotation): PageRotation {
  return (((rotation + 90) % 360) as PageRotation);
}

/** 0 → 270 → 180 → 90 → 0. */
export function rotateCounterClockwise(rotation: PageRotation): PageRotation {
  return (((rotation + 270) % 360) as PageRotation);
}

/** Compose two rotations, e.g. an existing page rotation plus the user's. */
export function addRotations(a: number, b: number): PageRotation {
  const total = (((a + b) % 360) + 360) % 360;
  return (isPageRotation(total) ? total : 0) as PageRotation;
}

/** `90` → `"90° clockwise"`, `0` → `"Original"`. */
export function formatRotation(rotation: PageRotation): string {
  return rotation === 0 ? "Original" : `${rotation}° clockwise`;
}

/** True when at least one page carries a non-zero rotation. */
export function hasRotations(rotations: PageRotationMap): boolean {
  return Object.values(rotations).some((rotation) => rotation !== 0);
}

/** Drop 0° entries — they are the default and need not be sent. */
export function compactRotations(rotations: PageRotationMap): PageRotationMap {
  const compact: PageRotationMap = {};
  for (const [page, rotation] of Object.entries(rotations)) {
    if (rotation !== 0) compact[Number(page)] = rotation;
  }
  return compact;
}

export type PageRotationIssueCode = "SYNTAX" | "INVALID_ANGLE" | "OUT_OF_RANGE";

export interface PageRotationIssue {
  code: PageRotationIssueCode;
  /** Short, user-facing explanation. Safe to render directly. */
  message: string;
}

export type PageRotationParseResult =
  | { ok: true; rotations: PageRotationMap }
  | { ok: false; issue: PageRotationIssue };

/**
 * Parse the wire format: a JSON object mapping page numbers to rotations, e.g.
 * `{"1":90,"3":180}`. Pages that are absent keep their current orientation.
 *
 * Strict on purpose: `JSON.parse` only (never `eval`), plain objects only,
 * integer page keys only, and only the four legal angles as *numbers*. Nothing
 * is coerced or normalised — `"90"`, `45` and `-90` are all rejected.
 */
export function parsePageRotations(input: string): PageRotationParseResult {
  const trimmed = (input ?? "").trim();
  if (trimmed.length === 0) return { ok: true, rotations: {} };

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return {
      ok: false,
      issue: {
        code: "SYNTAX",
        message: "The rotation settings could not be read.",
      },
    };
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    return {
      ok: false,
      issue: {
        code: "SYNTAX",
        message: "Rotations must be given as page number to angle pairs.",
      },
    };
  }

  const rotations: PageRotationMap = {};

  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!/^\d+$/.test(key)) {
      return {
        ok: false,
        issue: {
          code: "SYNTAX",
          message: `“${key}” is not a page number.`,
        },
      };
    }

    const page = Number.parseInt(key, 10);
    if (page < 1) {
      return {
        ok: false,
        issue: { code: "OUT_OF_RANGE", message: "Page numbers start at 1." },
      };
    }

    if (!isPageRotation(value)) {
      return {
        ok: false,
        issue: {
          code: "INVALID_ANGLE",
          message: `Page ${page} has an unsupported rotation. Use 0, 90, 180 or 270 degrees.`,
        },
      };
    }

    rotations[page] = value;
  }

  return { ok: true, rotations };
}

/** Check rotations against a real document. Returns `null` when valid. */
export function validatePageRotations(
  rotations: PageRotationMap,
  pageCount: number,
): PageRotationIssue | null {
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    return { code: "OUT_OF_RANGE", message: "This PDF has no pages to rotate." };
  }

  for (const [key, rotation] of Object.entries(rotations)) {
    const page = Number(key);

    if (!Number.isInteger(page) || page < 1 || page > pageCount) {
      return {
        code: "OUT_OF_RANGE",
        message: `Page ${key} does not exist. This PDF has ${pageCount} ${
          pageCount === 1 ? "page" : "pages"
        }.`,
      };
    }

    if (!isPageRotation(rotation)) {
      return {
        code: "INVALID_ANGLE",
        message: `Page ${page} has an unsupported rotation. Use 0, 90, 180 or 270 degrees.`,
      };
    }
  }

  return null;
}

/** Parse and validate in one step, against a known page count. */
export function parseAndValidatePageRotations(
  input: string,
  pageCount: number,
): PageRotationParseResult {
  const parsed = parsePageRotations(input);
  if (!parsed.ok) return parsed;

  const problem = validatePageRotations(parsed.rotations, pageCount);
  return problem ? { ok: false, issue: problem } : parsed;
}

/** Serialise for the API, omitting pages left at 0°. */
export function formatPageRotations(rotations: PageRotationMap): string {
  return JSON.stringify(compactRotations(rotations));
}

/* -------------------------------------------------------------------------- */
/* Page order (permutations)                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A complete ordering of a document's pages: every page from 1..pageCount,
 * exactly once, in the order the result should have.
 *
 * This is a different question from a page *selection*. Extract and Delete ask
 * "which pages?"; Reorder asks "in what order?" and therefore requires a full
 * permutation — no missing pages, no duplicates, no extras.
 */
export type PageOrder = number[];

export type PageOrderIssueCode =
  | "EMPTY"
  | "SYNTAX"
  | "OUT_OF_RANGE"
  | "DUPLICATE"
  | "MISSING"
  | "WRONG_LENGTH";

export interface PageOrderIssue {
  code: PageOrderIssueCode;
  /** Short, user-facing explanation. Safe to render directly. */
  message: string;
}

export type PageOrderParseResult =
  | { ok: true; order: PageOrder }
  | { ok: false; issue: PageOrderIssue };

/** `[1, 2, 3]` for a 3-page document: the document's existing order. */
export function identityPageOrder(pageCount: number): PageOrder {
  if (!Number.isInteger(pageCount) || pageCount < 1) return [];
  return Array.from({ length: pageCount }, (_, index) => index + 1);
}

export function isIdentityPageOrder(order: readonly number[]): boolean {
  return order.every((page, index) => page === index + 1);
}

/**
 * Parse a comma-separated order such as `"5,3,1,2,4"`.
 *
 * Only plain page numbers are accepted — ranges would be ambiguous here, since
 * the whole point is an explicit position-by-position ordering.
 */
export function parsePageOrder(input: string): PageOrderParseResult {
  const trimmed = (input ?? "").trim();
  if (trimmed.length === 0) {
    return { ok: false, issue: { code: "EMPTY", message: "Enter a page order." } };
  }

  const order: number[] = [];
  for (const token of trimmed.split(/[\s,;]+/).filter(Boolean)) {
    if (!/^\d+$/.test(token)) {
      return {
        ok: false,
        issue: {
          code: "SYNTAX",
          message: `“${token}” is not a page number. List every page once, for example 3,1,2.`,
        },
      };
    }
    const page = Number.parseInt(token, 10);
    if (page < 1) {
      return {
        ok: false,
        issue: {
          code: "OUT_OF_RANGE",
          message: "Page numbers start at 1.",
        },
      };
    }
    order.push(page);
  }

  return { ok: true, order };
}

/**
 * Check that an order is a complete permutation of `1..pageCount`.
 * Returns `null` when valid. Invalid input is never repaired: missing pages are
 * not appended and duplicates are not dropped.
 */
export function validatePageOrder(
  order: readonly number[],
  pageCount: number,
): PageOrderIssue | null {
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    return { code: "WRONG_LENGTH", message: "This PDF has no pages to reorder." };
  }

  if (order.length === 0) {
    return { code: "EMPTY", message: "Enter a page order." };
  }

  const seen = new Set<number>();
  for (const page of order) {
    if (!Number.isInteger(page)) {
      return {
        code: "SYNTAX",
        message: `“${page}” is not a whole page number.`,
      };
    }
    if (page < 1 || page > pageCount) {
      return {
        code: "OUT_OF_RANGE",
        message: `Page ${page} does not exist. This PDF has ${pageCount} ${
          pageCount === 1 ? "page" : "pages"
        }.`,
      };
    }
    if (seen.has(page)) {
      return {
        code: "DUPLICATE",
        message: `Page ${page} appears more than once. Each page must appear exactly once.`,
      };
    }
    seen.add(page);
  }

  if (order.length !== pageCount) {
    const missing = identityPageOrder(pageCount).filter((page) => !seen.has(page));
    if (missing.length > 0) {
      return {
        code: "MISSING",
        message:
          missing.length === 1
            ? `Page ${missing[0]} is missing. Every page must appear exactly once.`
            : `Pages ${missing.join(", ")} are missing. Every page must appear exactly once.`,
      };
    }
    return {
      code: "WRONG_LENGTH",
      message: `The order must list all ${pageCount} pages. You listed ${order.length}.`,
    };
  }

  return null;
}

/** Parse and validate in one step, against a known page count. */
export function parseAndValidatePageOrder(
  input: string,
  pageCount: number,
): PageOrderParseResult {
  const parsed = parsePageOrder(input);
  if (!parsed.ok) return parsed;

  const problem = validatePageOrder(parsed.order, pageCount);
  return problem ? { ok: false, issue: problem } : parsed;
}

/**
 * Move the entry at `from` to index `to`, returning a new order.
 *
 * Used by the reorder interface for move controls and drag and drop, so the
 * same tested function backs every gesture. Out-of-bounds moves return the
 * order unchanged rather than throwing.
 */
export function movePageInOrder(
  order: readonly number[],
  from: number,
  to: number,
): PageOrder {
  if (from === to) return [...order];
  if (from < 0 || from >= order.length) return [...order];

  const target = Math.max(0, Math.min(order.length - 1, to));
  const next = [...order];
  const [moved] = next.splice(from, 1);
  next.splice(target, 0, moved);
  return next;
}

/** Serialise an order for the API: `[5, 3, 1]` → `"5,3,1"`. */
export function formatPageOrder(order: readonly number[]): string {
  return order.join(",");
}

/** `{ start: 5, end: 5 }` → `"5"`, `{ start: 1, end: 3 }` → `"1-3"`. */
export function formatPageRange(range: PageRange): string {
  return range.start === range.end ? `${range.start}` : `${range.start}-${range.end}`;
}

export function formatPageRanges(ranges: readonly PageRange[]): string {
  return ranges.map(formatPageRange).join(", ");
}
