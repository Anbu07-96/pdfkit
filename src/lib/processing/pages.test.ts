import { describe, expect, it } from "vitest";
import {
  complementPageRanges,
  complementPages,
  countPagesInRanges,
  everyPageRanges,
  expandPageRange,
  expandPageRanges,
  formatPageRange,
  formatPageRanges,
  isPageSelectionMode,
  pagesToRanges,
  parseAndValidatePageRanges,
  parsePageRanges,
  resolvePageSelection,
  toZeroBasedIndices,
  validatePageRanges,
} from "@/lib/processing/pages";

function parsed(input: string) {
  const result = parsePageRanges(input);
  if (!result.ok) throw new Error(`expected "${input}" to parse: ${result.issue.message}`);
  return result.ranges;
}

function issueFor(input: string) {
  const result = parsePageRanges(input);
  if (result.ok) throw new Error(`expected "${input}" to be rejected`);
  return result.issue;
}

describe("parsePageRanges — valid input", () => {
  it("parses a single page", () => {
    expect(parsed("1")).toEqual([{ start: 1, end: 1 }]);
    expect(parsed("7")).toEqual([{ start: 7, end: 7 }]);
  });

  it("parses a span", () => {
    expect(parsed("1-3")).toEqual([{ start: 1, end: 3 }]);
    expect(parsed("3-5")).toEqual([{ start: 3, end: 5 }]);
  });

  it("accepts a single-page span", () => {
    expect(parsed("1-1")).toEqual([{ start: 1, end: 1 }]);
  });

  it("parses several comma-separated ranges in order", () => {
    expect(parsed("1-3,5,7-9")).toEqual([
      { start: 1, end: 3 },
      { start: 5, end: 5 },
      { start: 7, end: 9 },
    ]);
  });

  it("preserves the order the user typed, even when unsorted", () => {
    expect(parsed("7-9, 1-3")).toEqual([
      { start: 7, end: 9 },
      { start: 1, end: 3 },
    ]);
  });

  it("tolerates whitespace, newlines and semicolons", () => {
    expect(parsed("  1 - 3 ,  5 ")).toEqual([
      { start: 1, end: 3 },
      { start: 5, end: 5 },
    ]);
    expect(parsed("1-2\n4-5")).toEqual([
      { start: 1, end: 2 },
      { start: 4, end: 5 },
    ]);
    expect(parsed("1-2; 4")).toEqual([
      { start: 1, end: 2 },
      { start: 4, end: 4 },
    ]);
    expect(parsed("1-3,,5")).toEqual([
      { start: 1, end: 3 },
      { start: 5, end: 5 },
    ]);
  });

  it("handles large page numbers", () => {
    expect(parsed("999-1000")).toEqual([{ start: 999, end: 1000 }]);
  });
});

describe("parsePageRanges — invalid input", () => {
  it("rejects empty input", () => {
    expect(issueFor("").code).toBe("EMPTY");
    expect(issueFor("   ").code).toBe("EMPTY");
    expect(issueFor(",,").code).toBe("EMPTY");
  });

  it("rejects zero and negative pages", () => {
    expect(issueFor("0").code).toBe("ZERO_OR_NEGATIVE");
    expect(issueFor("0-3").code).toBe("ZERO_OR_NEGATIVE");
    // "-1" has no left endpoint, so it is a syntax problem.
    expect(issueFor("-1").code).toBe("SYNTAX");
    expect(issueFor("-3").code).toBe("SYNTAX");
  });

  it("rejects reversed ranges without silently flipping them", () => {
    const issue = issueFor("3-1");
    expect(issue.code).toBe("REVERSED");
    expect(issue.message).toMatch(/3-1/);
  });

  it("rejects incomplete ranges", () => {
    expect(issueFor("1-").code).toBe("SYNTAX");
    expect(issueFor("1--2").code).toBe("SYNTAX");
  });

  it("rejects non-numeric input", () => {
    expect(issueFor("abc").code).toBe("SYNTAX");
    expect(issueFor("1-a").code).toBe("SYNTAX");
    expect(issueFor("1.5").code).toBe("SYNTAX");
    expect(issueFor("1,abc").code).toBe("SYNTAX");
  });

  it("explains what valid syntax looks like", () => {
    expect(issueFor("abc").message).toMatch(/1-3/);
  });
});

