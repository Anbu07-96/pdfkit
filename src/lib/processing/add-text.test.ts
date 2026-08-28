import { describe, expect, it } from "vitest";
import {
  ADD_TEXT_FONT_SIZES,
  ADD_TEXT_PLACEMENTS,
  MAX_ADD_TEXT_LENGTH,
  MAX_ADD_TEXT_LINES,
  parseAddTextOptions,
  resolveAddTextPages,
} from "@/lib/processing/add-text";

const VALID = {
  text: "Fragile — handle with care",
  placement: "top-left",
  size: "16",
  pages: "all",
};

describe("parseAddTextOptions", () => {
  it("accepts a fully specified request", () => {
    const result = parseAddTextOptions(VALID);
    expect(result).toEqual({
      ok: true,
      options: {
        text: "Fragile — handle with care",
        lines: ["Fragile — handle with care"],
        placement: "top-left",
        fontSize: 16,
        pages: "all",
      },
    });
  });

  it("keeps multi-line text as lines and trims the surround", () => {
    const result = parseAddTextOptions({
      ...VALID,
      text: "  First line\r\n\r\nThird line  ",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.options.lines).toEqual(["First line", "", "Third line"]);
      expect(result.options.text).toBe("First line\n\nThird line");
    }
  });

  it("rejects empty or missing text", () => {
    const cases: Record<string, unknown>[] = [
      { placement: "top-left", size: "16", pages: "all" }, // no text field
      { ...VALID, text: "" },
      { ...VALID, text: "   \n  " },
      { ...VALID, text: undefined },
    ];
    for (const raw of cases) {
      const result = parseAddTextOptions(raw);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issue.message).toMatch(/enter the text/i);
      }
    }
  });

  it("rejects text that is too long", () => {
    const result = parseAddTextOptions({
      ...VALID,
      text: "x".repeat(MAX_ADD_TEXT_LENGTH + 1),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issue.message).toContain(String(MAX_ADD_TEXT_LENGTH));
    }
  });

  it("rejects too many lines", () => {
    const result = parseAddTextOptions({
      ...VALID,
      text: Array.from({ length: MAX_ADD_TEXT_LINES + 1 }, () => "line").join("\n"),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issue.message).toContain(String(MAX_ADD_TEXT_LINES));
    }
  });

  it("rejects an unknown placement", () => {
    for (const placement of ["", "middle", "TOP-LEFT", "top_left"]) {
      const result = parseAddTextOptions({ ...VALID, placement });
      expect(result.ok).toBe(false);
    }
  });

  it("accepts every documented placement", () => {
    for (const placement of ADD_TEXT_PLACEMENTS) {
      expect(parseAddTextOptions({ ...VALID, placement }).ok).toBe(true);
    }
  });

  it("rejects an unknown font size", () => {
    for (const size of ["", "13", "huge", "16.5", "-12"]) {
      const result = parseAddTextOptions({ ...VALID, size });
      expect(result.ok).toBe(false);
    }
  });

  it("accepts every documented font size", () => {
    for (const size of ADD_TEXT_FONT_SIZES) {
      expect(parseAddTextOptions({ ...VALID, size: String(size) }).ok).toBe(true);
    }
  });

  it("rejects an unknown page mode", () => {
    for (const pages of ["", "even", "1-3"]) {
      const result = parseAddTextOptions({ ...VALID, pages });
      expect(result.ok).toBe(false);
    }
  });
});

describe("resolveAddTextPages", () => {
  it("maps the modes onto 1-based page numbers", () => {
    expect(resolveAddTextPages("all", 3)).toEqual([1, 2, 3]);
    expect(resolveAddTextPages("all", 1)).toEqual([1]);
    expect(resolveAddTextPages("first", 3)).toEqual([1]);
    expect(resolveAddTextPages("last", 3)).toEqual([3]);
  });
});
