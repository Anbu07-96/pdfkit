import { describe, expect, it } from "vitest";
import {
  MAX_FONT_SIZE,
  MAX_START_NUMBER,
  MIN_FONT_SIZE,
  MIN_START_NUMBER,
  pageNumberOf,
  parsePageNumberOptions,
  resolveNumberedPages,
  PAGE_NUMBER_FORMATS,
  PAGE_NUMBER_POSITIONS,
} from "@/lib/processing/page-numbers";

describe("page-number model", () => {
  it("offers exactly the documented option sets", () => {
    expect(PAGE_NUMBER_POSITIONS).toEqual([
      "bottom-left",
      "bottom-center",
      "bottom-right",
    ]);
    expect(PAGE_NUMBER_FORMATS).toEqual(["number", "page", "page-of"]);
    expect(MIN_START_NUMBER).toBe(1);
    expect(MAX_START_NUMBER).toBe(9999);
    expect(MIN_FONT_SIZE).toBe(8);
    expect(MAX_FONT_SIZE).toBe(24);
  });
});

describe("parsePageNumberOptions", () => {
  const valid = {
    position: "bottom-center",
    start: "1",
    size: "11",
    format: "page-of",
    pages: "all",
  };

  it("parses a complete, valid request", () => {
    expect(parsePageNumberOptions(valid)).toEqual({
      ok: true,
      options: {
        position: "bottom-center",
        start: 1,
        fontSize: 11,
        format: "page-of",
        pages: "all",
      },
    });
  });

  it("never repairs invalid values", () => {
    for (const patch of [
      { position: "top-center" },
      { position: undefined },
      { position: 4 },
      { start: "0" },
      { start: "10000" },
      { start: "1.5" },
      { start: "one" },
      { start: undefined },
      { size: "7" },
      { size: "25" },
      { size: "10.5" },
      { size: undefined },
      { format: "roman" },
      { format: undefined },
      { pages: "even" },
      { pages: undefined },
    ]) {
      expect(parsePageNumberOptions({ ...valid, ...patch })).toHaveProperty(
        "ok",
        false,
      );
    }
  });

  it("accepts the full documented ranges", () => {
    expect(
      parsePageNumberOptions({ ...valid, start: "9999", size: "24" }),
    ).toHaveProperty("ok", true);
    expect(
      parsePageNumberOptions({ ...valid, start: "1", size: "8" }),
    ).toHaveProperty("ok", true);
  });
});

describe("resolveNumberedPages", () => {
  it("selects every page for all", () => {
    expect(resolveNumberedPages("all", 3)).toEqual([1, 2, 3]);
  });

  it("selects only the first or final page", () => {
    expect(resolveNumberedPages("first", 5)).toEqual([1]);
    expect(resolveNumberedPages("last", 5)).toEqual([5]);
  });
});

describe("pageNumberOf", () => {
  it("renders all three formats", () => {
    const base = { start: 1, format: "number" as const };
    expect(pageNumberOf(3, 10, base)).toBe("3");
    expect(pageNumberOf(3, 10, { ...base, format: "page" })).toBe("Page 3");
    expect(pageNumberOf(3, 10, { ...base, format: "page-of" })).toBe(
      "Page 3 of 10",
    );
  });

  it("shifts the printed number by the start offset, keeping the real total", () => {
    const shifted = { start: 5, format: "page-of" as const };
    expect(pageNumberOf(1, 10, shifted)).toBe("Page 5 of 10");
    expect(pageNumberOf(6, 10, shifted)).toBe("Page 10 of 10");
    // A start above 1 can push the printed X past the real total — honest,
    // documented front-matter behaviour, never silently clamped.
    expect(pageNumberOf(10, 10, shifted)).toBe("Page 14 of 10");
  });
});
