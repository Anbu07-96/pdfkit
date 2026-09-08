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
    expect(jpg).toContain("images-to-pdf"); // renamed from jpg-to-pdf in Phase 8
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

/* ------------------------------------------------------------------ */
/* Bulk operation search (Phase 62)                                    */
/* ------------------------------------------------------------------ */

import { searchBulkOperations } from "./search";

describe("searchBulkOperations", () => {
  it("finds bulk operations by their name terms", () => {
    const results = searchBulkOperations("bulk pdf word");
    expect(results.map((operation) => operation.id)).toContain("pdf-to-word");
  });

  it("answers to batch phrasing", () => {
    expect(searchBulkOperations("batch pdf to word").map((o) => o.id)).toContain(
      "pdf-to-word",
    );
  });

  it("answers to multiple/mass phrasing", () => {
    const results = searchBulkOperations("multiple pdfs");
    expect(results.length).toBeGreaterThan(0);
  });

  it("finds bulk image extraction by concept", () => {
    const results = searchBulkOperations("bulk image extraction");
    expect(results.map((operation) => operation.id)).toContain("extract-images");
  });

  it("keeps every bulk operation discoverable through the fixed terms", () => {
    for (const operation of searchBulkOperations("bulk")) {
      expect(operation.route).toMatch(/^\/bulk\//);
    }
    // "bulk" alone matches all seven operations.
    expect(searchBulkOperations("bulk")).toHaveLength(7);
  });

  it("uses AND semantics across terms like the tool search", () => {
    // "word" narrows to the Word-related bulk operation only.
    const results = searchBulkOperations("bulk word");
    expect(results.map((operation) => operation.id)).toEqual(["pdf-to-word"]);
  });

  it("returns nothing for unrelated terms", () => {
    expect(searchBulkOperations("unicorn")).toEqual([]);
  });

  it("respects the limit", () => {
    expect(searchBulkOperations("bulk", { limit: 2 })).toHaveLength(2);
  });

  it("returns all operations for an empty query", () => {
    expect(searchBulkOperations("")).toHaveLength(7);
  });

  it("does not pollute the single-file tool search", () => {
    // The catalog search keeps its own results; bulk lives in its own function.
    const tools = searchTools("bulk pdf word");
    expect(tools.every((tool: { route: string }) => tool.route.startsWith("/tools/"))).toBe(
      true,
    );
  });
});
