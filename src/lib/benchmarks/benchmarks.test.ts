// @vitest-environment node
import { describe, expect, it } from "vitest";
import { BENCHMARK_FIXTURES, getFixture, normalizeWhitespace } from "@/lib/benchmarks/fixtures";
import { comparableMetrics, runBenchmark } from "@/lib/benchmarks/runner";
import { currentEngineBenchmarkAdapter } from "@/lib/benchmarks/engines/current-adapter";
import { createPdfjsTextCandidate } from "@/lib/benchmarks/engines/pdfjs-candidate";
import { BENCHMARK_VERSION, FIXTURE_VERSION } from "@/lib/benchmarks/types";
import {
  assertFixtureBytesWithinBounds,
  validateFixtureDefinition,
} from "@/lib/benchmarks/bounds";
import {
  benchmarkFailureCategory,
  computeMetrics,
  errorCategory,
  parseTableRows,
} from "@/lib/benchmarks/metrics";
import type { BenchmarkFixture } from "@/lib/benchmarks/types";

/**
 * Phase 71 benchmark foundation tests — deterministic, offline, in-memory.
 *
 * These tests prove the harness works and records honest evidence. They do
 * NOT declare a winning engine: engine selection is Stage 4 work and
 * requires the full corpus campaign (docs/benchmark-plan.md).
 */

const currentText = currentEngineBenchmarkAdapter("pdf-to-text");
const currentWord = currentEngineBenchmarkAdapter("pdf-to-word");
const candidate = createPdfjsTextCandidate();

