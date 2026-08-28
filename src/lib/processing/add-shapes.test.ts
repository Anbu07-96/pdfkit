import { describe, expect, it } from "vitest";
import {
  parseAddShapesOptions,
  parseHexColor,
  resolveAddShapesPages,
} from "@/lib/processing/add-shapes";

describe("parseAddShapesOptions", () => {
  it("parses valid options for all shape types", () => {
    const rect = parseAddShapesOptions({
      shape: "rectangle",
      placement: "center",
      width: "150",
      height: "100",
      strokeWidth: "2",
      strokeColor: "#000000",
      fillColor: "#ff0000",
      pages: "all",
    });
    expect(rect.ok).toBe(true);
    if (rect.ok) {
      expect(rect.options).toEqual({
        shape: "rectangle",
        placement: "center",
        width: 150,
        height: 100,
        strokeWidth: 2,
        strokeColor: "#000000",
        fillColor: "#ff0000",
        pages: "all",
      });
    }

    const circle = parseAddShapesOptions({
      shape: "circle",
      placement: "top-left",
      width: "60",
      height: "60",
      strokeWidth: "1",
      strokeColor: "#00ff00",
      fillColor: "transparent",
      pages: "first",
    });
    expect(circle.ok).toBe(true);

    const line = parseAddShapesOptions({
      shape: "line",
      placement: "bottom-center",
      width: "200",
      height: "0",
      strokeWidth: "3",
      strokeColor: "#0000ff",
      fillColor: "none",
      pages: "last",
    });
    expect(line.ok).toBe(true);
  });

  it("rejects invalid shape type", () => {
    const res = parseAddShapesOptions({ shape: "triangle", placement: "center", pages: "all" });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.issue.message).toMatch(/rectangle, circle, ellipse or line/i);
    }
  });

  it("rejects invalid placement", () => {
    const res = parseAddShapesOptions({ shape: "rectangle", placement: "somewhere", pages: "all" });
    expect(res.ok).toBe(false);
  });

  it("rejects out-of-range width and height", () => {
    const res1 = parseAddShapesOptions({
      shape: "rectangle",
      placement: "center",
      width: "-10",
      pages: "all",
    });
    expect(res1.ok).toBe(false);

    const res2 = parseAddShapesOptions({
      shape: "rectangle",
      placement: "center",
      width: "2000",
      pages: "all",
    });
    expect(res2.ok).toBe(false);
  });

  it("rejects invalid hex colors", () => {
    const res = parseAddShapesOptions({
      shape: "rectangle",
      placement: "center",
      strokeColor: "red",
      pages: "all",
    });
    expect(res.ok).toBe(false);
  });

  it("rejects shapes with neither stroke nor fill", () => {
    const res = parseAddShapesOptions({
      shape: "rectangle",
      placement: "center",
      strokeColor: "none",
      fillColor: "transparent",
      pages: "all",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.issue.message).toMatch(/either a stroke or a fill/i);
    }
  });

  it("rejects lines with no stroke", () => {
    const res = parseAddShapesOptions({
      shape: "line",
      placement: "center",
      strokeColor: "transparent",
      fillColor: "#000000",
      pages: "all",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.issue.message).toMatch(/Lines must have a stroke color/i);
    }
  });
});

describe("parseHexColor", () => {
  it("converts hex strings to float RGB components", () => {
    expect(parseHexColor("#000000")).toEqual({ r: 0, g: 0, b: 0 });
    expect(parseHexColor("#ffffff")).toEqual({ r: 1, g: 1, b: 1 });
    expect(parseHexColor("#ff0000")).toEqual({ r: 1, g: 0, b: 0 });
  });

  it("returns null for none or transparent or invalid hex", () => {
    expect(parseHexColor("none")).toBeNull();
    expect(parseHexColor("transparent")).toBeNull();
    expect(parseHexColor("invalid")).toBeNull();
  });
});

describe("resolveAddShapesPages", () => {
  it("resolves page selection by mode", () => {
    expect(resolveAddShapesPages("all", 3)).toEqual([1, 2, 3]);
    expect(resolveAddShapesPages("first", 3)).toEqual([1]);
    expect(resolveAddShapesPages("last", 3)).toEqual([3]);
  });
});
