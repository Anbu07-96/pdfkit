// @vitest-environment node
import { describe, expect, it } from "vitest";
import { CANDIDATE_APPLICABILITY, benchmarkedConversions, getApplicability } from "@/lib/benchmarks/applicability";
import { CURRENT_ENGINES } from "@/lib/engines/adapters/current";
import type { ConversionType } from "@/lib/engines/types";

/**
 * Phase 72 applicability matrix tests (§2 of the phase spec).
 *
 * The matrix must cover exactly the 11 live conversions, must not exaggerate
 * candidate coverage, and only conversions with a fair comparison may be
 * benchmarked.
 */

describe("candidate applicability matrix", () => {
  it("covers exactly the 11 live conversions once each", () => {
    expect(CANDIDATE_APPLICABILITY).toHaveLength(11);
    const conversions = CANDIDATE_APPLICABILITY.map((entry) => entry.conversion);
    expect(new Set(conversions).size).toBe(11);
    for (const engine of CURRENT_ENGINES) {
      expect(
        conversions,
        `missing applicability for ${engine.descriptor.conversionType}`,
      ).toContain(engine.descriptor.conversionType);
    }
  });

  it("names the real current engine for every conversion", () => {
    for (const entry of CANDIDATE_APPLICABILITY) {
      const engine = CURRENT_ENGINES.find(
        (candidate) => candidate.descriptor.conversionType === entry.conversion,
      );
      expect(engine, entry.conversion).toBeDefined();
      expect(entry.currentEngine, entry.conversion).toBe(engine!.descriptor.id);
    }
  });

  it("uses only valid statuses and scopes with factual reasons", () => {
    for (const entry of CANDIDATE_APPLICABILITY) {
      expect(["YES", "PARTIAL", "NO"]).toContain(entry.status);
      expect(["direct", "component", "not-comparable"]).toContain(entry.scope);
      expect(entry.reason.length, entry.conversion).toBeGreaterThan(40);
      if (entry.status === "YES") expect(entry.scope).toBe("direct");
      if (entry.status === "NO") expect(entry.scope).toBe("not-comparable");
      if (entry.status === "PARTIAL") expect(entry.scope).toBe("component");
    }
  });

  it("does not exaggerate coverage: exactly one YES — pdf-to-text", () => {
    const yes = CANDIDATE_APPLICABILITY.filter((entry) => entry.status === "YES");
    expect(yes.map((entry) => entry.conversion)).toEqual(["pdf-to-text"]);
  });

  it("excludes rendering and authoring conversions with the documented reasons", () => {
    for (const conversion of [
      "pdf-to-jpg",
      "pdf-to-png",
      "extract-images",
      "images-to-pdf",
      "png-to-pdf",
      "compress-pdf",
    ] as ConversionType[]) {
      const entry = getApplicability(conversion);
      expect(entry.status, conversion).toBe("NO");
      expect(entry.scope, conversion).toBe("not-comparable");
    }
    expect(getApplicability("pdf-to-jpg").reason).toContain("native");
    expect(getApplicability("compress-pdf").reason).toContain("qpdf");
  });

  it("component conversions explain exactly which component pdfjs could replace", () => {
    for (const conversion of [
      "pdf-to-word",
      "pdf-to-excel",
      "extract-tables",
      "compare-documents",
    ] as ConversionType[]) {
      const entry = getApplicability(conversion);
      expect(entry.status, conversion).toBe("PARTIAL");
      expect(entry.scope, conversion).toBe("component");
      expect(entry.reason, conversion).toMatch(/component|positioned/i);
    }
  });

  it("benchmarks only the conversions with a fair comparison", () => {
    expect([...benchmarkedConversions()]).toEqual(["pdf-to-text", "extract-tables"]);
  });

  it("throws for unknown conversions instead of guessing", () => {
    expect(() => getApplicability("pdf-to-svg" as ConversionType)).toThrow(
      /No applicability entry/,
    );
  });
});
