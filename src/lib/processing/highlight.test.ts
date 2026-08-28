import { describe, expect, it } from "vitest";
import {
  parseHighlightOptions,
  resolveHighlightPages,
} from "@/lib/processing/highlight";

describe("parseHighlightOptions", () => {
  it("parses valid options", () => {
    const res = parseHighlightOptions({
      placement: "top-left",
      width: "250",
      height: "30",
      color: "#bbf7d0",
      opacity: "0.4",
      pages: "all",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.options).toEqual({
        placement: "top-left",
        width: 250,
        height: 30,
        color: "#bbf7d0",
        opacity: 0.4,
        pages: "all",
      });
    }
  });

  it("rejects invalid placement", () => {
    const res = parseHighlightOptions({ placement: "unknown", pages: "all" });
    expect(res.ok).toBe(false);
  });

  it("rejects invalid opacity", () => {
    const res = parseHighlightOptions({ placement: "center", opacity: "2.0", pages: "all" });
    expect(res.ok).toBe(false);
  });
});

describe("resolveHighlightPages", () => {
  it("resolves pages based on mode", () => {
    expect(resolveHighlightPages("all", 2)).toEqual([1, 2]);
    expect(resolveHighlightPages("first", 2)).toEqual([1]);
    expect(resolveHighlightPages("last", 2)).toEqual([2]);
  });
});
