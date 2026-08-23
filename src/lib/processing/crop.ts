/**
 * Crop model.
 *
 * Shared by the browser (the workspace controls) and the server (the processor
 * validates everything again). Like `watermark.ts` and `page-numbers.ts`,
 * this module stays free of PDF libraries and `server-only`.
 *
 * Semantics, stated up front:
 *
 * - Cropping sets the page's **CropBox only** — the visible window. It never
 *   touches the MediaBox, the content streams, rotation or any other object.
 *   Cropped-out content **remains in the file and stays recoverable**; this
 *   tool is not redaction and must never be used as one.
 * - Coordinates are PDF points (1 pt = 1/72 inch) with a **bottom-left
 *   origin**, Y growing upward, in the page's **unrotated** coordinate space —
 *   exactly the PDF user-space convention, no alternate semantics.
 * - Validation **rejects, never clamps**: every value must be finite, a crop
 *   side must be at least 10 pt, and the resulting rectangle must lie fully
 *   inside each selected page's MediaBox.
 * - **Rectangle mode** applies one absolute rectangle and validates it against
 *   every selected page — if it does not fit one of them, the whole request is
 *   rejected (no silent per-page resizing). **Margins mode** computes the
 *   rectangle from each selected page's own MediaBox, so the same margins work
 *   across heterogeneous page sizes.
 */

export const CROP_MODES = ["rectangle", "margins"] as const;
export type CropMode = (typeof CROP_MODES)[number];

/** Smallest allowed crop side, in points. */
export const MIN_CROP_SIDE_PT = 10;

/** Fully validated crop request (before page geometry is checked). */
export interface CropOptions {
  mode: CropMode;
  /** Absolute rectangle (points), for `rectangle` mode. */
  rectangle?: { x: number; y: number; width: number; height: number };
  /** Insets from the MediaBox edges (points), for `margins` mode. */
  margins?: { top: number; right: number; bottom: number; left: number };
}

export interface CropOptionIssue {
  message: string;
}

export type CropParseResult =
  | { ok: true; options: CropOptions }
  | { ok: false; issue: CropOptionIssue };

function finiteNumber(value: unknown): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Parse the raw multipart values into options. Only shape and finiteness are
 * checked here; MediaBox fit is validated per page by the processor.
 */
export function parseCropOptions(raw: {
  mode?: unknown;
  x?: unknown;
  y?: unknown;
  width?: unknown;
  height?: unknown;
  top?: unknown;
  right?: unknown;
  bottom?: unknown;
  left?: unknown;
}): CropParseResult {
  const mode = raw.mode;
  if (typeof mode !== "string" || !CROP_MODES.includes(mode as CropMode)) {
    return {
      ok: false,
      issue: { message: "Choose a crop mode: rectangle or margins." },
    };
  }

  if (mode === "rectangle") {
    const values: Record<string, unknown> = {
      x: raw.x,
      y: raw.y,
      width: raw.width,
      height: raw.height,
    };
    const parsed: Record<string, number> = {};
    for (const key of Object.keys(values)) {
      const value = finiteNumber(values[key]);
      if (value === null) {
        return {
          ok: false,
          issue: {
            message: `Enter a finite number for ${key}. Coordinates are points; NaN and Infinity are not accepted.`,
          },
        };
      }
      parsed[key] = value;
    }
    const { x, y, width, height } = parsed;
    if (x < 0 || y < 0) {
      return {
        ok: false,
        issue: { message: "The rectangle origin must be at or above 0 on both axes (bottom-left origin)." },
      };
    }
    if (width < MIN_CROP_SIDE_PT || height < MIN_CROP_SIDE_PT) {
      return {
        ok: false,
        issue: {
          message: `The crop rectangle must be at least ${MIN_CROP_SIDE_PT} pt wide and tall.`,
        },
      };
    }
    return {
      ok: true,
      options: {
        mode: "rectangle",
        rectangle: { x, y, width, height },
      },
    };
  }

  // margins mode
  const values: Record<string, unknown> = {
    top: raw.top,
    right: raw.right,
    bottom: raw.bottom,
    left: raw.left,
  };
  const parsed: Record<string, number> = {};
  for (const key of Object.keys(values)) {
    const value = finiteNumber(values[key]);
    if (value === null) {
      return {
        ok: false,
        issue: {
          message: `Enter a finite number for the ${key} margin. Margins are points; NaN and Infinity are not accepted.`,
        },
      };
    }
    parsed[key] = value;
  }
  for (const [key, value] of Object.entries(parsed)) {
    if (value < 0) {
      return {
        ok: false,
        issue: { message: `The ${key} margin must be 0 or larger.` },
      };
    }
  }
  return {
    ok: true,
    options: {
      mode: "margins",
      margins: {
        top: parsed.top,
        right: parsed.right,
        bottom: parsed.bottom,
        left: parsed.left,
      },
    },
  };
}

/** A MediaBox as reported by pdf-lib: origin plus size, in points. */
export interface PageSize {
  width: number;
  height: number;
}

/** The crop rectangle a mode yields for one page's MediaBox, or a reason. */
export function cropRectangleForPage(
  options: CropOptions,
  page: PageSize,
): { rectangle: { x: number; y: number; width: number; height: number } } | { issue: CropOptionIssue } {
  if (options.mode === "rectangle" && options.rectangle) {
    const { x, y, width, height } = options.rectangle;
    if (x + width > page.width || y + height > page.height) {
      return {
        issue: {
          message: `The rectangle (x ${x}, y ${y}, ${width} × ${height} pt) does not fit inside this page's MediaBox (${page.width} × ${page.height} pt). Rectangle mode applies one rectangle to every selected page — switch to margins mode for mixed page sizes.`,
        },
      };
    }
    return { rectangle: { x, y, width, height } };
  }

  const margins = options.margins ?? { top: 0, right: 0, bottom: 0, left: 0 };
  const width = page.width - margins.left - margins.right;
  const height = page.height - margins.top - margins.bottom;
  if (width < MIN_CROP_SIDE_PT || height < MIN_CROP_SIDE_PT) {
    return {
      issue: {
        message: `These margins leave only ${Math.max(0, width).toFixed(1)} × ${Math.max(0, height).toFixed(1)} pt of a ${page.width} × ${page.height} pt page. The crop must keep at least ${MIN_CROP_SIDE_PT} pt on each side.`,
      },
    };
  }
  return {
    rectangle: { x: margins.left, y: margins.bottom, width, height },
  };
}
