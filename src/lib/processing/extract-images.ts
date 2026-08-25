/**
 * Extract Images model.
 *
 * Shared by the browser (workspace controls) and the server (processor validates options).
 * Free of PDF libraries and `server-only`.
 */

export const EXTRACT_IMAGES_PAGE_MODES = ["all", "first", "last"] as const;
export type ExtractImagesPageMode = (typeof EXTRACT_IMAGES_PAGE_MODES)[number];

export interface ExtractImagesOptions {
  pages: ExtractImagesPageMode;
}

export interface ExtractImagesOptionIssue {
  message: string;
}

export type ExtractImagesParseResult =
  | { ok: true; options: ExtractImagesOptions }
  | { ok: false; issue: ExtractImagesOptionIssue };

export function parseExtractImagesOptions(raw: {
  pages?: unknown;
}): ExtractImagesParseResult {
  const pages = raw.pages;
  if (
    typeof pages !== "string" ||
    !EXTRACT_IMAGES_PAGE_MODES.includes(pages as ExtractImagesPageMode)
  ) {
    return {
      ok: false,
      issue: { message: "Choose which pages to extract images from: all, first or last." },
    };
  }

  return {
    ok: true,
    options: {
      pages: pages as ExtractImagesPageMode,
    },
  };
}

export function resolveExtractImagesPages(
  mode: ExtractImagesPageMode,
  pageCount: number,
): number[] {
  if (mode === "first") return [1];
  if (mode === "last") return [pageCount];
  return Array.from({ length: pageCount }, (_, index) => index + 1);
}
