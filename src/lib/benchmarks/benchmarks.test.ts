// @vitest-environment node
import { describe, expect, it } from "vitest";
import { BENCHMARK_FIXTURES, getFixture } from "@/lib/benchmarks/fixtures";
import { comparableMetrics, runBenchmark } from "@/lib/benchmarks/runner";
import { currentEngineBenchmarkAdapter } from "@/lib/benchmarks/engines/current-adapter";
import { createPdfjsTextCandidate } from "@/lib/benchmarks/engines/pdfjs-candidate";
import { BENCHMARK_VERSION, FIXTURE_VERSION } from "@/lib/benchmarks/types";

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
    for (const fixture of BENCHMARK_FIXTURES) {
      expect(fixture.provenance).toContain("Synthetic");
      expect(fixture.expected.pageCount).toBeGreaterThanOrEqual(0);
      expect(fixture.version).toBe(FIXTURE_VERSION);
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
        expect(typeof result.metrics["failure.errorCategory"]).toBe("string");
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
