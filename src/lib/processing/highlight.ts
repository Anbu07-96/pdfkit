/**
 * Highlight model.
 *
 * Shared by the browser (workspace controls) and the server (processor validates
 * options). Free of PDF libraries and `server-only`.
 *
 * Highlighting applies a semi-transparent visual overlay. It does NOT remove
 * or sanitize underlying PDF content.
 */

export const HIGHLIGHT_PLACEMENTS = [
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
export type HighlightPlacement = (typeof HIGHLIGHT_PLACEMENTS)[number];

export const HIGHLIGHT_PAGE_MODES = ["all", "first", "last"] as const;
export type HighlightPageMode = (typeof HIGHLIGHT_PAGE_MODES)[number];

export const MIN_HIGHLIGHT_DIMENSION = 1;
export const MAX_HIGHLIGHT_DIMENSION = 1000;

export interface HighlightOptions {
  placement: HighlightPlacement;
  width: number;
  height: number;
  color: string;   // hex string e.g. "#fef08a"
  opacity: number; // 0.1 .. 1.0
  pages: HighlightPageMode;
}

export interface HighlightOptionIssue {
  message: string;
}

export type HighlightParseResult =
  | { ok: true; options: HighlightOptions }
  | { ok: false; issue: HighlightOptionIssue };

function isValidHexColor(color: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(color);
}

export function parseHighlightOptions(raw: {
  placement?: unknown;
  width?: unknown;
  height?: unknown;
  color?: unknown;
  opacity?: unknown;
  pages?: unknown;
}): HighlightParseResult {
  const placement = raw.placement;
  if (
    typeof placement !== "string" ||
    !HIGHLIGHT_PLACEMENTS.includes(placement as HighlightPlacement)
  ) {
    return {
      ok: false,
      issue: { message: "Choose where on the page the highlight should go." },
    };
  }

  const width = Number(raw.width ?? 200);
  if (
    !Number.isFinite(width) ||
    width < MIN_HIGHLIGHT_DIMENSION ||
    width > MAX_HIGHLIGHT_DIMENSION
  ) {
    return {
      ok: false,
      issue: {
        message: `Highlight width must be between ${MIN_HIGHLIGHT_DIMENSION} and ${MAX_HIGHLIGHT_DIMENSION} points.`,
      },
    };
  }

  const height = Number(raw.height ?? 24);
  if (
    !Number.isFinite(height) ||
    height < MIN_HIGHLIGHT_DIMENSION ||
    height > MAX_HIGHLIGHT_DIMENSION
  ) {
    return {
      ok: false,
      issue: {
        message: `Highlight height must be between ${MIN_HIGHLIGHT_DIMENSION} and ${MAX_HIGHLIGHT_DIMENSION} points.`,
      },
    };
  }

  const color = typeof raw.color === "string" ? raw.color.trim() : "#fef08a";
  if (!isValidHexColor(color)) {
    return {
      ok: false,
      issue: { message: "Provide a valid hex color for highlighting (e.g. #fef08a)." },
    };
  }

  const opacity = Number(raw.opacity ?? 0.5);
  if (!Number.isFinite(opacity) || opacity < 0.05 || opacity > 1.0) {
    return {
      ok: false,
      issue: { message: "Opacity must be between 0.05 and 1.0." },
    };
  }

  const pages = raw.pages;
  if (
    typeof pages !== "string" ||
    !HIGHLIGHT_PAGE_MODES.includes(pages as HighlightPageMode)
  ) {
    return {
      ok: false,
      issue: { message: "Choose which pages receive the highlight: all, first or last." },
    };
  }

  return {
    ok: true,
    options: {
      placement: placement as HighlightPlacement,
      width,
      height,
      color,
      opacity,
      pages: pages as HighlightPageMode,
    },
  };
}

export function resolveHighlightPages(
  mode: HighlightPageMode,
  pageCount: number,
): number[] {
  if (mode === "first") return [1];
  if (mode === "last") return [pageCount];
  return Array.from({ length: pageCount }, (_, index) => index + 1);
}