describe("benchmark fixtures", () => {
  it("provides a corpus with unique ids, provenance and expectations", () => {
    const ids = BENCHMARK_FIXTURES.map((fixture) => fixture.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(8);
    expect(BENCHMARK_FIXTURES.length).toBeGreaterThanOrEqual(35);
    for (const fixture of BENCHMARK_FIXTURES) {
      expect(fixture.provenance).toContain("Synthetic");
      expect(fixture.expected.pageCount).toBeGreaterThanOrEqual(0);
      expect(fixture.version).toBe(FIXTURE_VERSION);
      // Phase 72 machine-readable provenance (§5).
      expect(fixture.synthetic, fixture.id).toBe(true);
      expect(fixture.generator.length, fixture.id).toBeGreaterThan(0);
      expect(fixture.copyright, fixture.id).toContain("Repository-owned");
      expect(fixture.characteristics.length, fixture.id).toBeGreaterThan(0);
      // Phase 72 static ground-truth validation (§6).
      expect(validateFixtureDefinition(fixture), fixture.id).toEqual([]);
    }
  });

  it("keeps every fixture inside the Phase 72 resource bounds", async () => {
    for (const fixture of BENCHMARK_FIXTURES) {
      const bytes = await fixture.build();
      expect(
        () => assertFixtureBytesWithinBounds(fixture, bytes),
        fixture.id,
      ).not.toThrow();
    }
  });

  it("ground truth comes from the fixture definition, not an engine (pdf-lib cross-check)", async () => {
    const { PDFDocument } = await import("pdf-lib");
    for (const fixture of BENCHMARK_FIXTURES.filter((f) => !f.expected.expectsFailure)) {
      const bytes = await fixture.build();
      let document: {
        getPageCount(): number;
        getPage(index: number): { getSize(): { width: number; height: number } };
      } | null = null;
      try {
        document = await PDFDocument.load(bytes, { ignoreEncryption: true });
      } catch {
        // Loadable-by-pdf-lib is not part of the contract for every fixture.
        continue;
      }
      expect(document.getPageCount(), fixture.id).toBe(fixture.expected.pageCount);
      for (const [index, size] of (fixture.expected.pageDimensions ?? []).entries()) {
        const actual = document.getPage(index).getSize();
        expect(Math.round(actual.width), `${fixture.id} page ${index + 1}`).toBe(size.width);
        expect(Math.round(actual.height), `${fixture.id} page ${index + 1}`).toBe(size.height);
      }
    }
  });

  it("builds every fixture into valid in-memory bytes", async () => {
    for (const fixture of BENCHMARK_FIXTURES) {
      const bytes = await fixture.build();
      expect(bytes.length, fixture.id).toBeGreaterThan(0);
      if (!fixture.expected.expectsFailure) {
        expect(String.fromCharCode(...bytes.subarray(0, 5)), fixture.id).toBe("%PDF-");
      }
    }
  });
});

describe("benchmark runner — current engine", () => {
  it("records a complete, reproducible result for a text conversion", async () => {
    const result = await runBenchmark(currentText, getFixture("F-02-text-multi"));

    expect(result.success).toBe(true);
    expect(result.benchmarkVersion).toBe(BENCHMARK_VERSION);
    expect(result.fixtureId).toBe("F-02-text-multi");
    expect(result.engineId).toBe("current-pdfium-text");
    expect(result.conversion).toBe("pdf-to-text");
    expect(result.metrics["output.count"]).toBe(1);
    expect(result.metrics["text.anchorPreservation"]).toBe(1);
    expect(result.metrics["text.pageCoverage"]).toBe(1);
    expect(result.quality?.state).toBe("healthy");
    expect(result.runtime.node).toBe(process.version);
    expect(result.runtime.platform).toBe(process.platform);
  });

  it("records the failure behavior of a malformed fixture as a typed category", async () => {
    const result = await runBenchmark(currentText, getFixture("F-08-malformed"));

    expect(result.success).toBe(false);
    expect(result.metrics["failure.errorCategory"]).toBe("INVALID_PDF");
    expect(result.error?.category).toBe("INVALID_PDF");
    expect(result.metrics["output.exists"]).toBe(false);
  });

  it("applies the production QualityGate uniformly to the scanned fixture", async () => {
    const result = await runBenchmark(currentText, getFixture("F-06-scanned"));

    expect(result.success).toBe(true); // conversion succeeds…
    expect(result.quality?.state).toBe("suspicious"); // …and the gate diagnoses it
    expect(result.metrics["text.characterCount"]).toBeGreaterThan(0); // markers only
  });

  it("is deterministic apart from timing measurements", async () => {
    const fixture = getFixture("F-04-multicolumn");
    const first = await runBenchmark(currentText, fixture);
    const second = await runBenchmark(currentText, fixture);
    expect(comparableMetrics(first)).toEqual(comparableMetrics(second));
  });

  it("never lets fixture content into the result record", async () => {
    const result = await runBenchmark(currentText, getFixture("F-02-text-multi"));
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain("PDFKIT-ANCHOR");
    expect(serialised).not.toContain("Page 1 ---");
  });

  it("benchmarks a non-text conversion with the same harness", async () => {
    const result = await runBenchmark(currentWord, getFixture("F-02-text-multi"));
    expect(result.success).toBe(true);
    expect(result.engineId).toBe("current-pdfium-docx");
    expect(result.metrics["output.count"]).toBe(1);
    // DOCX outputs are not text/*: no text metrics, only structural ones.
    expect(result.metrics["text.characterCount"]).toBeUndefined();
    expect(result.quality?.state).toBe("healthy");
  });
});

describe("benchmark runner — PDF.js candidate (benchmark-only)", () => {
  it("runs the candidate over the corpus fixtures and records evidence", async () => {
    for (const fixtureId of [
      "F-01-text-single",
      "F-02-text-multi",
      "F-04-multicolumn",
      "F-06-scanned",
      "F-08-malformed",
    ]) {
      const result = await runBenchmark(candidate, getFixture(fixtureId));
      expect(result.engineId).toBe("candidate-pdfjs-text");
      expect(result.benchmarkVersion).toBe(BENCHMARK_VERSION);

      if (fixtureId === "F-08-malformed") {
        expect(result.success).toBe(false);
        // Phase 73: typed ProcessingError codes from the shared production core.
        expect(result.metrics["failure.errorCategory"]).toBe("INVALID_PDF");
      } else {
        expect(result.success).toBe(true);
        expect(result.metrics["output.count"]).toBe(1);
        expect(result.metrics["text.pageCoverage"]).toBe(1);
      }
    }
  });

  it("records comparable evidence for current vs candidate WITHOUT declaring a winner", async () => {
    // This is evidence gathering for docs/benchmark-plan.md — the assertion
    // is that both engines produce honest, comparable records on the same
    // fixtures, not that either is better. Selection is Stage 4.
    for (const fixtureId of ["F-01-text-single", "F-04-multicolumn", "F-06-scanned"]) {
      const fixture = getFixture(fixtureId);
      const currentResult = await runBenchmark(currentText, fixture);
      const candidateResult = await runBenchmark(candidate, fixture);

      expect(currentResult.fixtureId).toBe(candidateResult.fixtureId);
      expect(currentResult.conversion).toBe(candidateResult.conversion);
      for (const result of [currentResult, candidateResult]) {
        expect(result.success).toBe(true);
        expect(result.quality?.state).toBeDefined();
        expect(typeof result.metrics["performance.wallClockMs"]).toBe("number");
      }
      // Anchor preservation exists wherever anchors were planted…
      if (fixture.expected.anchors.length > 0) {
        expect(typeof currentResult.metrics["text.anchorPreservation"]).toBe("number");
        expect(typeof candidateResult.metrics["text.anchorPreservation"]).toBe("number");
      } else {
        // …and is honestly absent for the scanned fixture (nothing to preserve).
        expect(currentResult.metrics["text.anchorPreservation"]).toBeUndefined();
        expect(candidateResult.metrics["text.anchorPreservation"]).toBeUndefined();
      }
    }
  });

  it("candidate evidence is deterministic apart from timing", async () => {
    const fixture = getFixture("F-04-multicolumn");
    const first = await runBenchmark(candidate, fixture);
    const second = await runBenchmark(candidate, fixture);
    expect(comparableMetrics(first)).toEqual(comparableMetrics(second));
  });
});

/* ------------------------------------------------------------------ */
/* Phase 72 — metric unit tests (no engine involved)                    */
/* ------------------------------------------------------------------ */

/** A minimal fixture object for metric unit tests. */
function metricFixture(
  expected: Partial<BenchmarkFixture["expected"]>,
): BenchmarkFixture {
  return {
    id: "TEST-METRIC",
    version: FIXTURE_VERSION,
    category: "test",
    characteristics: ["test"],
    purpose: "metric unit test",
    generator: "test",
    synthetic: true,
    copyright: "test",
    provenance: "test",
    build: async () => new Uint8Array(),
    expected: { pageCount: 1, anchors: [], ...expected },
  };
}

function textArtifact(text: string) {
  const bytes = new TextEncoder().encode(text);
  return [{ name: "out.txt", mimeType: "text/plain; charset=utf-8", size: bytes.length, bytes }];
}

describe("Phase 72 metrics — ground-truth computations", () => {
  it("anchor precision detects fabricated anchor-shaped tokens", () => {
    const fixture = metricFixture({ anchors: ["PDFKIT-A", "PDFKIT-B"] });
    const metrics = computeMetrics({
      fixture,
      artifacts: textArtifact("--- Page 1 ---\nPDFKIT-A PDFKIT-B PDFKIT-FAKE"),
    });
    expect(metrics["text.anchorPreservation"]).toBe(1);
    expect(metrics["text.anchorPrecision"]).toBeCloseTo(2 / 3);
  });

  it("anchor precision detects duplicated anchors", () => {
    const fixture = metricFixture({ anchors: ["PDFKIT-A"] });
    const metrics = computeMetrics({
      fixture,
      artifacts: textArtifact("PDFKIT-A PDFKIT-A"),
    });
    // The duplicate collapses into one detected token: recall stays 1.
    expect(metrics["text.anchorPreservation"]).toBe(1);
    expect(metrics["text.anchorPrecision"]).toBe(1);
  });

  it("token recall requires token boundaries and counts unexpected tokens", () => {
    const fixture = metricFixture({ anchors: ["PDFKIT-A"], tokens: ["fox", "42"] });
    const metrics = computeMetrics({
      fixture,
      artifacts: textArtifact("PDFKIT-A the foxx 42 alpha"),
    });
    // "fox" inside "foxx" is NOT a token match.
    expect(metrics["text.tokenRecall"]).toBe(0.5);
    // "the", "foxx" (not "fox") and "alpha" are all unexplained tokens.
    expect(metrics["text.unexpectedTokenCount"]).toBe(3);
  });

  it("character ratio and whitespace-normalized exactness follow the documented normalization", () => {
    const canonical = "PDFKIT-A alpha beta   gamma";
    const fixture = metricFixture({
      anchors: ["PDFKIT-A"],
      canonicalText: canonical,
      characterCount: normalizeWhitespace(canonical).length,
    });
    const exact = computeMetrics({
      fixture,
      artifacts: textArtifact("--- Page 1 ---\nPDFKIT-A  alpha   beta gamma"),
    });
    expect(exact["text.whitespaceNormalizedExactness"]).toBe(1);
    expect(exact["text.characterRatio"]).toBe(1);

    const lossy = computeMetrics({
      fixture,
      artifacts: textArtifact("PDFKIT-A alpha beta"),
    });
    expect(lossy["text.whitespaceNormalizedExactness"]).toBe(0);
    expect(lossy["text.characterRatio"]).toBeCloseTo(
      normalizeWhitespace("PDFKIT-A alpha beta").length /
        normalizeWhitespace(canonical).length,
    );
  });

  it("unicode preservation measures the expected special characters", () => {
    const fixture = metricFixture({
      anchors: ["PDFKIT-U"],
      unicodeChars: ["é", "ü"],
      symbolChars: ["©", "±"],
    });
    const full = computeMetrics({
      fixture,
      artifacts: textArtifact("PDFKIT-U é ü © ±"),
    });
    expect(full["text.unicodePreservation"]).toBe(1);
    const partial = computeMetrics({
      fixture,
      artifacts: textArtifact("PDFKIT-U é ü ±"),
    });
    expect(partial["text.unicodePreservation"]).toBeCloseTo(0.75);
  });

  it("reading order follows consecutive ground-truth pairs", () => {
    const fixture = metricFixture({
      anchors: ["PDFKIT-1", "PDFKIT-2", "PDFKIT-3"],
      orderedAnchors: ["PDFKIT-1", "PDFKIT-2", "PDFKIT-3"],
    });
    const ordered = computeMetrics({
      fixture,
      artifacts: textArtifact("PDFKIT-1 PDFKIT-2 PDFKIT-3"),
    });
    expect(ordered["text.readingOrderAccuracy"]).toBe(1);
    const scrambled = computeMetrics({
      fixture,
      artifacts: textArtifact("PDFKIT-3 PDFKIT-1 PDFKIT-2"),
    });
    // Pairs present: (1,2) in order, (2,3) out of order -> 1/2.
    expect(scrambled["text.readingOrderAccuracy"]).toBe(0.5);
  });

  it("blank-page correctness: expected-empty pages must carry no planted content", () => {
    const fixture = metricFixture({
      anchors: ["PDFKIT-P1"],
      blankPages: [2],
      imageOnlyPages: [3],
      tokens: ["alpha"],
    });
    const honest = computeMetrics({
      fixture,
      artifacts: textArtifact(
        "--- Page 1 ---\nPDFKIT-P1 alpha\n\n--- Page 2 ---\n[Page 2 contains no extractable text]\n\n--- Page 3 ---\n[Page 3 contains no extractable text]",
      ),
    });
    expect(honest["text.blankPageCorrectness"]).toBe(1);
    const fabricating = computeMetrics({
      fixture,
      artifacts: textArtifact(
        "--- Page 1 ---\nPDFKIT-P1 alpha\n\n--- Page 2 ---\nalpha\n\n--- Page 3 ---\n[Page 3 contains no extractable text]",
      ),
    });
    expect(fabricating["text.blankPageCorrectness"]).toBe(0.5);
  });

  it("table metrics are computed from CSV outputs against the planted ground truth", () => {
    const fixture = metricFixture({
      anchors: ["PDFKIT-R1C1", "PDFKIT-R1C2", "PDFKIT-R2C1", "PDFKIT-R2C2"],
      table: {
        rows: [
          ["PDFKIT-R1C1", "PDFKIT-R1C2"],
          ["PDFKIT-R2C1", "PDFKIT-R2C2"],
        ],
      },
    });
    const csv = new TextEncoder().encode(
      '--- Page 1 ---\n"PDFKIT-R1C1","PDFKIT-R1C2"\n"PDFKIT-R2C1","PDFKIT-R2C2"',
    );
    const metrics = computeMetrics({
      fixture,
      artifacts: [
        { name: "t.csv", mimeType: "text/csv; charset=utf-8", size: csv.length, bytes: csv },
      ],
    });
    expect(metrics["table.cellTokenRecall"]).toBe(1);
    expect(metrics["table.rowCountRatio"]).toBe(1);
    expect(metrics["table.rowGroupingAccuracy"]).toBe(1);

    // A CSV whose rows collapse to single cells keeps the tokens (recall)
    // but loses the grouping (the honest current-engine behavior on
    // space-collapsed rows).
    const collapsed = new TextEncoder().encode(
      '--- Page 1 ---\n"PDFKIT-R1C1 PDFKIT-R1C2"\n"PDFKIT-R2C1 PDFKIT-R2C2"',
    );
    const collapsedMetrics = computeMetrics({
      fixture,
      artifacts: [
        {
          name: "t.csv",
          mimeType: "text/csv; charset=utf-8",
          size: collapsed.length,
          bytes: collapsed,
        },
      ],
    });
    expect(collapsedMetrics["table.cellTokenRecall"]).toBe(1);
    expect(collapsedMetrics["table.rowCountRatio"]).toBe(1);
    expect(collapsedMetrics["table.rowGroupingAccuracy"]).toBe(0);
  });

  it("table metrics are NOT invented for non-CSV text outputs", () => {
    const fixture = metricFixture({
      anchors: ["PDFKIT-R1C1", "PDFKIT-R1C2"],
      table: { rows: [["PDFKIT-R1C1", "PDFKIT-R1C2"]] },
    });
    const metrics = computeMetrics({
      fixture,
      artifacts: textArtifact("PDFKIT-R1C1 PDFKIT-R1C2"),
    });
    expect(metrics["table.cellTokenRecall"]).toBeUndefined();
    expect(metrics["table.rowGroupingAccuracy"]).toBeUndefined();
  });

  it("parseTableRows handles quoted CSV rows and wide-space text rows", () => {
    expect(
      parseTableRows('--- Page 1 ---\n"a","b"\n"c","d"'),
    ).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
    expect(parseTableRows("alpha  beta\ngamma   delta")).toEqual([
      ["alpha", "beta"],
      ["gamma", "delta"],
    ]);
  });
});

describe("Phase 72 failure classification (benchmark taxonomy only)", () => {
  it("maps typed production codes onto benchmark categories", () => {
    expect(benchmarkFailureCategory("INVALID_PDF")).toBe("malformed-input");
    expect(benchmarkFailureCategory("ENCRYPTED_PDF")).toBe("unsupported-input");
    expect(benchmarkFailureCategory("TOO_MANY_OUTPUTS")).toBe("output-limit");
    expect(benchmarkFailureCategory("VALIDATION_ERROR")).toBe("output-invalid");
    expect(benchmarkFailureCategory("REQUEST_TIMEOUT")).toBe("timeout");
    expect(benchmarkFailureCategory("PROCESSING_ERROR")).toBe("processing-failure");
    expect(benchmarkFailureCategory("SOMETHING_ELSE")).toBe("non-typed-error");
  });

  it("recognises PDF.js exception names without touching the production taxonomy", () => {
    const invalid = Object.assign(new Error("invalid"), {
      name: "InvalidPDFException",
    });
    expect(errorCategory(invalid)).toBe("InvalidPDFException");
    expect(benchmarkFailureCategory(errorCategory(invalid))).toBe("malformed-input");
    const password = Object.assign(new Error("locked"), {
      name: "PasswordException",
    });
    expect(benchmarkFailureCategory(errorCategory(password))).toBe("unsupported-input");
    expect(errorCategory(new Error("plain"))).toBe("NON_TYPED_ERROR");
  });

  it("records the benchmark category alongside the typed code on failure", async () => {
    const result = await runBenchmark(candidate, getFixture("F-36-edge-truncated"));
    expect(result.success).toBe(false);
    // Phase 73: the candidate now shares the production core, so its
    // failures are typed ProcessingErrors — the same code the current
    // engine reports (improved parity; Phase 72 saw raw pdfjs names).
    expect(result.metrics["failure.errorCategory"]).toBe("INVALID_PDF");
    expect(result.metrics["failure.benchmarkCategory"]).toBe("malformed-input");
    const currentResult = await runBenchmark(currentText, getFixture("F-36-edge-truncated"));
    expect(currentResult.success).toBe(false);
    expect(currentResult.metrics["failure.errorCategory"]).toBe("INVALID_PDF");
    expect(currentResult.metrics["failure.benchmarkCategory"]).toBe("malformed-input");
  });
});
