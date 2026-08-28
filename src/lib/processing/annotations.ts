/**
 * Annotations model.
 *
 * Shared by the browser (workspace controls) and the server (processor validates
 * options). Free of PDF libraries and `server-only`.
 *
 * Supports real standard PDF annotations:
 * 1. Comment / Sticky Note (/Subtype /Text)
 * 2. Hyperlink (/Subtype /Link with /URI action)
 */

export const ANNOTATION_TYPES = ["comment", "link"] as const;
export type AnnotationType = (typeof ANNOTATION_TYPES)[number];

export const ANNOTATION_PLACEMENTS = [
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
export type AnnotationPlacement = (typeof ANNOTATION_PLACEMENTS)[number];

export const ANNOTATION_PAGE_MODES = ["all", "first", "last"] as const;
export type AnnotationPageMode = (typeof ANNOTATION_PAGE_MODES)[number];

export const MIN_ANNOTATION_DIMENSION = 1;
export const MAX_ANNOTATION_DIMENSION = 1000;
export const MAX_ANNOTATION_TEXT_LENGTH = 1000;
export const MAX_ANNOTATION_AUTHOR_LENGTH = 100;
export const MAX_ANNOTATION_URL_LENGTH = 500;

export interface AnnotationsOptions {
  type: AnnotationType;
  placement: AnnotationPlacement;
  text: string;
  author: string;
  url: string;
  width: number;
  height: number;
  pages: AnnotationPageMode;
}

export interface AnnotationsOptionIssue {
  message: string;
}

export type AnnotationsParseResult =
  | { ok: true; options: AnnotationsOptions }
  | { ok: false; issue: AnnotationsOptionIssue };

function isValidUrl(urlString: string): boolean {
  if (!/^https?:\/\//i.test(urlString)) return false;
  try {
    const parsed = new URL(urlString);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function parseAnnotationsOptions(raw: {
  type?: unknown;
  placement?: unknown;
  text?: unknown;
  author?: unknown;
  url?: unknown;
  width?: unknown;
  height?: unknown;
  pages?: unknown;
}): AnnotationsParseResult {
  const type = raw.type;
  if (
    typeof type !== "string" ||
    !ANNOTATION_TYPES.includes(type as AnnotationType)
  ) {
    return {
      ok: false,
      issue: { message: "Choose an annotation type: comment or link." },
    };
  }

  const placement = raw.placement;
  if (
    typeof placement !== "string" ||
    !ANNOTATION_PLACEMENTS.includes(placement as AnnotationPlacement)
  ) {
    return {
      ok: false,
      issue: { message: "Choose where on the page the annotation should go." },
    };
  }

  const text = typeof raw.text === "string" ? raw.text.trim() : "";
  const author = typeof raw.author === "string" ? raw.author.trim() : "";
  const url = typeof raw.url === "string" ? raw.url.trim() : "";

  if (type === "comment") {
    if (text.length === 0) {
      return { ok: false, issue: { message: "Enter comment text for the note." } };
    }
    if (text.length > MAX_ANNOTATION_TEXT_LENGTH) {
      return {
        ok: false,
        issue: {
          message: `Comment text must be ${MAX_ANNOTATION_TEXT_LENGTH} characters or fewer.`,
        },
      };
    }
    if (author.length > MAX_ANNOTATION_AUTHOR_LENGTH) {
      return {
        ok: false,
        issue: {
          message: `Author name must be ${MAX_ANNOTATION_AUTHOR_LENGTH} characters or fewer.`,
        },
      };
    }
  }

  if (type === "link") {
    if (url.length === 0 || !isValidUrl(url)) {
      return {
        ok: false,
        issue: { message: "Enter a valid URL starting with http:// or https://." },
      };
    }
    if (url.length > MAX_ANNOTATION_URL_LENGTH) {
      return {
        ok: false,
        issue: {
          message: `URL must be ${MAX_ANNOTATION_URL_LENGTH} characters or fewer.`,
        },
      };
    }
  }

  const defaultWidth = type === "link" ? 150 : 30;
  const defaultHeight = type === "link" ? 30 : 30;

  const width = Number(raw.width ?? defaultWidth);
  if (
    !Number.isFinite(width) ||
    width < MIN_ANNOTATION_DIMENSION ||
    width > MAX_ANNOTATION_DIMENSION
  ) {
    return {
      ok: false,
      issue: {
        message: `Width must be between ${MIN_ANNOTATION_DIMENSION} and ${MAX_ANNOTATION_DIMENSION} points.`,
      },
    };
  }

  const height = Number(raw.height ?? defaultHeight);
  if (
    !Number.isFinite(height) ||
    height < MIN_ANNOTATION_DIMENSION ||
    height > MAX_ANNOTATION_DIMENSION
  ) {
    return {
      ok: false,
      issue: {
        message: `Height must be between ${MIN_ANNOTATION_DIMENSION} and ${MAX_ANNOTATION_DIMENSION} points.`,
      },
    };
  }

  const pages = raw.pages;
  if (
    typeof pages !== "string" ||
    !ANNOTATION_PAGE_MODES.includes(pages as AnnotationPageMode)
  ) {
    return {
      ok: false,
      issue: { message: "Choose which pages receive the annotation: all, first or last." },
    };
  }

  return {
    ok: true,
    options: {
      type: type as AnnotationType,
      placement: placement as AnnotationPlacement,
      text,
      author,
      url,
      width,
      height,
      pages: pages as AnnotationPageMode,
    },
  };
}

export function resolveAnnotationPages(
  mode: AnnotationPageMode,
  pageCount: number,
): number[] {
  if (mode === "first") return [1];
  if (mode === "last") return [pageCount];
  return Array.from({ length: pageCount }, (_, index) => index + 1);
}
