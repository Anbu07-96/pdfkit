import { describe, expect, it } from "vitest";
import {
  CROP_MODES,
  cropRectangleForPage,
  MIN_CROP_SIDE_PT,
  parseCropOptions,
} from "@/lib/processing/crop";

describe("crop model", () => {
  it("offers exactly the two documented modes", () => {
    expect(CROP_MODES).toEqual(["rectangle", "margins"]);
    expect(MIN_CROP_SIDE_PT).toBe(10);
  });
});

describe("parseCropOptions", () => {
  const rect = { mode: "rectangle", x: "10", y: "20", width: "200", height: "300" };
  const margins = { mode: "margins", top: "10", right: "20", bottom: "5", left: "15" };

  it("parses a valid rectangle", () => {
    expect(parseCropOptions(rect)).toEqual({
      ok: true,
      options: {
        mode: "rectangle",
        rectangle: { x: 10, y: 20, width: 200, height: 300 },
      },
    });
  });

  it("parses valid margins, including fractional values", () => {
    expect(parseCropOptions(margins)).toEqual({
      ok: true,
      options: {
        mode: "margins",
        margins: { top: 10, right: 20, bottom: 5, left: 15 },
      },
    });
    expect(
      parseCropOptions({ ...margins, top: "12.5", left: "0.25" }),
    ).toHaveProperty("ok", true);
  });

  it("accepts zero margins", () => {
    const allZero = { mode: "margins", top: "0", right: "0", bottom: "0", left: "0" };
    expect(parseCropOptions(allZero)).toHaveProperty("ok", true);
  });

  it("rejects an unsupported mode", () => {
    expect(parseCropOptions({ ...rect, mode: "circle" })).toHaveProperty("ok", false);
    expect(parseCropOptions({ mode: undefined })).toHaveProperty("ok", false);
  });

  it("rejects non-finite and malformed numbers", () => {
    for (const patch of [
      { x: "NaN" },
      { y: "Infinity" },
      { width: "-Infinity" },
      { height: "abc" },
      { x: "" },
      { y: undefined },
      { width: " " },
    ]) {
      expect(
        parseCropOptions({ ...rect, ...patch }),
        JSON.stringify(patch),
      ).toHaveProperty("ok", false);
    }
    for (const patch of [{ top: "NaN" }, { right: "Infinity" }, { bottom: "x" }, { left: "" }]) {
      expect(parseCropOptions({ ...margins, ...patch })).toHaveProperty("ok", false);
    }
  });

  it("rejects negative rectangle origins and below-minimum sides", () => {
    expect(parseCropOptions({ ...rect, x: "-1" })).toHaveProperty("ok", false);
    expect(parseCropOptions({ ...rect, y: "-0.5" })).toHaveProperty("ok", false);
    expect(parseCropOptions({ ...rect, width: "0" })).toHaveProperty("ok", false);
    expect(parseCropOptions({ ...rect, height: "9.99" })).toHaveProperty("ok", false);
    expect(parseCropOptions({ ...rect, width: "-200" })).toHaveProperty("ok", false);
    expect(parseCropOptions({ ...rect, width: "10" })).toHaveProperty("ok", true);
  });

  it("rejects negative margins", () => {
    expect(parseCropOptions({ ...margins, top: "-1" })).toHaveProperty("ok", false);
    expect(parseCropOptions({ ...margins, left: "-0.01" })).toHaveProperty("ok", false);
  });
});

describe("cropRectangleForPage", () => {
  it("returns the rectangle as-is when it fits the MediaBox", () => {
    const options = {
      mode: "rectangle" as const,
      rectangle: { x: 10, y: 20, width: 200, height: 300 },
    };
    expect(cropRectangleForPage(options, { width: 612, height: 792 })).toEqual({
      rectangle: { x: 10, y: 20, width: 200, height: 300 },
    });
  });

  it("accepts a rectangle that exactly meets the MediaBox edges", () => {
    const options = {
      mode: "rectangle" as const,
      rectangle: { x: 0, y: 0, width: 612, height: 792 },
    };
    expect(cropRectangleForPage(options, { width: 612, height: 792 })).toHaveProperty(
      "rectangle",
    );
  });

  it("rejects a rectangle that overflows the MediaBox — never clamps", () => {
    const options = {
      mode: "rectangle" as const,
      rectangle: { x: 100, y: 100, width: 600, height: 500 },
    };
    const result = cropRectangleForPage(options, { width: 612, height: 792 });
    expect(result).toHaveProperty("issue");
    if ("issue" in result) {
      expect(result.issue.message).toContain("does not fit");
      expect(result.issue.message).toContain("margins mode");
    }
  });

  it("computes margins per page — heterogeneous sizes all work", () => {
    const options = {
      mode: "margins" as const,
      margins: { top: 20, right: 10, bottom: 5, left: 15 },
    };
    expect(cropRectangleForPage(options, { width: 612, height: 792 })).toEqual({
      rectangle: { x: 15, y: 5, width: 587, height: 767 },
    });
    expect(cropRectangleForPage(options, { width: 300, height: 200 })).toEqual({
      rectangle: { x: 15, y: 5, width: 275, height: 175 },
    });
  });

  it("rejects margins that leave less than the minimum crop side", () => {
    const options = {
      mode: "margins" as const,
      margins: { top: 100, right: 0, bottom: 100, left: 0 },
    };
    const result = cropRectangleForPage(options, { width: 200, height: 200 });
    expect(result).toHaveProperty("issue");
    if ("issue" in result) {
      expect(result.issue.message).toContain("at least 10");
    }
  });
});
