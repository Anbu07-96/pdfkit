import { describe, expect, it } from "vitest";
import {
  parseExtractImagesOptions,
  resolveExtractImagesPages,
} from "@/lib/processing/extract-images";

describe("parseExtractImagesOptions", () => {
  it("parses valid options", () => {
    const res = parseExtractImagesOptions({ pages: "all" });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.options.pages).toBe("all");
    }
  });

  it("rejects invalid page mode", () => {
    const res = parseExtractImagesOptions({ pages: "invalid" });
    expect(res.ok).toBe(false);
  });
});

describe("resolveExtractImagesPages", () => {
  it("resolves target pages", () => {
    expect(resolveExtractImagesPages("all", 3)).toEqual([1, 2, 3]);
    expect(resolveExtractImagesPages("first", 3)).toEqual([1]);
    expect(resolveExtractImagesPages("last", 3)).toEqual([3]);
  });
});
