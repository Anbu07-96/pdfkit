import { describe, expect, it } from "vitest";
import {
  parseAnnotationsOptions,
  resolveAnnotationPages,
} from "@/lib/processing/annotations";

describe("parseAnnotationsOptions", () => {
  it("parses valid comment annotation options", () => {
    const res = parseAnnotationsOptions({
      type: "comment",
      placement: "top-left",
      text: "Please update this sentence.",
      author: "Reviewer A",
      width: "30",
      height: "30",
      pages: "all",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.options).toEqual({
        type: "comment",
        placement: "top-left",
        text: "Please update this sentence.",
        author: "Reviewer A",
        url: "",
        width: 30,
        height: 30,
        pages: "all",
      });
    }
  });

  it("parses valid link annotation options", () => {
    const res = parseAnnotationsOptions({
      type: "link",
      placement: "center",
      url: "https://pdfkit.app/docs",
      width: "150",
      height: "30",
      pages: "first",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.options.url).toBe("https://pdfkit.app/docs");
    }
  });

  it("rejects invalid type", () => {
    const res = parseAnnotationsOptions({ type: "unknown", pages: "all" });
    expect(res.ok).toBe(false);
  });

  it("rejects empty comment text", () => {
    const res = parseAnnotationsOptions({
      type: "comment",
      placement: "center",
      text: "   ",
      pages: "all",
    });
    expect(res.ok).toBe(false);
  });

  it("rejects invalid or non-HTTP URL for link", () => {
    const res = parseAnnotationsOptions({
      type: "link",
      placement: "center",
      url: "ftp://example.com",
      pages: "all",
    });
    expect(res.ok).toBe(false);
  });
});

describe("resolveAnnotationPages", () => {
  it("resolves target pages by mode", () => {
    expect(resolveAnnotationPages("all", 3)).toEqual([1, 2, 3]);
    expect(resolveAnnotationPages("first", 3)).toEqual([1]);
    expect(resolveAnnotationPages("last", 3)).toEqual([3]);
  });
});
