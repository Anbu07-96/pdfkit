import { describe, expect, it } from "vitest";
import {
  getCategoriesWithTools,
  getPopularTools,
  getTool,
  getToolsByCategory,
  isToolUsable,
  POPULAR_TOOL_IDS,
  TOOL_CATEGORIES,
  TOOLS,
} from "@/lib/tools";

describe("tool catalog", () => {
  it("has unique tool ids", () => {
    const ids = TOOLS.map((tool) => tool.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("derives every route from the tool id", () => {
    for (const tool of TOOLS) {
      expect(tool.route).toBe(`/tools/${tool.id}`);
    }
  });

  it("assigns every tool to a known category", () => {
    const categoryIds = new Set(TOOL_CATEGORIES.map((category) => category.id));
    for (const tool of TOOLS) {
      expect(categoryIds.has(tool.category)).toBe(true);
    }
  });

  it("gives every tool a name, description, icon and file types", () => {
    for (const tool of TOOLS) {
      expect(tool.name.length).toBeGreaterThan(0);
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.icon.length).toBeGreaterThan(0);
      expect(tool.supportedFileTypes.length).toBeGreaterThan(0);
      expect(tool.acceptedMimeTypes.length).toBeGreaterThan(0);
      expect(tool.howItWorks.length).toBeGreaterThan(0);
      for (const extension of tool.supportedFileTypes) {
        expect(extension.startsWith(".")).toBe(true);
        expect(extension).toBe(extension.toLowerCase());
      }
    }
  });

  it("only marks genuinely implemented tools as usable", () => {
    // Merge PDF (Phase 2) and Split PDF (Phase 3) are implemented; everything
    // else must still say so. `registry.test.ts` asserts catalog/registry parity.
    const implemented = ["merge-pdf", "split-pdf"];

    for (const tool of TOOLS) {
      if (implemented.includes(tool.id)) {
        expect(tool.status).toBe("AVAILABLE");
        expect(isToolUsable(tool)).toBe(true);
      } else {
        expect(tool.status).toBe("COMING_SOON");
        expect(isToolUsable(tool)).toBe(false);
      }
    }
  });

  it("resolves popular tools from the catalog", () => {
    const popular = getPopularTools();
    expect(popular).toHaveLength(POPULAR_TOOL_IDS.length);
    expect(popular.map((tool) => tool.id)).toEqual([...POPULAR_TOOL_IDS]);
  });

  it("includes the required category structure", () => {
    expect(TOOL_CATEGORIES.map((category) => category.id)).toEqual([
      "organize",
      "convert",
      "edit",
      "security",
      "ocr",
      "ai",
    ]);

    for (const category of TOOL_CATEGORIES) {
      expect(category.route).toBe(`/categories/${category.id}`);
      expect(getToolsByCategory(category.id).length).toBeGreaterThan(0);
    }
  });

  it("exposes every tool through exactly one category listing", () => {
    const listed = getCategoriesWithTools().flatMap((entry) => entry.tools);
    expect(listed).toHaveLength(TOOLS.length);
  });

  it("looks up tools by id", () => {
    expect(getTool("merge-pdf")?.name).toBe("Merge PDF");
    expect(getTool("does-not-exist")).toBeUndefined();
  });
});
