import { describe, expect, it } from "vitest";
import {
  MAX_WATERMARK_TEXT_LENGTH,
  parseWatermarkOptions,
  resolveWatermarkPages,
  WATERMARK_OPACITIES,
  WATERMARK_PLACEMENTS,
  WATERMARK_ROTATIONS,
} from "@/lib/processing/watermark";

describe("watermark model", () => {
  it("offers exactly the documented option sets", () => {
    expect(WATERMARK_OPACITIES).toEqual([25, 50, 75]);
    expect(WATERMARK_ROTATIONS).toEqual([0, 45, -45]);
    expect(WATERMARK_PLACEMENTS).toEqual(["center", "diagonal-tiled", "corner"]);
    expect(MAX_WATERMARK_TEXT_LENGTH).toBe(200);
  });
});

describe("parseWatermarkOptions", () => {
  const valid = {
    text: "CONFIDENTIAL",
    opacity: "50",
    rotation: "45",
    placement: "center",
    pages: "all",
  };

  it("parses a complete, valid request", () => {
    expect(parseWatermarkOptions(valid)).toEqual({
      ok: true,
      options: {
        text: "CONFIDENTIAL",
        opacityPercent: 50,
        rotationDegrees: 45,
        placement: "center",
        pages: "all",
      },
    });
  });

  it("trims the text and accepts negative rotation strings", () => {
    expect(
      parseWatermarkOptions({ ...valid, text: "  DRAFT  ", rotation: "-45" }),
    ).toEqual({
      ok: true,
      options: expect.objectContaining({ text: "DRAFT", rotationDegrees: -45 }),
    });
  });

  it("rejects empty or whitespace-only text", () => {
    expect(parseWatermarkOptions({ ...valid, text: "" })).toHaveProperty("ok", false);
    expect(parseWatermarkOptions({ ...valid, text: "   " })).toHaveProperty("ok", false);
    expect(parseWatermarkOptions({ ...valid, text: undefined })).toHaveProperty("ok", false);
  });

  it(`rejects text above ${MAX_WATERMARK_TEXT_LENGTH} characters`, () => {
    const result = parseWatermarkOptions({
      ...valid,
      text: "x".repeat(MAX_WATERMARK_TEXT_LENGTH + 1),
    });
    expect(result).toHaveProperty("ok", false);
    expect(result.ok === false && result.issue.message).toContain("200 characters or fewer");
  });

  it("rejects values outside the documented sets — never repairs them", () => {
    for (const patch of [
      { opacity: "30" },
      { opacity: "high" },
      { opacity: undefined },
      { rotation: "90" },
      { rotation: 22.5 },
      { placement: "top" },
      { placement: undefined },
      { pages: "even" },
      { pages: 1 },
    ]) {
      expect(parseWatermarkOptions({ ...valid, ...patch })).toHaveProperty(
        "ok",
        false,
      );
    }
  });
});

describe("resolveWatermarkPages", () => {
  it("selects every page for all", () => {
    expect(resolveWatermarkPages("all", 4)).toEqual([1, 2, 3, 4]);
  });

  it("selects only page 1 or the final page", () => {
    expect(resolveWatermarkPages("first", 5)).toEqual([1]);
    expect(resolveWatermarkPages("last", 5)).toEqual([5]);
  });

  it("degrades to the same single page on one-page documents", () => {
    expect(resolveWatermarkPages("first", 1)).toEqual([1]);
    expect(resolveWatermarkPages("last", 1)).toEqual([1]);
  });
});
