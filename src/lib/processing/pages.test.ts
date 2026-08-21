import { describe, expect, it } from "vitest";
import {
  addRotations,
  compactRotations,
  complementPageRanges,
  formatPageRotations,
  formatRotation,
  hasRotations,
  isPageRotation,
  parseAndValidatePageRotations,
  parsePageRotations,
  rotateClockwise,
  rotateCounterClockwise,
  validatePageRotations,
  formatPageOrder,
  identityPageOrder,
  isIdentityPageOrder,
  movePageInOrder,
  parseAndValidatePageOrder,
  parsePageOrder,
  validatePageOrder,
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

/* -------------------------------------------------------------------------- */
/* Page order (Phase 5)                                                       */
/* -------------------------------------------------------------------------- */

function order(input: string) {
  const result = parsePageOrder(input);
  if (!result.ok) throw new Error(`expected "${input}" to parse: ${result.issue.message}`);
  return result.order;
}

describe("identityPageOrder", () => {
  it("lists the document's own order", () => {
    expect(identityPageOrder(3)).toEqual([1, 2, 3]);
    expect(identityPageOrder(1)).toEqual([1]);
  });

  it("returns nothing for a nonsensical page count", () => {
    expect(identityPageOrder(0)).toEqual([]);
    expect(identityPageOrder(-2)).toEqual([]);
  });

  it("recognises an unchanged order", () => {
    expect(isIdentityPageOrder([1, 2, 3])).toBe(true);
    expect(isIdentityPageOrder([1, 3, 2])).toBe(false);
    expect(isIdentityPageOrder([])).toBe(true);
  });
});

describe("parsePageOrder", () => {
  it("parses a comma-separated order", () => {
    expect(order("5,3,1,2,4")).toEqual([5, 3, 1, 2, 4]);
    expect(order(" 2 , 1 ")).toEqual([2, 1]);
    expect(order("3 1 2")).toEqual([3, 1, 2]);
  });

  it("rejects empty and whitespace-only input", () => {
    expect(parsePageOrder("")).toMatchObject({ ok: false, issue: { code: "EMPTY" } });
    expect(parsePageOrder("   ")).toMatchObject({ ok: false, issue: { code: "EMPTY" } });
  });

  it("rejects non-numeric, decimal and negative values", () => {
    expect(parsePageOrder("abc")).toMatchObject({ ok: false, issue: { code: "SYNTAX" } });
    expect(parsePageOrder("1,2,x")).toMatchObject({ ok: false, issue: { code: "SYNTAX" } });
    expect(parsePageOrder("1.5,2")).toMatchObject({ ok: false, issue: { code: "SYNTAX" } });
    expect(parsePageOrder("-1,2")).toMatchObject({ ok: false, issue: { code: "SYNTAX" } });
    expect(parsePageOrder("1-3")).toMatchObject({ ok: false, issue: { code: "SYNTAX" } });
  });

  it("rejects zero", () => {
    expect(parsePageOrder("0,1")).toMatchObject({
      ok: false,
      issue: { code: "OUT_OF_RANGE" },
    });
  });
});

describe("validatePageOrder", () => {
  it("accepts complete permutations", () => {
    expect(validatePageOrder([1, 2, 3, 4, 5], 5)).toBeNull();
    expect(validatePageOrder([5, 4, 3, 2, 1], 5)).toBeNull();
    expect(validatePageOrder([3, 1, 5, 2, 4], 5)).toBeNull();
    expect(validatePageOrder([1], 1)).toBeNull();
    expect(validatePageOrder([2, 1], 2)).toBeNull();
  });

  it("rejects a missing page", () => {
    const issue = validatePageOrder([1, 2, 3, 4], 5);
    expect(issue?.code).toBe("MISSING");
    expect(issue?.message).toContain("5");
  });

  it("lists several missing pages", () => {
    expect(validatePageOrder([1, 2], 5)?.message).toMatch(/Pages 3, 4, 5 are missing/);
  });

  it("rejects duplicates", () => {
    expect(validatePageOrder([1, 2, 3, 4, 4], 5)?.code).toBe("DUPLICATE");
    expect(validatePageOrder([1, 2, 2, 3, 5], 5)?.code).toBe("DUPLICATE");
  });

  it("rejects out-of-range pages", () => {
    expect(validatePageOrder([1, 2, 3, 5, 6], 5)?.code).toBe("OUT_OF_RANGE");
    expect(validatePageOrder([0, 1, 2, 3, 4], 5)?.code).toBe("OUT_OF_RANGE");
    expect(validatePageOrder([1, 2, 3, 4, 999999], 5)?.code).toBe("OUT_OF_RANGE");
  });

  it("rejects an order that is too short or too long", () => {
    expect(validatePageOrder([1, 2, 3], 5)?.code).toBe("MISSING");
    expect(validatePageOrder([1, 2, 3, 4, 5, 5], 5)?.code).toBe("DUPLICATE");
  });

  it("rejects a duplicate combined with a missing page", () => {
    const issue = validatePageOrder([1, 1, 3, 4, 5], 5);
    expect(issue?.code).toBe("DUPLICATE");
  });

  it("rejects an empty order", () => {
    expect(validatePageOrder([], 5)?.code).toBe("EMPTY");
  });

  it("rejects non-integers", () => {
    expect(validatePageOrder([1.5, 2], 2)?.code).toBe("SYNTAX");
  });

  it("rejects a document with no pages", () => {
    expect(validatePageOrder([1], 0)?.code).toBe("WRONG_LENGTH");
  });

  it("never repairs invalid input", () => {
    const input = [1, 2, 3, 4];
    validatePageOrder(input, 5);
    // The validator must not append the missing page or mutate the caller's array.
    expect(input).toEqual([1, 2, 3, 4]);
  });
});

describe("parseAndValidatePageOrder", () => {
  it("accepts a full permutation", () => {
    const result = parseAndValidatePageOrder("3,1,2", 3);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.order).toEqual([3, 1, 2]);
  });

  it("reports the validation problem", () => {
    expect(parseAndValidatePageOrder("1,2", 3)).toMatchObject({
      ok: false,
      issue: { code: "MISSING" },
    });
  });
});

