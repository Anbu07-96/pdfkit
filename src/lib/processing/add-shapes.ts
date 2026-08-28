/**
 * Add Shapes model.
 *
 * Shared by the browser (workspace controls) and the server (processor validates
 * everything again). Like `watermark.ts` and `add-text.ts`, this module stays free
 * of PDF libraries and `server-only` so it can be imported from both sides.
 *
 * Vector shapes (rectangle, circle, ellipse, line) are drawn on pages using pdf-lib.
 * Pages are never rasterised. Shapes are constrained to stay inside page boundaries.
 */

/** MVP shape set supported. */
export const ADD_SHAPE_TYPES = ["rectangle", "circle", "ellipse", "line"] as const;
export type AddShapeType = (typeof ADD_SHAPE_TYPES)[number];

/** The nine anchor positions on a page. */
export const ADD_SHAPE_PLACEMENTS = [
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
export type AddShapePlacement = (typeof ADD_SHAPE_PLACEMENTS)[number];

export const ADD_SHAPE_PAGE_MODES = ["all", "first", "last"] as const;
export type AddShapePageMode = (typeof ADD_SHAPE_PAGE_MODES)[number];

/** Minimum and maximum dimensions in points. */
export const MIN_SHAPE_DIMENSION = 0;
export const MAX_SHAPE_DIMENSION = 1000;

export const MIN_STROKE_WIDTH = 0;
export const MAX_STROKE_WIDTH = 50;

/** Fully validated add-shapes request. */
export interface AddShapesOptions {
  shape: AddShapeType;
  placement: AddShapePlacement;
  width: number;
  height: number;
  strokeWidth: number;
  strokeColor: string; // hex string, e.g. "#000000" or "none" / "transparent"
  fillColor: string;   // hex string, e.g. "#2563eb" or "none" / "transparent"
  pages: AddShapePageMode;
}

export interface AddShapesOptionIssue {
  message: string;
}

export type AddShapesParseResult =
  | { ok: true; options: AddShapesOptions }
  | { ok: false; issue: AddShapesOptionIssue };

function isValidHexColor(color: string): boolean {
  if (color === "none" || color === "transparent") return true;
  return /^#[0-9a-fA-F]{6}$/.test(color);
}

/**
 * Parse and validate the raw multipart or JSON options.
 */
export function parseAddShapesOptions(raw: {
  shape?: unknown;
  placement?: unknown;
  width?: unknown;
  height?: unknown;
  strokeWidth?: unknown;
  strokeColor?: unknown;
  fillColor?: unknown;
  pages?: unknown;
}): AddShapesParseResult {
  const shape = raw.shape;
  if (
    typeof shape !== "string" ||
    !ADD_SHAPE_TYPES.includes(shape as AddShapeType)
  ) {
    return {
      ok: false,
      issue: { message: "Choose a shape: rectangle, circle, ellipse or line." },
    };
  }

  const placement = raw.placement;
  if (
    typeof placement !== "string" ||
    !ADD_SHAPE_PLACEMENTS.includes(placement as AddShapePlacement)
  ) {
    return {
      ok: false,
      issue: { message: "Choose where on the page the shape should go." },
    };
  }

  const width = Number(raw.width ?? 120);
  if (!Number.isFinite(width) || width < MIN_SHAPE_DIMENSION || width > MAX_SHAPE_DIMENSION) {
    return {
      ok: false,
      issue: {
        message: `Shape width must be between ${MIN_SHAPE_DIMENSION} and ${MAX_SHAPE_DIMENSION} points.`,
      },
    };
  }

  const height = Number(raw.height ?? 80);
  if (!Number.isFinite(height) || height < MIN_SHAPE_DIMENSION || height > MAX_SHAPE_DIMENSION) {
    return {
      ok: false,
      issue: {
        message: `Shape height must be between ${MIN_SHAPE_DIMENSION} and ${MAX_SHAPE_DIMENSION} points.`,
      },
    };
  }

  const strokeWidth = Number(raw.strokeWidth ?? 2);
  if (
    !Number.isFinite(strokeWidth) ||
    strokeWidth < MIN_STROKE_WIDTH ||
    strokeWidth > MAX_STROKE_WIDTH
  ) {
    return {
      ok: false,
      issue: {
        message: `Stroke width must be between ${MIN_STROKE_WIDTH} and ${MAX_STROKE_WIDTH} points.`,
      },
    };
  }

  const strokeColor = typeof raw.strokeColor === "string" ? raw.strokeColor.trim() : "#000000";
  if (!isValidHexColor(strokeColor)) {
    return {
      ok: false,
      issue: { message: "Provide a valid stroke color (e.g. #000000 or none)." },
    };
  }

  const fillColor = typeof raw.fillColor === "string" ? raw.fillColor.trim() : "transparent";
  if (!isValidHexColor(fillColor)) {
    return {
      ok: false,
      issue: { message: "Provide a valid fill color (e.g. #2563eb or transparent)." },
    };
  }

  const isStrokeNone = strokeColor === "none" || strokeColor === "transparent" || strokeWidth === 0;
  const isFillNone = fillColor === "none" || fillColor === "transparent";

  // Lines don't use fill, but must have a stroke
  if (shape === "line" && isStrokeNone) {
    return {
      ok: false,
      issue: { message: "Lines must have a stroke color and stroke width." },
    };
  }

  if (isStrokeNone && isFillNone) {
    return {
      ok: false,
      issue: { message: "Shapes must have either a stroke or a fill color." },
    };
  }

  const pages = raw.pages;
  if (
    typeof pages !== "string" ||
    !ADD_SHAPE_PAGE_MODES.includes(pages as AddShapePageMode)
  ) {
    return {
      ok: false,
      issue: { message: "Choose which pages receive the shape: all, first or last." },
    };
  }

  return {
    ok: true,
    options: {
      shape: shape as AddShapeType,
      placement: placement as AddShapePlacement,
      width,
      height,
      strokeWidth,
      strokeColor,
      fillColor,
      pages: pages as AddShapePageMode,
    },
  };
}

/** 1-based page numbers selected for a document of `pageCount` pages. */
export function resolveAddShapesPages(
  mode: AddShapePageMode,
  pageCount: number,
): number[] {
  if (mode === "first") return [1];
  if (mode === "last") return [pageCount];
  return Array.from({ length: pageCount }, (_, index) => index + 1);
}

/** Parse hex string (#RRGGBB) to 0..1 normalized RGB floats or null if none. */
export function parseHexColor(
  hex: string,
): { r: number; g: number; b: number } | null {
  if (!hex || hex === "none" || hex === "transparent") return null;
  const match = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(hex);
  if (!match) return null;
  return {
    r: parseInt(match[1]!, 16) / 255,
    g: parseInt(match[2]!, 16) / 255,
    b: parseInt(match[3]!, 16) / 255,
  };
}