describe("validatePageRanges", () => {
  it("accepts ranges inside the document", () => {
    expect(validatePageRanges(parsed("1-3, 5"), 10)).toBeNull();
    expect(validatePageRanges(parsed("10"), 10)).toBeNull();
  });

  it("rejects pages beyond the document length", () => {
    const issue = validatePageRanges(parsed("1-100"), 20);
    expect(issue?.code).toBe("OUT_OF_RANGE");
    expect(issue?.message).toContain("20 pages");
  });

  it("uses the singular form for a one-page document", () => {
    expect(validatePageRanges(parsed("2"), 1)?.message).toContain("1 page.");
  });

  it("rejects overlapping ranges by default", () => {
    const issue = validatePageRanges(parsed("1-5, 4-8"), 10);
    expect(issue?.code).toBe("OVERLAP");
    expect(issue?.message).toMatch(/page 4/);
  });

  it("rejects exact duplicates as overlaps", () => {
    expect(validatePageRanges(parsed("2-3, 2-3"), 10)?.code).toBe("OVERLAP");
    expect(validatePageRanges(parsed("4, 4"), 10)?.code).toBe("OVERLAP");
  });

  it("can allow overlaps when a tool needs them", () => {
    expect(validatePageRanges(parsed("1-5, 4-8"), 10, { allowOverlap: true })).toBeNull();
  });

  it("accepts adjacent ranges that do not overlap", () => {
    expect(validatePageRanges(parsed("1-3, 4-6, 7-10"), 10)).toBeNull();
  });

  it("rejects an empty selection", () => {
    expect(validatePageRanges([], 10)?.code).toBe("EMPTY");
  });
});

describe("parseAndValidatePageRanges", () => {
  it("returns ranges for valid input", () => {
    const result = parseAndValidatePageRanges("1-3, 4-7, 8-10", 10);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.ranges).toHaveLength(3);
  });

  it("reports the first problem found", () => {
    const result = parseAndValidatePageRanges("1-3, 99", 10);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issue.code).toBe("OUT_OF_RANGE");
  });
});

describe("page selection helpers", () => {
  it("builds one single-page range per page", () => {
    expect(everyPageRanges(3)).toEqual([
      { start: 1, end: 1 },
      { start: 2, end: 2 },
      { start: 3, end: 3 },
    ]);
    expect(everyPageRanges(0)).toEqual([]);
  });

  it("resolves a selection for each mode", () => {
    expect(resolvePageSelection("every-page", 2)).toEqual({
      mode: "every-page",
      ranges: [
        { start: 1, end: 1 },
        { start: 2, end: 2 },
      ],
    });
    expect(resolvePageSelection("ranges", 10, parsed("2-4"))).toEqual({
      mode: "ranges",
      ranges: [{ start: 2, end: 4 }],
    });
  });

  it("expands ranges to 1-based page numbers", () => {
    expect(expandPageRange({ start: 2, end: 4 })).toEqual([2, 3, 4]);
    expect(expandPageRanges(parsed("1-2, 5"))).toEqual([1, 2, 5]);
  });

  it("converts to 0-based indices exactly once", () => {
    // The critical off-by-one guard: user pages 1-3 are indices 0,1,2.
    expect(toZeroBasedIndices({ start: 1, end: 3 })).toEqual([0, 1, 2]);
    expect(toZeroBasedIndices(parsed("4-6"))).toEqual([3, 4, 5]);
    expect(toZeroBasedIndices(parsed("1, 10"))).toEqual([0, 9]);
  });

  it("counts pages covered by ranges", () => {
    expect(countPagesInRanges(parsed("1-3, 5, 7-9"))).toBe(7);
    expect(countPagesInRanges([])).toBe(0);
  });

  it("formats ranges the way users wrote them", () => {
    expect(formatPageRange({ start: 5, end: 5 })).toBe("5");
    expect(formatPageRange({ start: 1, end: 3 })).toBe("1-3");
    expect(formatPageRanges(parsed("1-3,5"))).toBe("1-3, 5");
  });

  it("recognises the supported modes", () => {
    expect(isPageSelectionMode("every-page")).toBe(true);
    expect(isPageSelectionMode("ranges")).toBe(true);
    expect(isPageSelectionMode("everything")).toBe(false);
    expect(isPageSelectionMode(undefined)).toBe(false);
  });
});