describe("movePageInOrder", () => {
  it("moves an entry earlier and later", () => {
    expect(movePageInOrder([1, 2, 3, 4, 5], 4, 0)).toEqual([5, 1, 2, 3, 4]);
    expect(movePageInOrder([5, 1, 2, 3, 4], 1, 4)).toEqual([5, 2, 3, 4, 1]);
    expect(movePageInOrder([1, 2, 3], 0, 1)).toEqual([2, 1, 3]);
  });

  it("keeps every page exactly once, whatever the move", () => {
    const start = [1, 2, 3, 4, 5];
    for (let from = 0; from < 5; from += 1) {
      for (let to = 0; to < 5; to += 1) {
        const moved = movePageInOrder(start, from, to);
        expect([...moved].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
      }
    }
  });

  it("does not mutate the input", () => {
    const start = [1, 2, 3];
    movePageInOrder(start, 0, 2);
    expect(start).toEqual([1, 2, 3]);
  });

  it("clamps or ignores out-of-bounds moves", () => {
    expect(movePageInOrder([1, 2, 3], 0, -5)).toEqual([1, 2, 3]);
    expect(movePageInOrder([1, 2, 3], 0, 99)).toEqual([2, 3, 1]);
    expect(movePageInOrder([1, 2, 3], 9, 0)).toEqual([1, 2, 3]);
    expect(movePageInOrder([1, 2, 3], 1, 1)).toEqual([1, 2, 3]);
  });
});

describe("formatPageOrder", () => {
  it("serialises for the API", () => {
    expect(formatPageOrder([5, 3, 1])).toBe("5,3,1");
  });
});

/* -------------------------------------------------------------------------- */
/* Page rotation (Phase 6)                                                    */
/* -------------------------------------------------------------------------- */

describe("isPageRotation", () => {
  it("accepts only the four legal angles as numbers", () => {
    for (const angle of [0, 90, 180, 270]) {
      expect(isPageRotation(angle)).toBe(true);
    }
  });

  it("rejects everything else", () => {
    for (const value of [
      -1, -90, 45, 89, 91, 359, 360, 1.5, 90.5, Number.NaN, Infinity,
      -Infinity, "90", "abc", null, undefined, {}, [], true,
    ]) {
      expect(isPageRotation(value), String(value)).toBe(false);
    }
  });
});

describe("rotateClockwise / rotateCounterClockwise", () => {
  it("cycles clockwise", () => {
    expect(rotateClockwise(0)).toBe(90);
    expect(rotateClockwise(90)).toBe(180);
    expect(rotateClockwise(180)).toBe(270);
    expect(rotateClockwise(270)).toBe(0);
  });

  it("cycles counter-clockwise", () => {
    expect(rotateCounterClockwise(0)).toBe(270);
    expect(rotateCounterClockwise(270)).toBe(180);
    expect(rotateCounterClockwise(180)).toBe(90);
    expect(rotateCounterClockwise(90)).toBe(0);
  });

  it("returns to the start after four turns", () => {
    let rotation: 0 | 90 | 180 | 270 = 0;
    for (let i = 0; i < 4; i += 1) rotation = rotateClockwise(rotation);
    expect(rotation).toBe(0);
  });

  it("is reversible", () => {
    for (const angle of [0, 90, 180, 270] as const) {
      expect(rotateCounterClockwise(rotateClockwise(angle))).toBe(angle);
    }
  });
});

describe("addRotations", () => {
  it("composes an existing rotation with a requested one", () => {
    expect(addRotations(90, 90)).toBe(180);
    expect(addRotations(270, 90)).toBe(0);
    expect(addRotations(180, 180)).toBe(0);
    expect(addRotations(0, 270)).toBe(270);
  });

  it("normalises values beyond a full turn", () => {
    expect(addRotations(360, 90)).toBe(90);
    expect(addRotations(-90, 0)).toBe(270);
  });

  it("falls back to 0 for angles PDF cannot express", () => {
    expect(addRotations(45, 0)).toBe(0);
  });
});

describe("formatRotation / hasRotations / compactRotations", () => {
  it("describes a rotation for the interface", () => {
    expect(formatRotation(0)).toBe("Original");
    expect(formatRotation(90)).toBe("90° clockwise");
    expect(formatRotation(270)).toBe("270° clockwise");
  });

  it("detects whether anything is rotated", () => {
    expect(hasRotations({})).toBe(false);
    expect(hasRotations({ 1: 0, 2: 0 })).toBe(false);
    expect(hasRotations({ 1: 0, 2: 90 })).toBe(true);
  });

  it("drops the pages left at 0°", () => {
    expect(compactRotations({ 1: 90, 2: 0, 3: 180 })).toEqual({ 1: 90, 3: 180 });
    expect(compactRotations({})).toEqual({});
  });

  it("serialises only what changed", () => {
    expect(formatPageRotations({ 1: 90, 2: 0 })).toBe('{"1":90}');
    expect(formatPageRotations({})).toBe("{}");
  });
});

describe("parsePageRotations", () => {
  it("parses a page-to-angle object", () => {
    const result = parsePageRotations('{"1":90,"3":180}');
    expect(result).toEqual({ ok: true, rotations: { 1: 90, 3: 180 } });
  });

  it("treats empty input as no rotations", () => {
    expect(parsePageRotations("")).toEqual({ ok: true, rotations: {} });
    expect(parsePageRotations("   ")).toEqual({ ok: true, rotations: {} });
    expect(parsePageRotations("{}")).toEqual({ ok: true, rotations: {} });
  });

  it("rejects malformed JSON", () => {
    expect(parsePageRotations("{")).toMatchObject({
      ok: false,
      issue: { code: "SYNTAX" },
    });
    expect(parsePageRotations("not json")).toMatchObject({ ok: false });
  });

  it("rejects arrays and primitives", () => {
    expect(parsePageRotations("[90]")).toMatchObject({
      ok: false,
      issue: { code: "SYNTAX" },
    });
    expect(parsePageRotations("42")).toMatchObject({ ok: false });
    expect(parsePageRotations('"90"')).toMatchObject({ ok: false });
    expect(parsePageRotations("null")).toMatchObject({ ok: false });
  });

  it("rejects non-numeric page keys", () => {
    expect(parsePageRotations('{"a":90}')).toMatchObject({
      ok: false,
      issue: { code: "SYNTAX" },
    });
    expect(parsePageRotations('{"1.5":90}')).toMatchObject({ ok: false });
    expect(parsePageRotations('{"-1":90}')).toMatchObject({ ok: false });
  });

  it("rejects page 0", () => {
    expect(parsePageRotations('{"0":90}')).toMatchObject({
      ok: false,
      issue: { code: "OUT_OF_RANGE" },
    });
  });

  it("rejects unsupported angles without normalising them", () => {
    for (const bad of ["45", "-90", "91", "360", "1.5"]) {
      const result = parsePageRotations(`{"1":${bad}}`);
      expect(result.ok, bad).toBe(false);
      if (!result.ok) expect(result.issue.code).toBe("INVALID_ANGLE");
    }
  });

  it("rejects angles given as strings", () => {
    expect(parsePageRotations('{"1":"90"}')).toMatchObject({
      ok: false,
      issue: { code: "INVALID_ANGLE" },
    });
  });

  it("accepts an explicit 0", () => {
    expect(parsePageRotations('{"2":0}')).toEqual({ ok: true, rotations: { 2: 0 } });
  });
});

describe("validatePageRotations", () => {
  it("accepts rotations inside the document", () => {
    expect(validatePageRotations({ 1: 90, 5: 270 }, 10)).toBeNull();
    expect(validatePageRotations({}, 10)).toBeNull();
  });

  it("rejects pages beyond the document", () => {
    const issue = validatePageRotations({ 11: 90 }, 10);
    expect(issue?.code).toBe("OUT_OF_RANGE");
    expect(issue?.message).toContain("10 pages");
  });

  it("rejects an unsupported angle", () => {
    expect(validatePageRotations({ 1: 45 as never }, 5)?.code).toBe("INVALID_ANGLE");
  });

  it("rejects a document with no pages", () => {
    expect(validatePageRotations({ 1: 90 }, 0)?.code).toBe("OUT_OF_RANGE");
  });
});

describe("parseAndValidatePageRotations", () => {
  it("accepts valid rotations for the document", () => {
    const result = parseAndValidatePageRotations('{"2":180}', 3);
    expect(result).toEqual({ ok: true, rotations: { 2: 180 } });
  });

  it("reports out-of-range pages", () => {
    expect(parseAndValidatePageRotations('{"9":90}', 3)).toMatchObject({
      ok: false,
      issue: { code: "OUT_OF_RANGE" },
    });
  });
});
