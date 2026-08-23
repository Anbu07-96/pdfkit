/**
 * Page-number model.
 *
 * Shared by the browser (the workspace controls) and the server (the processor
 * validates everything again). Like `watermark.ts`, this module stays free of
 * PDF libraries and `server-only`.
 *
 * Semantics, stated up front:
 *
 * - Page **N** (1-based position in the document) is printed with the number
 *   `start + N - 1`, so numbering runs sequentially across the document. The
 *   `first`/`last` modes stamp only that page but still use its sequential
 *   number — a start value other than 1 exists for front-matter offsets.
 * - In the `Page X of Y` format, **Y is always the document's real page
 *   count**, whatever the starting number is (so a 10-page document numbered
 *   from 3 ends `Page 12 of 10` — visible and honest about the shift).
 * - Numbers are ordinary visible PDF text; they are not accessibility
 *   artifacts or bookmarks.
 */

export const PAGE_NUMBER_POSITIONS = [
  "bottom-left",
  "bottom-center",
  "bottom-right",
] as const;
export type PageNumberPosition = (typeof PAGE_NUMBER_POSITIONS)[number];

export const PAGE_NUMBER_FORMATS = ["number", "page", "page-of"] as const;
export type PageNumberFormat = (typeof PAGE_NUMBER_FORMATS)[number];

export const PAGE_NUMBER_PAGE_MODES = ["all", "first", "last"] as const;
export type PageNumberPageMode = (typeof PAGE_NUMBER_PAGE_MODES)[number];

export const MIN_START_NUMBER = 1;
export const MAX_START_NUMBER = 9999;
export const MIN_FONT_SIZE = 8;
export const MAX_FONT_SIZE = 24;

/** Fully validated page-number request. */
export interface PageNumberOptions {
  position: PageNumberPosition;
  start: number;
  fontSize: number;
  format: PageNumberFormat;
  pages: PageNumberPageMode;
}

export interface PageNumberOptionIssue {
  message: string;
}

export type PageNumberParseResult =
  | { ok: true; options: PageNumberOptions }
  | { ok: false; issue: PageNumberOptionIssue };

/**
 * Parse and validate the raw multipart values. The server never repairs bad
 * input — each field must be exactly one of the supported values.
 */
export function parsePageNumberOptions(raw: {
  position?: unknown;
  start?: unknown;
  size?: unknown;
  format?: unknown;
  pages?: unknown;
}): PageNumberParseResult {
  const position = raw.position;
  if (
    typeof position !== "string" ||
    !PAGE_NUMBER_POSITIONS.includes(position as PageNumberPosition)
  ) {
    return {
      ok: false,
      issue: {
        message: "Choose a position: bottom-left, bottom-center or bottom-right.",
      },
    };
  }

  const start = typeof raw.start === "string" ? Number(raw.start) : NaN;
  if (
    !Number.isInteger(start) ||
    start < MIN_START_NUMBER ||
    start > MAX_START_NUMBER
  ) {
    return {
      ok: false,
      issue: {
        message: `The starting number must be a whole number between ${MIN_START_NUMBER} and ${MAX_START_NUMBER}.`,
      },
    };
  }

  const fontSize = typeof raw.size === "string" ? Number(raw.size) : NaN;
  if (
    !Number.isInteger(fontSize) ||
    fontSize < MIN_FONT_SIZE ||
    fontSize > MAX_FONT_SIZE
  ) {
    return {
      ok: false,
      issue: {
        message: `The font size must be a whole number between ${MIN_FONT_SIZE} and ${MAX_FONT_SIZE}.`,
      },
    };
  }

  const format = raw.format;
  if (
    typeof format !== "string" ||
    !PAGE_NUMBER_FORMATS.includes(format as PageNumberFormat)
  ) {
    return {
      ok: false,
      issue: { message: 'Choose a format: "1", "Page 1" or "Page 1 of 10".' },
    };
  }

  const pages = raw.pages;
  if (
    typeof pages !== "string" ||
    !PAGE_NUMBER_PAGE_MODES.includes(pages as PageNumberPageMode)
  ) {
    return {
      ok: false,
      issue: { message: "Choose which pages to number: all, first or last." },
    };
  }

  return {
    ok: true,
    options: {
      position: position as PageNumberPosition,
      start,
      fontSize,
      format: format as PageNumberFormat,
      pages: pages as PageNumberPageMode,
    },
  };
}

/** 1-based page positions the mode selects. */
export function resolveNumberedPages(
  mode: PageNumberPageMode,
  pageCount: number,
): number[] {
  if (mode === "first") return [1];
  if (mode === "last") return [pageCount];
  return Array.from({ length: pageCount }, (_, index) => index + 1);
}

/** The label printed on page `pageNumber` (1-based) under the given options. */
export function pageNumberOf(
  pageNumber: number,
  pageCount: number,
  options: Pick<PageNumberOptions, "start" | "format">,
): string {
  const number = options.start + pageNumber - 1;
  if (options.format === "number") return String(number);
  if (options.format === "page") return `Page ${number}`;
  return `Page ${number} of ${pageCount}`;
}