describe("pagesToRanges", () => {
  it("collapses consecutive pages into ranges", () => {
    expect(pagesToRanges([1, 2, 3, 5])).toEqual([
      { start: 1, end: 3 },
      { start: 5, end: 5 },
    ]);
  });

  it("keeps isolated pages separate", () => {
    expect(pagesToRanges([1, 3, 5])).toEqual([
      { start: 1, end: 1 },
      { start: 3, end: 3 },
      { start: 5, end: 5 },
    ]);
  });

  it("handles an empty list", () => {
    expect(pagesToRanges([])).toEqual([]);
  });
});

describe("complementPages", () => {
  it("returns the pages that are not selected", () => {
    expect(complementPages(parsed("2"), 5)).toEqual([1, 3, 4, 5]);
    expect(complementPages(parsed("2, 4"), 5)).toEqual([1, 3, 5]);
    expect(complementPages(parsed("1, 5"), 5)).toEqual([2, 3, 4]);
  });

  it("handles ranges", () => {
    expect(complementPages(parsed("3-7"), 10)).toEqual([1, 2, 8, 9, 10]);
    expect(complementPages(parsed("1-2, 8-10"), 10)).toEqual([3, 4, 5, 6, 7]);
  });

  it("always returns ascending document order, whatever order was selected", () => {
    // The pages that remain keep their original order — unlike a selection.
    expect(complementPages(parsed("8-10, 1-2"), 10)).toEqual([3, 4, 5, 6, 7]);
    expect(complementPages(parsed("5, 2"), 6)).toEqual([1, 3, 4, 6]);
  });

  it("removes the first and last pages correctly", () => {
    expect(complementPages(parsed("1"), 5)).toEqual([2, 3, 4, 5]);
    expect(complementPages(parsed("5"), 5)).toEqual([1, 2, 3, 4]);
  });

  it("returns nothing when every page is selected", () => {
    expect(complementPages(parsed("1-5"), 5)).toEqual([]);
    expect(complementPages(parsed("1, 2, 3"), 3)).toEqual([]);
  });

  it("returns every page when nothing is selected", () => {
    expect(complementPages([], 3)).toEqual([1, 2, 3]);
  });

  it("ignores selected pages outside the document", () => {
    expect(complementPages(parsed("9-12"), 3)).toEqual([1, 2, 3]);
  });

  it("guards against a nonsensical page count", () => {
    expect(complementPages(parsed("1"), 0)).toEqual([]);
    expect(complementPages(parsed("1"), -4)).toEqual([]);
  });
});

describe("complementPageRanges", () => {
  it("expresses the complement as ascending ranges", () => {
    expect(complementPageRanges(parsed("3-7"), 10)).toEqual([
      { start: 1, end: 2 },
      { start: 8, end: 10 },
    ]);
    expect(complementPageRanges(parsed("2, 4"), 5)).toEqual([
      { start: 1, end: 1 },
      { start: 3, end: 3 },
      { start: 5, end: 5 },
    ]);
  });

  it("round-trips through the 0-based conversion", () => {
    // Deleting page 2 of 5 keeps pages 1,3,4,5 → indices 0,2,3,4.
    expect(toZeroBasedIndices(complementPageRanges(parsed("2"), 5))).toEqual([
      0, 2, 3, 4,
    ]);
  });
});
