import { describe, expect, it } from "vitest";
import { comparePageTexts, formatComparisonReport } from "@/lib/processing/compare";

describe("Document Comparison", () => {
  it("detects identical texts across two single-page documents", () => {
    const res = comparePageTexts("docA.pdf", "docB.pdf", ["Hello World"], ["Hello World"]);
    expect(res.identicalPageCount).toBe(true);
    expect(res.pageDiffs[0].identical).toBe(true);

    const report = formatComparisonReport(res);
    expect(report).toContain("Documents are identical");
  });

  it("detects differences between two documents", () => {
    const res = comparePageTexts("docA.pdf", "docB.pdf", ["Version 1"], ["Version 2"]);
    expect(res.pageDiffs[0].identical).toBe(false);

    const report = formatComparisonReport(res);
    expect(report).toContain("Page 1 Differences");
  });
});
