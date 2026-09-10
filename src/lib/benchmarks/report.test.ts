// @vitest-environment node
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertReportPrivacy,
  buildPhase72Report,
  serializeReport,
} from "@/lib/benchmarks/report";
import { CANDIDATE_APPLICABILITY } from "@/lib/benchmarks/applicability";
import { BENCHMARK_VERSION, FIXTURE_VERSION } from "@/lib/benchmarks/types";

/**
 * Phase 72 evidence report tests (§16, §26).
 *
 * The report is generated on a representative fixture SUBSET with a small
 * series so the suite stays fast; the committed full-corpus artifact
 * (docs/benchmark-results-phase72.json) is produced by the same code path.
 * These tests lock the structure, the privacy contract and the
 * serialization round-trip.
 */

const SUBSET = [
  "F-01-text-single",
  "F-03-table-aligned",
  "F-04-multicolumn",
  "F-36-edge-truncated",
] as const;

describe("Phase 72 evidence report", () => {
  it(
    "builds a structured, privacy-safe, serializable report",
    async () => {
      const report = await buildPhase72Report({
        fixtureIds: SUBSET,
        series: { warmupRuns: 1, measuredRuns: 3, maxMeasuredRuns: 3 },
      });

      // Structure and versions.
      expect(report.benchmarkVersion).toBe(BENCHMARK_VERSION);
      expect(report.fixtureVersion).toBe(FIXTURE_VERSION);
      expect(report.runtime.node).toBe(process.version);
      expect(report.seriesConfig.warmupRuns).toBe(1);
      expect(report.seriesConfig.minMeasuredRuns).toBe(3);
      expect(report.applicability).toEqual(CANDIDATE_APPLICABILITY);
      expect(report.applicability).toHaveLength(11);
      expect(report.notes.length).toBeGreaterThan(3);

      // Cases: every fixture gets a pdf-to-text case; table fixtures also
      // get an extract-tables component case.
      const textCases = report.cases.filter((c) => c.conversion === "pdf-to-text");
      const tableCases = report.cases.filter((c) => c.conversion === "extract-tables");
      expect(textCases.map((c) => c.fixtureId).sort()).toEqual([...SUBSET].sort());
      expect(tableCases.map((c) => c.fixtureId)).toEqual(["F-03-table-aligned"]);
      for (const testCase of report.cases) {
        expect(testCase.runs).toHaveLength(2);
        expect(new Set(testCase.runs.map((run) => run.engineId)).size).toBe(2);
        for (const series of testCase.runs) {
          expect(series.measuredRuns).toBe(3);
          expect(series.warmupRuns).toBe(1);
          expect(series.metricsStable).toBe(true);
          expect(series.timing.samples).toBe(3);
        }
      }
      expect(
        textCases.find((c) => c.fixtureId === "F-04-multicolumn")!.scope,
      ).toBe("direct");
      expect(tableCases[0].scope).toBe("component");

      // Failure cases carry typed categories, never content.
      const failed = report.cases
        .flatMap((c) => c.runs)
        .filter((run) => !run.success);
      expect(failed.length).toBeGreaterThanOrEqual(2); // both engines on truncated
      for (const series of failed) {
        expect(typeof series.error?.category).toBe("string");
        expect(series.metrics["failure.benchmarkCategory"]).toBe("malformed-input");
      }

      // Quality correlation covers verdict-bearing runs.
      expect(report.qualityCorrelation.length).toBeGreaterThan(0);
      const totalRuns = report.qualityCorrelation.reduce((sum, g) => sum + g.runs, 0);
      expect(totalRuns).toBe(
        report.cases.flatMap((c) => c.runs).filter((run) => run.quality).length,
      );

      // Privacy + serialization round-trip.
      const serialized = serializeReport(report);
      expect(serialized).not.toContain("PDFKIT-");
      const roundTrip = JSON.parse(serialized);
      expect(roundTrip).toEqual(report);

      // Write to disk and re-read: the artifact is a stable file format.
      const dir = mkdtempSync(join(tmpdir(), "pdfkit-benchmark-"));
      try {
        const file = join(dir, "benchmark-results-phase72.json");
        writeFileSync(file, serialized, "utf8");
        expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(report);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    120_000,
  );

  it("refuses reports that leak content-shaped strings", () => {
    expect(() => assertReportPrivacy('{"x":"PDFKIT-ANCHOR-1"}')).toThrow(/privacy/);
    expect(() => assertReportPrivacy('{"x":"--- Page 1 ---"}')).toThrow(/privacy/);
    expect(() => assertReportPrivacy('{"x":"[Page 2 contains no extractable text]"}')).toThrow(
      /privacy/,
    );
    expect(() => assertReportPrivacy('{"metrics":{"text.anchorPreservation":1}}')).not.toThrow();
  });
});
