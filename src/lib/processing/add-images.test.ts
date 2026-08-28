import { describe, expect, it } from "vitest";
import {
  parseAddImagesOptions,
  resolveAddImagesPages,
} from "@/lib/processing/add-images";

describe("parseAddImagesOptions", () => {
  it("parses valid options", () => {
    const res = parseAddImagesOptions({
      placement: "center",
      width: "200",
      height: "100",
      preserveAspectRatio: "true",
      pages: "all",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.options).toEqual({
        placement: "center",
        width: 200,
        height: 100,
        preserveAspectRatio: true,
        pages: "all",
      });
    }
  });

  it("rejects invalid placement", () => {
    const res = parseAddImagesOptions({ placement: "nowhere", pages: "all" });
    expect(res.ok).toBe(false);
  });

  it("rejects invalid width or height", () => {
    const res = parseAddImagesOptions({ placement: "center", width: "0", pages: "all" });
    expect(res.ok).toBe(false);
  });
});

describe("resolveAddImagesPages", () => {
  it("resolves pages based on mode", () => {
    expect(resolveAddImagesPages("all", 3)).toEqual([1, 2, 3]);
    expect(resolveAddImagesPages("first", 3)).toEqual([1]);
    expect(resolveAddImagesPages("last", 3)).toEqual([3]);
  });
});
