import "server-only";

import { runBenchmark } from "@/lib/benchmarks/runner";
import { comparableMetrics } from "@/lib/benchmarks/runner";
import { BENCHMARK_BOUNDS, assertSeriesConfigWithinBounds } from "@/lib/benchmarks/bounds";
import type {
  BenchmarkEngine,
  BenchmarkFixture,
  BenchmarkRunResult,
  BenchmarkSeriesResult,
  TimingStats,
} from "@/lib/benchmarks/types";

/**
 * Repeated-run benchmark series (Phase 72 §11–§12).
 *
 * Fairness rules, enforced structurally:
 *
 * - WARM-UP FIRST: every engine gets the same number of warm-up runs
 *   (excluded from measurement) before any timed run, so neither a cold
 *   current engine nor a cold candidate is compared against a warm one.
 * - FIXED RUN COUNTS: at least `minMeasuredRuns` measured runs (default 5);
 *   fast cases extend toward `maxMeasuredRuns` (default 10). One
 *   unusually fast run is never used as evidence — medians are.
 * - SAME BYTES: the fixture is built ONCE per series and reused for every
 *   run, so run-to-run differences are engine behavior, not fixture
 *   generation noise.
 * - BUDGET: a per-case wall-clock budget stops the series early (recorded
 *   as `truncated: true`) instead of running forever.
 *
 * Timing aggregation is a pure function (`timingStats`) so tests can lock
 * the math without depending on real millisecond values.
 */

/** Percentile rank reported only when the sample count permits it. */
const P95_MIN_SAMPLES = 8;

/** Median of a sorted-able numeric sample (lower middle for even counts). */
export function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error("median of an empty sample");
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Aggregated timing statistics for one series. Pure and deterministic. */
export function timingStats(samples: readonly number[]): TimingStats {
  if (samples.length === 0) throw new Error("timing stats of an empty sample");
  const sorted = [...samples].sort((a, b) => a - b);
  const mean = samples.reduce((total, value) => total + value, 0) / samples.length;
  const variance =
    samples.length > 1
      ? samples.reduce((total, value) => total + (value - mean) ** 2, 0) /
        (samples.length - 1)
      : 0;
  return {
    samples: samples.length,
    medianMs: median(samples),
    meanMs: mean,
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
    stdDevMs: Math.sqrt(variance),
    ...(samples.length >= P95_MIN_SAMPLES
      ? { p95Ms: sorted[Math.ceil(0.95 * samples.length) - 1] }
      : {}),
  };
}

/** A fixture whose bytes are built once and reused for every series run. */
function memoizedFixture(fixture: BenchmarkFixture): {
  fixture: BenchmarkFixture;
  build: () => Promise<Uint8Array>;
} {
  let cached: Uint8Array | null = null;
  const build = async (): Promise<Uint8Array> => {
    if (cached === null) {
      cached = await fixture.build();
      // Defensive copy per use: PDF.js detaches buffers, and every engine
      // must see the exact same bytes.
      return cached.slice();
    }
    return cached.slice();
  };
  return {
    fixture: { ...fixture, build },
    build,
  };
}

export interface SeriesOptions {
  /** Warm-up runs excluded from measurement (default 1). */
  warmupRuns?: number;
  /** Measured runs (default: the bounds minimum, 5). */
  measuredRuns?: number;
  /** Upper bound for fast-case extension (default: the bounds maximum, 10). */
  maxMeasuredRuns?: number;
  /** Median at or below this extends fast cases (default 50 ms). */
  fastExtensionThresholdMs?: number;
  /** Per-case wall-clock budget (default 30 s). */
  maxCaseWallClockMs?: number;
  /** Injectable clock for deterministic budget tests. */
  now?: () => number;
}

/** Pick the run closest to the median wall-clock time (stable: first wins). */
function medianRunIndex(runs: readonly BenchmarkRunResult[]): number {
  const med = median(runs.map((run) => run.runtime.wallClockMs));
  let result = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < runs.length; index += 1) {
    const distance = Math.abs(runs[index].runtime.wallClockMs - med);
    if (distance < bestDistance) {
      bestDistance = distance;
      result = index;
    }
  }
  return result;
}

/** Execute one engine over one fixture as a warm-up + measured series. */
export async function runBenchmarkSeries(
  engine: BenchmarkEngine,
  fixture: BenchmarkFixture,
  options: SeriesOptions = {},
): Promise<BenchmarkSeriesResult> {
  const warmupRuns = options.warmupRuns ?? 1;
  const minMeasured = options.measuredRuns ?? BENCHMARK_BOUNDS.minMeasuredRuns;
  const maxMeasured = options.maxMeasuredRuns ?? BENCHMARK_BOUNDS.maxMeasuredRuns;
  const fastThreshold = options.fastExtensionThresholdMs ?? BENCHMARK_BOUNDS.fastExtensionThresholdMs;
  const budgetMs = options.maxCaseWallClockMs ?? BENCHMARK_BOUNDS.maxCaseWallClockMs;
  const now = options.now ?? Date.now;

  assertSeriesConfigWithinBounds({ warmupRuns, measuredRuns: minMeasured });
  if (maxMeasured < minMeasured || maxMeasured > BENCHMARK_BOUNDS.maxMeasuredRuns) {
    throw new Error("maxMeasuredRuns is below the measured runs or above the bounds");
  }

  const { fixture: cachedFixture } = memoizedFixture(fixture);

  // Warm-up: same engine, same bytes, excluded from every measurement.
  for (let index = 0; index < warmupRuns; index += 1) {
    await runBenchmark(engine, cachedFixture);
  }

  const startedAt = now();
  const runs: BenchmarkRunResult[] = [];
  let truncated = false;

  const executeUpTo = async (count: number): Promise<void> => {
    while (runs.length < count) {
      runs.push(await runBenchmark(engine, cachedFixture));
      if (now() - startedAt > budgetMs && runs.length >= 1) {
        truncated = runs.length < count;
        break;
      }
    }
  };

  await executeUpTo(minMeasured);

  // Fast cases extend toward the maximum when the budget allows.
  if (
    !truncated &&
    runs.length >= minMeasured &&
    median(runs.map((run) => run.runtime.wallClockMs)) <= fastThreshold &&
    maxMeasured > minMeasured
  ) {
    await executeUpTo(maxMeasured);
  }

  if (runs.length === 0) {
    throw new Error("series produced no measured runs");
  }

  const wallClocks = runs.map((run) => run.runtime.wallClockMs);
  const heapDeltas = runs
    .map((run) => run.metrics["performance.heapDeltaBytes"])
    .filter((value): value is number => typeof value === "number");
  const medianIndex = medianRunIndex(runs);
  const medianRun = runs[medianIndex];

  const serialized = runs.map((run) => JSON.stringify(comparableMetrics(run)));
  const metricsStable = new Set(serialized).size === 1;

  return {
    benchmarkVersion: medianRun.benchmarkVersion,
    fixtureVersion: medianRun.fixtureVersion,
    fixtureId: medianRun.fixtureId,
    engineId: medianRun.engineId,
    engineVersion: medianRun.engineVersion,
    conversion: medianRun.conversion,
    success: medianRun.success,
    metrics: comparableMetrics(medianRun),
    metricsStable,
    ...(medianRun.quality ? { quality: medianRun.quality } : {}),
    ...(medianRun.error ? { error: medianRun.error } : {}),
    timing: timingStats(wallClocks),
    heapDeltaBytesMedian: heapDeltas.length > 0 ? median(heapDeltas) : 0,
    warmupRuns,
    measuredRuns: runs.length,
    truncated,
  };
}
