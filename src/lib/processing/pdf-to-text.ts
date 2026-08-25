/**
 * PDF to Text model.
 *
 * Shared by the browser (workspace controls) and the server (processor validates options).
 * Free of PDF libraries and `server-only`.
 */

export const PDF_TO_TEXT_PAGE_MODES = ["all", "first", "last"] as const;
export type PdfToTextPageMode = (typeof PDF_TO_TEXT_PAGE_MODES)[number];

export interface PdfToTextOptions {
  pages: PdfToTextPageMode;
}

export interface PdfToTextOptionIssue {
  message: string;
}

export type PdfToTextParseResult =
  | { ok: true; options: PdfToTextOptions }
  | { ok: false; issue: PdfToTextOptionIssue };

export function parsePdfToTextOptions(raw: {
  pages?: unknown;
}): PdfToTextParseResult {
  const pages = raw.pages;
  if (
    typeof pages !== "string" ||
    !PDF_TO_TEXT_PAGE_MODES.includes(pages as PdfToTextPageMode)
  ) {
    return {
      ok: false,
      issue: { message: "Choose which pages to extract text from: all, first or last." },
    };
  }

  return {
    ok: true,
    options: {
      pages: pages as PdfToTextPageMode,
    },
  };
}

export function resolvePdfToTextPages(
  mode: PdfToTextPageMode,
  pageCount: number,
): number[] {
  if (mode === "first") return [1];
  if (mode === "last") return [pageCount];
  return Array.from({ length: pageCount }, (_, index) => index + 1);
}
