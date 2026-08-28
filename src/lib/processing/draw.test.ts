import { describe, expect, it } from "vitest";
import {
  getPresetPoints,
  parseDrawOptions,
  resolveDrawPages,
} from "@/lib/processing/draw";

describe("parseDrawOptions", () => {
  it("parses valid options", () => {
    const res = parseDrawOptions({
      preset: "checkmark",
      placement: "bottom-right",
      width: "120",
      height: "80",
      strokeWidth: "4",
      strokeColor: "#dc2626",
      pages: "all",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.options).toEqual({
        preset: "checkmark",
        placement: "bottom-right",
        width: 120,
        height: 80,
        strokeWidth: 4,
        strokeColor: "#dc2626",
        pages: "all",
      });
    }
  });

  it("rejects invalid preset", () => {
    const res = parseDrawOptions({ preset: "scribble", pages: "all" });
    expect(res.ok).toBe(false);
  });

  it("rejects invalid stroke width", () => {
    const res = parseDrawOptions({ preset: "checkmark", placement: "center", strokeWidth: "0", pages: "all" });
    expect(res.ok).toBe(false);
  });
});

describe("getPresetPoints", () => {
  it("returns path point arrays for presets", () => {
    expect(getPresetPoints("checkmark")).toHaveLength(1);
    expect(getPresetPoints("cross")).toHaveLength(2); // two strokes
    expect(getPresetPoints("wave")[0].length).toBeGreaterThan(5);
  });
});

describe("resolveDrawPages", () => {
  it("resolves page modes", () => {
    expect(resolveDrawPages("all", 3)).toEqual([1, 2, 3]);
    expect(resolveDrawPages("first", 3)).toEqual([1]);
    expect(resolveDrawPages("last", 3)).toEqual([3]);
  });
});
