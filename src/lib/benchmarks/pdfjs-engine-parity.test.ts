// @vitest-environment node
import { describe, expect, it } from "vitest";
import { BENCHMARK_FIXTURES, getFixture } from "@/lib/benchmarks/fixtures";
import { createPdfjsTextCandidate } from "@/lib/benchmarks/engines/pdfjs-candidate";
import { currentEngineBenchmarkAdapter } from "@/lib/benchmarks/engines/current-adapter";
import { pdfjsTextEngine } from "@/lib/engines/adapters/pdfjs-text";
import { DEFAULT_PROCESSING_LIMITS } from "@/lib/processing/limits";
import { computeMetrics } from "@/lib/benchmarks/metrics";

/**
 * Phase 73 §23–§24: benchmark/production parity and the regression corpus.
 *
 * §23: the Phase 72 benchmark candidate now wraps the PRODUCTION pdfjs
 * engine, so parity is by construction — this test PROVES it differentially
 * on representative fixtures (both adapters run over the same bytes; page
 * content must be identical).
 *
 * §24: both CURRENT and ALTERNATIVE engines run across the Phase 72
 * fixture corpus. Differences are RECORDED, not erased: the known behavioral
 * divergences (µ→μ, off-page clipping) must appear exactly where Phase 72
 * measured them, and nowhere else. Historic Phase 72 results (frozen in
 * docs/benchmark-results-phase72.json) are never rewritten.
 */

const REPRESENTATIVE_FIXTURES = [
  "F-01-text-single",
  "F-02-text-multi",
  "F-04-multicolumn",
  "F-14-text-unicode",
  "F-15-text-symbols",
  "F-29-pages-stress",
  "F-34-edge-blank-pdf",
  "F-39-edge-offpage-text",
] as const;

function pageBodies(text: string): string[] {
  return text
    .split(/--- Page \d+ ---/)
    .map((section) => section.trim())
    .filter((section) => section.length > 0);
}

describe("§23 benchmark/production parity (shared core, differential proof)", () => {
  it("the benchmark candidate and the production engine produce identical page content", async () => {
    const candidate = createPdfjsTextCandidate();
    for (const fixtureId of REPRESENTATIVE_FIXTURES) {
      const fixture = getFixture(fixtureId);
      const bytes = await fixture.build();

      const candidateRun = await candidate.run({ name: `${fixtureId}.pdf`, bytes });
      const candidateText = new TextDecoder().decode(candidateRun.artifacts[0].bytes);

      const production = await pdfjsTextEngine.run(
        {
          toolId: "pdf-to-text",
          files: [
            {
              id: "f1",
              name: `${fixtureId}.pdf`,
              size: bytes.length,
              mimeType: "application/pdf",
              bytes,
            },
          ],
          options: { pages: "all" },
        },
        { limits: DEFAULT_PROCESSING_LIMITS },
      );
      const productionText = new TextDecoder().decode(production.artifacts[0].bytes);

      // Identical extraction behavior, page by page.
      expect(pageBodies(candidateText), fixtureId).toEqual(pageBodies(productionText));
    }
  });

  it("the candidate reports the production engine's typed failures", async () => {
    const candidate = createPdfjsTextCandidate();
    const bytes = await getFixture("F-36-edge-truncated").build();
    const error = await candidate
      .run({ name: "F-36.pdf", bytes })
      .catch((cause) => cause);
    expect(error.code).toBe("INVALID_PDF");
  });
});

