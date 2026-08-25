/**
 * Draw model.
 *
 * Shared by the browser (workspace controls) and the server (processor validates
 * options). Free of PDF libraries and `server-only`.
 *
 * Draws freehand-style vector strokes on PDF pages.
 */

export const DRAW_PRESETS = [
  "checkmark",
  "cross",
  "wave",
  "circle-loop",
] as const;
export type DrawPreset = (typeof DRAW_PRESETS)[number];

export const DRAW_PLACEMENTS = [
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
export type DrawPlacement = (typeof DRAW_PLACEMENTS)[number];

export const DRAW_PAGE_MODES = ["all", "first", "last"] as const;
export type DrawPageMode = (typeof DRAW_PAGE_MODES)[number];

export const MIN_DRAW_DIMENSION = 1;
export const MAX_DRAW_DIMENSION = 1000;
export const MIN_DRAW_STROKE = 1;
export const MAX_DRAW_STROKE = 50;

export interface DrawPoint {
  x: number; // 0..1 normalized
  y: number; // 0..1 normalized
}

export interface DrawOptions {
  preset: DrawPreset;
  placement: DrawPlacement;
  width: number;
  height: number;
  strokeWidth: number;
  strokeColor: string; // hex string e.g. "#000000"
  pages: DrawPageMode;
}

export interface DrawOptionIssue {
  message: string;
}

export type DrawParseResult =
  | { ok: true; options: DrawOptions }
  | { ok: false; issue: DrawOptionIssue };

function isValidHexColor(color: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(color);
}

export function parseDrawOptions(raw: {
  preset?: unknown;
  placement?: unknown;
  width?: unknown;
  height?: unknown;
  strokeWidth?: unknown;
  strokeColor?: unknown;
  pages?: unknown;
}): DrawParseResult {
  const preset = raw.preset;
  if (
    typeof preset !== "string" ||
    !DRAW_PRESETS.includes(preset as DrawPreset)
  ) {
    return {
      ok: false,
      issue: { message: "Choose a drawing shape: checkmark, cross, wave or circle-loop." },
    };
  }

  const placement = raw.placement;
  if (
    typeof placement !== "string" ||
    !DRAW_PLACEMENTS.includes(placement as DrawPlacement)
  ) {
    return {
      ok: false,
      issue: { message: "Choose where on the page the drawing should go." },
    };
  }

  const width = Number(raw.width ?? 100);
  if (!Number.isFinite(width) || width < MIN_DRAW_DIMENSION || width > MAX_DRAW_DIMENSION) {
    return {
      ok: false,
      issue: {
        message: `Drawing width must be between ${MIN_DRAW_DIMENSION} and ${MAX_DRAW_DIMENSION} points.`,
      },
    };
  }

  const height = Number(raw.height ?? 60);
  if (!Number.isFinite(height) || height < MIN_DRAW_DIMENSION || height > MAX_DRAW_DIMENSION) {
    return {
      ok: false,
      issue: {
        message: `Drawing height must be between ${MIN_DRAW_DIMENSION} and ${MAX_DRAW_DIMENSION} points.`,
      },
    };
  }

  const strokeWidth = Number(raw.strokeWidth ?? 3);
  if (
    !Number.isFinite(strokeWidth) ||
    strokeWidth < MIN_DRAW_STROKE ||
    strokeWidth > MAX_DRAW_STROKE
  ) {
    return {
      ok: false,
      issue: {
        message: `Stroke width must be between ${MIN_DRAW_STROKE} and ${MAX_DRAW_STROKE} points.`,
      },
    };
  }

  const strokeColor = typeof raw.strokeColor === "string" ? raw.strokeColor.trim() : "#000000";
  if (!isValidHexColor(strokeColor)) {
    return {
      ok: false,
      issue: { message: "Provide a valid hex color for drawing (e.g. #000000)." },
    };
  }

  const pages = raw.pages;
  if (
    typeof pages !== "string" ||
    !DRAW_PAGE_MODES.includes(pages as DrawPageMode)
  ) {
    return {
      ok: false,
      issue: { message: "Choose which pages receive the drawing: all, first or last." },
    };
  }

  return {
    ok: true,
    options: {
      preset: preset as DrawPreset,
      placement: placement as DrawPlacement,
      width,
      height,
      strokeWidth,
      strokeColor,
      pages: pages as DrawPageMode,
    },
  };
}

export function resolveDrawPages(
  mode: DrawPageMode,
  pageCount: number,
): number[] {
  if (mode === "first") return [1];
  if (mode === "last") return [pageCount];
  return Array.from({ length: pageCount }, (_, index) => index + 1);
}

/** Get normalized 0..1 path points for a drawing preset. */
export function getPresetPoints(preset: DrawPreset): DrawPoint[][] {
  switch (preset) {
    case "checkmark":
      return [
        [
          { x: 0.1, y: 0.5 },
          { x: 0.4, y: 0.1 },
          { x: 0.9, y: 0.9 },
        ],
      ];
    case "cross":
      return [
        [
          { x: 0.1, y: 0.9 },
          { x: 0.9, y: 0.1 },
        ],
        [
          { x: 0.1, y: 0.1 },
          { x: 0.9, y: 0.9 },
        ],
      ];
    case "wave": {
      const path: DrawPoint[] = [];
      const steps = 20;
      for (let i = 0; i <= steps; i++) {
        const x = i / steps;
        const y = 0.5 + 0.4 * Math.sin(x * Math.PI * 2);
        path.push({ x, y });
      }
      return [path];
    }
    case "circle-loop": {
      const path: DrawPoint[] = [];
      const steps = 24;
      for (let i = 0; i <= steps; i++) {
        const angle = (i / steps) * Math.PI * 2;
        const x = 0.5 + 0.4 * Math.cos(angle);
        const y = 0.5 + 0.4 * Math.sin(angle);
        path.push({ x, y });
      }
      return [path];
    }
  }
}
