import {
  everyPageRanges,
  parseAndValidatePageRanges,
  type PageRange,
} from "@/lib/processing/pages";

export interface RedactArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RedactOptions {
  pages?: string;
  areas?: RedactArea[];
  fillColor?: string;
}

export interface ParsedRedactOptions {
  ranges: PageRange[];
  areas: RedactArea[];
  fillColor: string;
}

export function parseRedactOptions(
  raw: Record<string, unknown> | undefined,
  pageCount: number,
): ParsedRedactOptions {
  const pagesRaw = typeof raw?.pages === "string" ? raw.pages.trim() : "all";
  let ranges: PageRange[] = [];

  if (pagesRaw === "all") {
    ranges = everyPageRanges(pageCount);
  } else {
    const res = parseAndValidatePageRanges(pagesRaw, pageCount);
    ranges = res.ok ? res.ranges : everyPageRanges(pageCount);
  }

  let areas: RedactArea[] = [];
  if (Array.isArray(raw?.areas)) {
    areas = raw.areas
      .map((item: Record<string, unknown>) => ({
        x: Number(item?.x) || 0,
        y: Number(item?.y) || 0,
        width: Math.max(1, Number(item?.width) || 100),
        height: Math.max(1, Number(item?.height) || 30),
      }))
      .filter((a) => a.width > 0 && a.height > 0);
  }

  if (areas.length === 0) {
    areas = [{ x: 50, y: 50, width: 200, height: 40 }];
  }

  const fillColor =
    typeof raw?.fillColor === "string" && /^#[0-9A-Fa-f]{6}$/.test(raw.fillColor)
      ? raw.fillColor
      : "#000000";

  return { ranges, areas, fillColor };
}
