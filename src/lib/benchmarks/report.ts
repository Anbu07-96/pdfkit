import "server-only";

import os from "node:os";

import { BENCHMARK_FIXTURES, getFixture } from "@/lib/benchmarks/fixtures";
import { currentEngineBenchmarkAdapter } from "@/lib/benchmarks/engines/current-adapter";
import { createPdfjsTextCandidate } from "@/lib/benchmarks/engines/pdfjs-candidate";
import { createPdfjsTableSignalCandidate } from "@/lib/benchmarks/engines/pdfjs-table-signal";
import { runBenchmarkSeries, type SeriesOptions } from "@/lib/benchmarks/perf";
import { BENCHMARK_BOUNDS } from "@/lib/benchmarks/bounds";
import { CANDIDATE_APPLICABILITY } from "@/lib/benchmarks/applicability";
import {
  BENCHMARK_VERSION,
  FIXTURE_VERSION,
  type Phase72CaseResult,
  type Phase72Report,
  type QualityCorrelationGroup,
} from "@/lib/benchmarks/types";

/**
 * Phase 72 evidence report builder (§16 of the phase spec).
 *
 * Executes the controlled benchmark — every DIRECT comparable conversion
 * (pdf-to-text) and the COMPONENT comparable conversion (extract-tables
 * table-signal) — and produces a machine-readable artifact containing
 * metrics, timing statistics, quality verdicts and typed failure codes.
 *
 * PRIVACY CONTRACT: the serialized report must contain NO document content.
 * `serializeReport` asserts this before returning, and the report test
 * re-asserts it independently. Allowed: ids, versions, counts, ratios,
 * typed codes, timing numbers, quality states. Forbidden: extracted text,
 * anchors, page-marker content, file paths, personal data.
 *
 * The report records EVIDENCE. It does not decide, rank or recommend — the
 * per-conversion GO/NO-GO decisions are human judgments documented in
 * docs/benchmark-results-phase72.md.
 */

export interface ReportOptions {
  /** Restrict the corpus (test mode); default: the full corpus. */
  fixtureIds?: readonly string[];
  /** Series configuration; defaults follow the Phase 72 method. */
  series?: SeriesOptions;
}

/** QualityGate correlation group key (engine + verdict). */
function correlationKey(engineId: string, state: string): string {
  return `${engineId}|${state}`;
}

/** Aggregate QualityGate verdicts against measurable outcomes (§15). */
function buildQualityCorrelation(
  cases: readonly Phase72CaseResult[],
): QualityCorrelationGroup[] {
  const groups = new Map<
    string,
    { engineId: string; state: string; runs: number; anchorSum: number; anchorCount: number; tokenSum: number; tokenCount: number }
  >();
  for (const testCase of cases) {
    for (const series of testCase.runs) {
      if (!series.quality) continue;
      const key = correlationKey(series.engineId, series.quality.state);
      const group = groups.get(key) ?? {
        engineId: series.engineId,
        state: series.quality.state,
        runs: 0,
        anchorSum: 0,
        anchorCount: 0,
        tokenSum: 0,
        tokenCount: 0,
      };
      group.runs += 1;
      const anchor = series.metrics["text.anchorPreservation"];
      if (typeof anchor === "number") {
        group.anchorSum += anchor;
        group.anchorCount += 1;
      }
      const token = series.metrics["text.tokenRecall"];
      if (typeof token === "number") {
        group.tokenSum += token;
        group.tokenCount += 1;
      }
      groups.set(key, group);
    }
  }
  return [...groups.values()]
    .map((group) => ({
      engineId: group.engineId,
      state: group.state,
      runs: group.runs,
      ...(group.anchorCount > 0
        ? { meanAnchorPreservation: group.anchorSum / group.anchorCount }
        : {}),
      ...(group.tokenCount > 0
        ? { meanTokenRecall: group.tokenSum / group.tokenCount }
        : {}),
    }))
    .sort(
      (a, b) =>
        a.engineId.localeCompare(b.engineId) || a.state.localeCompare(b.state),
    );
}