describe("§24 regression corpus — current vs alternative, differences recorded honestly", () => {
  it("both engines succeed (or fail typed) on every fixture in the corpus", async () => {
    const current = currentEngineBenchmarkAdapter("pdf-to-text");
    const alternative = pdfjsTextEngine;

    for (const fixture of BENCHMARK_FIXTURES) {
      const bytes = await fixture.build();
      const request = {
        toolId: "pdf-to-text",
        files: [
          { id: "f1", name: `${fixture.id}.pdf`, size: bytes.length, mimeType: "application/pdf", bytes },
        ],
        options: { pages: "all" },
      };

      const currentResult = await current
        .run({ name: `${fixture.id}.pdf`, bytes })
        .catch((cause) => cause);
      const alternativeResult = await alternative
        .run(request, { limits: DEFAULT_PROCESSING_LIMITS })
        .catch((cause) => cause);

      if (fixture.expected.expectsFailure) {
        // Both engines fail with the SAME typed code — never silent output.
        expect(currentResult.code, fixture.id).toBe("INVALID_PDF");
        expect(alternativeResult.code, fixture.id).toBe("INVALID_PDF");
        continue;
      }

      expect(currentResult.artifacts, fixture.id).toHaveLength(1);
      expect(alternativeResult.artifacts, fixture.id).toHaveLength(1);
      // Both engines go through the same validation + quality path.
      expect(alternativeResult.validation.status, fixture.id).not.toBe("not-evaluated");
      expect(alternativeResult.quality?.state, fixture.id).toBeDefined();
      expect(alternativeResult.attempt, fixture.id).toBe(1);
    }
  });

  it("anchor preservation matches the current engine on every fixture except the documented off-page case", async () => {
    const current = currentEngineBenchmarkAdapter("pdf-to-text");
    const alternative = pdfjsTextEngine;

    for (const fixture of BENCHMARK_FIXTURES) {
      if (fixture.expected.anchors.length === 0 || fixture.expected.expectsFailure) continue;
      const bytes = await fixture.build();

      const currentMetrics = computeMetrics({
        fixture,
        artifacts: (await current.run({ name: `${fixture.id}.pdf`, bytes })).artifacts,
      });
      const production = await alternative.run(
        {
          toolId: "pdf-to-text",
          files: [
            { id: "f1", name: `${fixture.id}.pdf`, size: bytes.length, mimeType: "application/pdf", bytes },
          ],
          options: { pages: "all" },
        },
        { limits: DEFAULT_PROCESSING_LIMITS },
      );
      const alternativeMetrics = computeMetrics({ fixture, artifacts: production.artifacts });

      const currentPreservation = currentMetrics["text.anchorPreservation"];
      const alternativePreservation = alternativeMetrics["text.anchorPreservation"];
      expect(currentPreservation, fixture.id).toBe(1);

      if (fixture.id === "F-39-edge-offpage-text") {
        // Rule B: documented divergence — pdfjs clips off-page glyphs.
        expect(alternativePreservation, fixture.id).toBeLessThan(1);
      } else {
        expect(alternativePreservation, fixture.id).toBe(1);
      }
    }
  });

  it("the micro-sign divergence appears exactly on the symbol fixture (Rule A)", async () => {
    const fixture = getFixture("F-15-text-symbols");
    const bytes = await fixture.build();
    const production = await pdfjsTextEngine.run(
      {
        toolId: "pdf-to-text",
        files: [
          { id: "f1", name: "F-15.pdf", size: bytes.length, mimeType: "application/pdf", bytes },
        ],
        options: { pages: "all" },
      },
      { limits: DEFAULT_PROCESSING_LIMITS },
    );
    const text = new TextDecoder().decode(production.artifacts[0].bytes);
    // Documented: the micro sign normalizes to Greek mu in pdfjs output.
    expect(text).toContain("μ");
    expect(text).not.toContain("µ");

    // And on every OTHER unicode-bearing fixture the special characters
    // survive identically to the current engine.
    const unicodeFixture = getFixture("F-14-text-unicode");
    const unicodeBytes = await unicodeFixture.build();
    const unicodeProduction = await pdfjsTextEngine.run(
      {
        toolId: "pdf-to-text",
        files: [
          {
            id: "f1",
            name: "F-14.pdf",
            size: unicodeBytes.length,
            mimeType: "application/pdf",
            bytes: unicodeBytes,
          },
        ],
        options: { pages: "all" },
      },
      { limits: DEFAULT_PROCESSING_LIMITS },
    );
    const unicodeText = new TextDecoder().decode(unicodeProduction.artifacts[0].bytes);
    for (const char of unicodeFixture.expected.unicodeChars ?? []) {
      expect(unicodeText, char).toContain(char);
    }
  });

  it("the reading-order advantage holds in production (layout fixtures)", async () => {
    const alternative = pdfjsTextEngine;
    for (const fixtureId of [
      "F-04-multicolumn",
      "F-19-layout-three-column",
      "F-25-layout-landscape",
    ]) {
      const fixture = getFixture(fixtureId);
      const bytes = await fixture.build();
      const production = await alternative.run(
        {
          toolId: "pdf-to-text",
          files: [
            { id: "f1", name: `${fixtureId}.pdf`, size: bytes.length, mimeType: "application/pdf", bytes },
          ],
          options: { pages: "all" },
        },
        { limits: DEFAULT_PROCESSING_LIMITS },
      );
      const metrics = computeMetrics({ fixture, artifacts: production.artifacts });
      expect(metrics["text.columnOrderPreserved"], fixtureId).toBe(1);
      expect(metrics["text.readingOrderAccuracy"], fixtureId).toBe(1);
    }
  });
});
