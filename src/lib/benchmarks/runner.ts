import "server-only";

import { assessConversionQuality } from "@/lib/engines/quality";
import { textArtifactsMarkerOnly } from "@/lib/engines/adapters/current";
import { validateEngineResult } from "@/lib/engines/validation";
import type { EngineResult } from "@/lib/engines/types";
import { computeMetrics, errorCategory } from "@/lib/benchmarks/metrics";
import {
  BENCHMARK_VERSION,
  type BenchmarkEngine,
  type BenchmarkFixture,
  type BenchmarkRunResult,
} from "@/lib/benchmarks/types";

/**
 * Benchmark runner (Phase 71) — offline, deterministic, isolated.
 *
 * Runs one engine over one fixture, computes the metric set, and applies the
 * SAME production QualityGate + OutputValidator code uniformly to both
 * current and candidate engines (so quality verdicts are comparable). The
 * runner never touches `selectEngine()`, the live registry or any route.
 *
 * Results contain metrics, verdicts and reproducibility metadata only —
 * never document content (asserted by test).
 */

export async function runBenchmark(
  engine: BenchmarkEngine,
  fixture: BenchmarkFixture,
  options: { wallClockMs?: number; heapDeltaBytes?: number } = {},
): Promise<BenchmarkRunResult> {
  const startedAt = Date.now();
  const heapBefore = process.memoryUsage().heapUsed;

  let result: BenchmarkRunResult;
  try {
    const bytes = await fixture.build();
    const run = await engine.run({ name: `${fixture.id}.pdf`, bytes });

    // Uniform structural validation + quality assessment: the exact
    // production code paths, applied identically to every engine.
    const validationResult = validateEngineResult({
      artifacts: [...run.artifacts],
      engineId: engine.id,
      attempt: 1,
      durationMs: 0,
      warnings: [],
      validation: { status: "not-evaluated" },
    } as EngineResult);
    const outputBytes = run.artifacts.reduce(
      (total, artifact) => total + artifact.size,
      0,
    );
    const quality = assessConversionQuality(engine.conversion, {
      validation: validationResult.validation,
      meta: run.meta,
      artifactCount: run.artifacts.length,
      outputBytes,
      inputFileCount: 1,
      outputTextMarkerOnly: textArtifactsMarkerOnly(run.artifacts),
    });

    const metrics = computeMetrics({
      fixture,
      artifacts: run.artifacts,
      meta: run.meta,
    });
    if (options.heapDeltaBytes !== undefined) {
      metrics["performance.heapDeltaBytes"] = options.heapDeltaBytes;
    } else {
      metrics["performance.heapDeltaBytes"] =
        process.memoryUsage().heapUsed - heapBefore;
    }

    result = {
      benchmarkVersion: BENCHMARK_VERSION,
      fixtureVersion: fixture.version,
      fixtureId: fixture.id,
      engineId: engine.id,
      engineVersion: engine.version,
      conversion: engine.conversion,
      success: true,
      metrics: {
        ...metrics,
        "performance.wallClockMs": options.wallClockMs ?? Date.now() - startedAt,
      },
      quality: {
        state: quality.state,
        score: quality.score,
        checks: quality.checks.length,
      },
      runtime: {
        node: process.version,
        platform: process.platform,
        wallClockMs: options.wallClockMs ?? Date.now() - startedAt,
      },
    };
  } catch (error) {
    result = {
      benchmarkVersion: BENCHMARK_VERSION,
      fixtureVersion: fixture.version,
      fixtureId: fixture.id,
      engineId: engine.id,
      engineVersion: engine.version,
      conversion: engine.conversion,
      success: false,
      metrics: {
        "output.exists": false,
        "output.count": 0,
        "output.bytes": 0,
        "failure.errorCategory": errorCategory(error),
        "performance.wallClockMs": options.wallClockMs ?? Date.now() - startedAt,
      },
      error: { category: errorCategory(error) },
      runtime: {
        node: process.version,
        platform: process.platform,
        wallClockMs: options.wallClockMs ?? Date.now() - startedAt,
      },
    };
  }

  return result;
}

/** Strip timing noise so two runs of the same pair can be compared for
 * determinism (wall clock and heap deltas are measurements, not behavior). */
export function comparableMetrics(
  result: BenchmarkRunResult
): Record<string, number | boolean | string> {
  const rest = { ...result.metrics };
  delete rest["performance.wallClockMs"];
  delete rest["performance.heapDeltaBytes"];
  return rest;
}
