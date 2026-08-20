import { describe, expect, it } from "vitest";
import { normalizeQuery, searchTools, TOOLS } from "@/lib/tools";

function ids(query: string) {
  return searchTools(query).map((tool) => tool.id);
}

describe("searchTools", () => {
  it("returns the whole catalog for an empty query", () => {
    expect(searchTools("")).toHaveLength(TOOLS.length);
    expect(searchTools("   ")).toHaveLength(TOOLS.length);
  });

  it("matches on tool name", () => {
    expect(ids("merge")).toContain("merge-pdf");
    expect(ids("merge")[0]).toBe("merge-pdf");
    expect(ids("compress")).toContain("compress-pdf");
  });

  it("matches file formats used in names and keywords", () => {
    const jpg = ids("jpg");
    expect(jpg).toContain("jpg-to-pdf");
    expect(jpg).toContain("pdf-to-jpg");

    const word = ids("word");
    expect(word).toContain("word-to-pdf");
    expect(word).toContain("pdf-to-word");
  });

  it("matches on category", () => {
    const ocr = ids("ocr");
    expect(ocr).toContain("image-to-text");
    expect(ocr).toContain("ocr-document");

    const ai = ids("ai");
    expect(ai).toContain("summarize-pdf");
    expect(ai).toContain("ask-pdf");
  });

  it("matches on description text", () => {
    expect(ids("password")).toContain("password-protect");
  });

  it("is case and whitespace insensitive", () => {
    expect(ids("  MeRgE  ")).toContain("merge-pdf");
    expect(normalizeQuery("  Split   PDF ")).toBe("split pdf");
  });

  it("requires every term to match", () => {
    const results = ids("pdf excel");
    expect(results).toContain("pdf-to-excel");
    expect(results).not.toContain("merge-pdf");
  });

  it("returns nothing for a query with no matches", () => {
    expect(searchTools("definitely-not-a-tool")).toEqual([]);
  });

  it("can be scoped to a category and limited", () => {
    const results = searchTools("", { category: "security" });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((tool) => tool.category === "security")).toBe(true);

    expect(searchTools("pdf", { limit: 3 })).toHaveLength(3);
  });

  it("ranks exact name matches above partial matches", () => {
    const results = searchTools("split pdf");
    expect(results[0]?.id).toBe("split-pdf");
  });
});
