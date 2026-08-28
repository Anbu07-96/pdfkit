/**
 * Add Text model.
 *
 * Shared by the browser (the workspace controls) and the server (the processor
 * validates everything again). Like `watermark.ts`, this module stays free of
 * PDF libraries and `server-only`.
 *
 * Scope is deliberately a single, honest text box: the user types (multi-line
 * supported), picks one of nine anchor positions, a font size and which pages
 * receive the text. The text is drawn as real vector text with a standard
 * Latin font (pdf-lib's WinAnsi Helvetica), never rasterised — the output
 * stays a real, searchable PDF, extended text that the font cannot encode is
 * rejected with a clear message, and oversized text is scaled down to fit
 * the page (the interface says so) instead of silently clipping.
 */

/** Maximum characters accepted for the text box (after trimming). */
export const MAX_ADD_TEXT_LENGTH = 500;

/** Maximum lines in the text box (split on newlines). */
export const MAX_ADD_TEXT_LINES = 20;

/** The nine anchor positions on a page. */
export const ADD_TEXT_PLACEMENTS = [
  "top-left",
  "top-center",
  "top-right",
  "center-left",
  "center",
  "center-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
] as const;
export type AddTextPlacement = (typeof ADD_TEXT_PLACEMENTS)[number];

/** The font sizes offered, in points. */
export const ADD_TEXT_FONT_SIZES = [12, 16, 24, 36] as const;
export type AddTextFontSize = (typeof ADD_TEXT_FONT_SIZES)[number];

export const ADD_TEXT_PAGE_MODES = ["all", "first", "last"] as const;
export type AddTextPageMode = (typeof ADD_TEXT_PAGE_MODES)[number];

/** Fully validated add-text request. */
export interface AddTextOptions {
  /** The text as entered (trimmed), with `\n` line breaks. */
  text: string;
  /** `text` split into lines. Lines may be empty (blank spacing lines). */
  lines: string[];
  placement: AddTextPlacement;
  fontSize: AddTextFontSize;
  pages: AddTextPageMode;
}

export interface AddTextOptionIssue {
  message: string;
}

export type AddTextParseResult =
  | { ok: true; options: AddTextOptions }
  | { ok: false; issue: AddTextOptionIssue };

/**
 * Parse and validate the raw multipart values. The server never repairs bad
 * input — each field must be exactly one of the supported values.
 */
export function parseAddTextOptions(raw: {
  text?: unknown;
  placement?: unknown;
  size?: unknown;
  pages?: unknown;
}): AddTextParseResult {
  const value = typeof raw.text === "string" ? raw.text : "";
  const text = value.replace(/\r\n?/g, "\n").trim();
  if (text.length === 0) {
    return { ok: false, issue: { message: "Enter the text to add." } };
  }
  if (text.length > MAX_ADD_TEXT_LENGTH) {
    return {
      ok: false,
      issue: {
        message: `The text must be ${MAX_ADD_TEXT_LENGTH} characters or fewer.`,
      },
    };
  }

  const lines = text.split("\n");
  if (lines.length > MAX_ADD_TEXT_LINES) {
    return {
      ok: false,
      issue: {
        message: `The text must fit on ${MAX_ADD_TEXT_LINES} lines or fewer.`,
      },
    };
  }

  const placement = raw.placement;
  if (
    typeof placement !== "string" ||
    !ADD_TEXT_PLACEMENTS.includes(placement as AddTextPlacement)
  ) {
    return {
      ok: false,
      issue: { message: "Choose where on the page the text should go." },
    };
  }

  const size = Number(raw.size);
  if (!ADD_TEXT_FONT_SIZES.includes(size as AddTextFontSize)) {
    return {
      ok: false,
      issue: { message: "Choose a font size: 12, 16, 24 or 36." },
    };
  }

  const pages = raw.pages;
  if (
    typeof pages !== "string" ||
    !ADD_TEXT_PAGE_MODES.includes(pages as AddTextPageMode)
  ) {
    return {
      ok: false,
      issue: { message: "Choose which pages receive the text: all, first or last." },
    };
  }

  return {
    ok: true,
    options: {
      text,
      lines,
      placement: placement as AddTextPlacement,
      fontSize: size as AddTextFontSize,
      pages: pages as AddTextPageMode,
    },
  };
}

/** 1-based page numbers the mode selects for a document of `pageCount` pages. */
export function resolveAddTextPages(
  mode: AddTextPageMode,
  pageCount: number,
): number[] {
  if (mode === "first") return [1];
  if (mode === "last") return [pageCount];
  return Array.from({ length: pageCount }, (_, index) => index + 1);
}