/** Build the complete Phase 72 evidence report (full corpus by default). */
export async function buildPhase72Report(
  options: ReportOptions = {},
): Promise<Phase72Report> {
  const fixtures = options.fixtureIds
    ? options.fixtureIds.map((id) => getFixture(id))
    : BENCHMARK_FIXTURES;
  const series = options.series ?? {};

  const cases: Phase72CaseResult[] = [];

  // Direct competition: pdf-to-text, every fixture, both engines.
  for (const fixture of fixtures) {
    cases.push({
      fixtureId: fixture.id,
      conversion: "pdf-to-text",
      scope: "direct",
      runs: [
        await runBenchmarkSeries(
          currentEngineBenchmarkAdapter("pdf-to-text"),
          fixture,
          series,
        ),
        await runBenchmarkSeries(createPdfjsTextCandidate(), fixture, series),
      ],
    });
  }

  // Component competition: extract-tables, table fixtures only, current
  // engine vs candidate positional table signal.
  for (const fixture of fixtures.filter((candidate) => candidate.expected.table)) {
    cases.push({
      fixtureId: fixture.id,
      conversion: "extract-tables",
      scope: "component",
      runs: [
        await runBenchmarkSeries(
          currentEngineBenchmarkAdapter("extract-tables"),
          fixture,
          series,
        ),
        await runBenchmarkSeries(createPdfjsTableSignalCandidate(), fixture, series),
      ],
    });
  }

  return {
    benchmarkVersion: BENCHMARK_VERSION,
    fixtureVersion: FIXTURE_VERSION,
    generatedAt: new Date().toISOString(),
    runtime: {
      node: process.version,
      platform: process.platform,
      ...(os.cpus()[0]?.model ? { cpuModel: os.cpus()[0].model } : {}),
    },
    seriesConfig: {
      warmupRuns: series.warmupRuns ?? 1,
      minMeasuredRuns: series.measuredRuns ?? BENCHMARK_BOUNDS.minMeasuredRuns,
      maxMeasuredRuns: series.maxMeasuredRuns ?? BENCHMARK_BOUNDS.maxMeasuredRuns,
      fastExtensionThresholdMs:
        series.fastExtensionThresholdMs ?? BENCHMARK_BOUNDS.fastExtensionThresholdMs,
      maxCaseWallClockMs: series.maxCaseWallClockMs ?? BENCHMARK_BOUNDS.maxCaseWallClockMs,
    },
    applicability: CANDIDATE_APPLICABILITY,
    cases,
    qualityCorrelation: buildQualityCorrelation(cases),
    notes: [
      "Rendering conversions (pdf-to-jpg, pdf-to-png) were not benchmarked: candidate applicability is NO — raster output requires the optional native @napi-rs/canvas dependency, which the production no-native-binaries constraint excludes.",
      "extract-tables evidence is COMPONENT-LEVEL: the candidate provides positioned text, not table reconstruction; no full extract-tables equivalence is claimed.",
      "pdf-to-word, pdf-to-excel and compare-documents share the same pdfium text component as pdf-to-text, so the pdf-to-text cases are their component evidence; their assembly stages are unmeasured.",
      "Timing values are wall-clock measurements from the recorded runs: reproducible in method, not identical in value.",
      "All fixtures are synthetic repository-owned documents; results contain no document content.",
      "This artifact records evidence only — it encodes no decision, ranking or production threshold.",
    ],
  };
}

/**
 * Assert the privacy contract on a serialized report: no anchors, no page
 * markers, no bracketed no-text content lines. Throws on violation.
 */
export function assertReportPrivacy(serialized: string): void {
  for (const forbidden of ["PDFKIT-", "--- Page", "[Page "]) {
    if (serialized.includes(forbidden)) {
      throw new Error(`benchmark report privacy violation: content-shaped string "${forbidden}" found`);
    }
  }
}

/** Serialize a report as pretty JSON, enforcing the privacy contract. */
export function serializeReport(report: Phase72Report): string {
  const serialized = JSON.stringify(report, null, 2);
  assertReportPrivacy(serialized);
  return serialized;
}
