/**
 * Watermark model.
 *
 * Shared by the browser (the workspace controls) and the server (the processor
 * validates everything again). Like `pages.ts` and `compression.ts`, this
 * module stays free of PDF libraries and `server-only`.
 *
 * Scope is deliberately text-only watermarks with a small set of predictable
 * options. A visible watermark is a **deterrent, not protection** — the
 * interface and docs say so; it can be cropped or removed by a determined
 * user with any PDF editor.
 */

/** Maximum characters accepted for the watermark text. */
export const MAX_WATERMARK_TEXT_LENGTH = 200;

/** The three opacity strengths, in percent. */
export const WATERMARK_OPACITIES = [25, 50, 75] as const;
export type WatermarkOpacityPercent = (typeof WATERMARK_OPACITIES)[number];

/** The three rotations, in degrees (counter-clockwise, like the PDF spec). */
export const WATERMARK_ROTATIONS = [0, 45, -45] as const;
export type WatermarkRotationDegrees = (typeof WATERMARK_ROTATIONS)[number];

export const WATERMARK_PLACEMENTS = ["center", "diagonal-tiled", "corner"] as const;
export type WatermarkPlacement = (typeof WATERMARK_PLACEMENTS)[number];

export const WATERMARK_PAGE_MODES = ["all", "first", "last"] as const;
export type WatermarkPageMode = (typeof WATERMARK_PAGE_MODES)[number];

/** Fully validated watermark request. */
export interface WatermarkOptions {
  text: string;
  opacityPercent: WatermarkOpacityPercent;
  rotationDegrees: WatermarkRotationDegrees;
  placement: WatermarkPlacement;
  pages: WatermarkPageMode;
}

export interface WatermarkOptionIssue {
  message: string;
}

export type WatermarkParseResult =
  | { ok: true; options: WatermarkOptions }
  | { ok: false; issue: WatermarkOptionIssue };

/**
 * Parse and validate the raw multipart values. The server never repairs bad
 * input — each field must be exactly one of the supported values.
 */
export function parseWatermarkOptions(raw: {
  text?: unknown;
  opacity?: unknown;
  rotation?: unknown;
  placement?: unknown;
  pages?: unknown;
}): WatermarkParseResult {
  const text = typeof raw.text === "string" ? raw.text : "";
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return { ok: false, issue: { message: "Enter the watermark text." } };
  }
  if (trimmed.length > MAX_WATERMARK_TEXT_LENGTH) {
    return {
      ok: false,
      issue: {
        message: `The watermark text must be ${MAX_WATERMARK_TEXT_LENGTH} characters or fewer.`,
      },
    };
  }

  const opacity = Number(raw.opacity);
  if (!WATERMARK_OPACITIES.includes(opacity as WatermarkOpacityPercent)) {
    return {
      ok: false,
      issue: { message: "Choose an opacity: 25%, 50% or 75%." },
    };
  }

  const rotation = Number(raw.rotation);
  if (!WATERMARK_ROTATIONS.includes(rotation as WatermarkRotationDegrees)) {
    return { ok: false, issue: { message: "Choose a rotation: 0°, 45° or -45°." } };
  }

  const placement = raw.placement;
  if (
    typeof placement !== "string" ||
    !WATERMARK_PLACEMENTS.includes(placement as WatermarkPlacement)
  ) {
    return {
      ok: false as const,
      issue: { message: "Choose a placement: center, diagonal-tiled or corner." },
    };
  }

  const pages = raw.pages;
  if (
    typeof pages !== "string" ||
    !WATERMARK_PAGE_MODES.includes(pages as WatermarkPageMode)
  ) {
    return { ok: false, issue: { message: "Choose which pages to stamp: all, first or last." } };
  }

  return {
    ok: true as const,
    options: {
      text: trimmed,
      opacityPercent: opacity as WatermarkOpacityPercent,
      rotationDegrees: rotation as WatermarkRotationDegrees,
      placement: placement as WatermarkPlacement,
      pages: pages as WatermarkPageMode,
    },
  };
}

/** 1-based page numbers the mode selects for a document of `pageCount` pages. */
export function resolveWatermarkPages(
  mode: WatermarkPageMode,
  pageCount: number,
): number[] {
  if (mode === "first") return [1];
  if (mode === "last") return [pageCount];
  return Array.from({ length: pageCount }, (_, index) => index + 1);
}
