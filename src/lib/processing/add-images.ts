/**
 * Add Images model.
 *
 * Shared by the browser (workspace controls) and the server (processor validates
 * options). Free of PDF libraries and `server-only`.
 */

export const ADD_IMAGE_PLACEMENTS = [
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
export type AddImagePlacement = (typeof ADD_IMAGE_PLACEMENTS)[number];

export const ADD_IMAGE_PAGE_MODES = ["all", "first", "last"] as const;
export type AddImagePageMode = (typeof ADD_IMAGE_PAGE_MODES)[number];

export const MIN_IMAGE_DIMENSION = 1;
export const MAX_IMAGE_DIMENSION = 1000;

export interface AddImagesOptions {
  placement: AddImagePlacement;
  width: number;
  height: number;
  preserveAspectRatio: boolean;
  pages: AddImagePageMode;
}

export interface AddImagesOptionIssue {
  message: string;
}

export type AddImagesParseResult =
  | { ok: true; options: AddImagesOptions }
  | { ok: false; issue: AddImagesOptionIssue };

export function parseAddImagesOptions(raw: {
  placement?: unknown;
  width?: unknown;
  height?: unknown;
  preserveAspectRatio?: unknown;
  pages?: unknown;
}): AddImagesParseResult {
  const placement = raw.placement;
  if (
    typeof placement !== "string" ||
    !ADD_IMAGE_PLACEMENTS.includes(placement as AddImagePlacement)
  ) {
    return {
      ok: false,
      issue: { message: "Choose where on the page the image should go." },
    };
  }

  const width = Number(raw.width ?? 150);
  if (!Number.isFinite(width) || width < MIN_IMAGE_DIMENSION || width > MAX_IMAGE_DIMENSION) {
    return {
      ok: false,
      issue: {
        message: `Image width must be between ${MIN_IMAGE_DIMENSION} and ${MAX_IMAGE_DIMENSION} points.`,
      },
    };
  }

  const height = Number(raw.height ?? 150);
  if (!Number.isFinite(height) || height < MIN_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
    return {
      ok: false,
      issue: {
        message: `Image height must be between ${MIN_IMAGE_DIMENSION} and ${MAX_IMAGE_DIMENSION} points.`,
      },
    };
  }

  const preserveAspectRatio =
    raw.preserveAspectRatio === undefined
      ? true
      : String(raw.preserveAspectRatio) === "true";

  const pages = raw.pages;
  if (
    typeof pages !== "string" ||
    !ADD_IMAGE_PAGE_MODES.includes(pages as AddImagePageMode)
  ) {
    return {
      ok: false,
      issue: { message: "Choose which pages receive the image: all, first or last." },
    };
  }

  return {
    ok: true,
    options: {
      placement: placement as AddImagePlacement,
      width,
      height,
      preserveAspectRatio,
      pages: pages as AddImagePageMode,
    },
  };
}

export function resolveAddImagesPages(
  mode: AddImagePageMode,
  pageCount: number,
): number[] {
  if (mode === "first") return [1];
  if (mode === "last") return [pageCount];
  return Array.from({ length: pageCount }, (_, index) => index + 1);
}
