import { describe, expect, it } from "vitest";
import {
  parsePdfToTextOptions,
  resolvePdfToTextPages,
} from "@/lib/processing/pdf-to-text";

describe("parsePdfToTextOptions", () => {
  it("parses valid options", () => {
    const res = parsePdfToTextOptions({ pages: "all" });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.options.pages).toBe("all");
    }
  });

  it("rejects invalid page mode", () => {
    const res = parsePdfToTextOptions({ pages: "invalid" });
    expect(res.ok).toBe(false);
  });
});

describe("resolvePdfToTextPages", () => {
  it("resolves target pages", () => {
    expect(resolvePdfToTextPages("all", 3)).toEqual([1, 2, 3]);
    expect(resolvePdfToTextPages("first", 3)).toEqual([1]);
    expect(resolvePdfToTextPages("last", 3)).toEqual([3]);
  });
});
