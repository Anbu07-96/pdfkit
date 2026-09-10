// @vitest-environment node
import { describe, expect, it } from "vitest";
import { median, runBenchmarkSeries, timingStats } from "@/lib/benchmarks/perf";
import { BENCHMARK_BOUNDS, assertSeriesConfigWithinBounds, BenchmarkBoundsError } from "@/lib/benchmarks/bounds";
import { getFixture } from "@/lib/benchmarks/fixtures";
import { currentEngineBenchmarkAdapter } from "@/lib/benchmarks/engines/current-adapter";
import type { BenchmarkEngine, BenchmarkEngineRun } from "@/lib/benchmarks/types";

/**
 * Phase 72 performance series tests (§11–§12, §26).
 *
 * Timing MATH is tested with synthetic samples — no test depends on real
 * millisecond values. Series BEHAVIOR (warm-up exclusion, run counts,
 * stability flag, budget truncation) is tested with stub engines and a
 * controlled real engine pair.
 */

describe("timing aggregation math", () => {
  it("median handles odd and even samples", () => {
    expect(median([5])).toBe(5);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(() => median([])).toThrow();
  });

  it("timingStats reports median/mean/min/max and sample stddev", () => {
    const stats = timingStats([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(stats.samples).toBe(8);
    expect(stats.medianMs).toBe(4.5);
    expect(stats.meanMs).toBe(5);
    expect(stats.minMs).toBe(2);
    expect(stats.maxMs).toBe(9);
    // Sample standard deviation (n-1) of the classic sample.
    expect(stats.stdDevMs).toBeCloseTo(2.138089935299395, 10);
    // 8 samples permit a p95.
    expect(stats.p95Ms).toBe(9);
  });

  it("p95 is omitted when the sample count does not permit it", () => {
    const stats = timingStats([1, 2, 3, 4, 5]);
    expect(stats.p95Ms).toBeUndefined();
    const single = timingStats([7]);
    expect(single.stdDevMs).toBe(0);
    expect(single.p95Ms).toBeUndefined();
  });

  it("throws on an empty sample instead of inventing numbers", () => {
    expect(() => timingStats([])).toThrow();
  });
});

/** A stub engine with deterministic output and call counting. */
function stubEngine(options: { id?: string; fail?: boolean; delayMs?: number } = {}) {
  let calls = 0;
  const engine: BenchmarkEngine & { calls: () => number } = {
    id: options.id ?? "stub-engine",
    version: "1.0.0",
    conversion: "pdf-to-text",
    calls: () => calls,
    async run(): Promise<BenchmarkEngineRun> {
      calls += 1;
      if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      if (options.fail) throw Object.assign(new Error("planned failure"), { code: "INVALID_PDF" });
      const bytes = new TextEncoder().encode(`--- Page 1 ---\nPDFKIT-ANCHOR-SINGLE`);
      return {
        artifacts: [{ name: "out.txt", mimeType: "text/plain; charset=utf-8", size: bytes.length, bytes }],
        meta: { pages: 1 },
      };
    },
  };
  return engine;
}

describe("series execution", () => {
  it("excludes warm-up runs from measurement and reports stable metrics", async () => {
    const engine = stubEngine();
    const series = await runBenchmarkSeries(engine, getFixture("F-01-text-single"), {
      warmupRuns: 1,
      measuredRuns: 3,
      maxMeasuredRuns: 3, // extension disabled for an exact call count
    });
    // 1 warm-up + 3 measured.
    expect(engine.calls()).toBe(4);
    expect(series.warmupRuns).toBe(1);
    expect(series.measuredRuns).toBe(3);
    expect(series.truncated).toBe(false);
    expect(series.success).toBe(true);
    expect(series.metricsStable).toBe(true);
    expect(series.timing.samples).toBe(3);
    expect(series.metrics["text.anchorPreservation"]).toBe(1);
    // Timing metrics are stripped from series metrics and live in `timing`.
    expect(series.metrics["performance.wallClockMs"]).toBeUndefined();
    expect(series.timing.medianMs).toBeGreaterThanOrEqual(0);
  });

  it("runs the same fixture bytes for every run (determinism precondition)", async () => {
    const engine = stubEngine();
    const fixture = getFixture("F-01-text-single");
    const bytesSeen: number[] = [];
    const spying: BenchmarkEngine = {
      ...engine,
      async run(file) {
        bytesSeen.push(file.bytes.length);
        return engine.run(file);
      },
    };
    await runBenchmarkSeries(spying, fixture, {
      warmupRuns: 0,
      measuredRuns: 3,
      maxMeasuredRuns: 3,
    });
    expect(bytesSeen.length).toBe(3);
    expect(new Set(bytesSeen).size).toBe(1);
    // The original fixture bytes are never detached (PDF.js gets copies).
    const original = await fixture.build();
    expect(original.byteLength).toBe(bytesSeen[0]);
  });

  it("extends fast cases toward the maximum run count", async () => {
    const engine = stubEngine();
    const series = await runBenchmarkSeries(engine, getFixture("F-01-text-single"), {
      warmupRuns: 0,
      measuredRuns: 2,
      maxMeasuredRuns: 4,
      fastExtensionThresholdMs: 10_000, // everything is "fast"
      maxCaseWallClockMs: 60_000,
    });
    expect(series.measuredRuns).toBe(4);
    expect(series.truncated).toBe(false);
    expect(series.timing.samples).toBe(4);
  });

  it("stops early when the per-case budget is exhausted (truncated, never empty)", async () => {
    const engine = stubEngine({ delayMs: 30 });
    const series = await runBenchmarkSeries(engine, getFixture("F-01-text-single"), {
      warmupRuns: 0,
      measuredRuns: 5,
      maxCaseWallClockMs: 0, // budget exhausted immediately
    });
    expect(series.measuredRuns).toBeGreaterThanOrEqual(1);
    expect(series.measuredRuns).toBeLessThan(5);
    expect(series.truncated).toBe(true);
  });

  it("records failure series with typed categories and stable metrics", async () => {
    const engine = stubEngine({ fail: true });
    const series = await runBenchmarkSeries(engine, getFixture("F-01-text-single"), {
      warmupRuns: 1,
      measuredRuns: 3,
      maxMeasuredRuns: 3,
    });
    expect(series.success).toBe(false);
    expect(series.error?.category).toBe("INVALID_PDF");
    expect(series.metrics["failure.benchmarkCategory"]).toBe("malformed-input");
    expect(series.metricsStable).toBe(true);
    expect(series.timing.samples).toBe(3);
  });

  it("enforces the iteration bounds", () => {
    expect(() =>
      assertSeriesConfigWithinBounds({ warmupRuns: 0, measuredRuns: 0 }),
    ).toThrow(BenchmarkBoundsError);
    expect(() =>
      assertSeriesConfigWithinBounds({
        warmupRuns: BENCHMARK_BOUNDS.maxWarmupRuns + 1,
        measuredRuns: 5,
      }),
    ).toThrow(BenchmarkBoundsError);
    expect(() =>
      assertSeriesConfigWithinBounds({
        warmupRuns: 1,
        measuredRuns: BENCHMARK_BOUNDS.maxMeasuredRuns + 1,
      }),
    ).toThrow(BenchmarkBoundsError);
    expect(() =>
      runBenchmarkSeries(stubEngine(), getFixture("F-01-text-single"), {
        measuredRuns: BENCHMARK_BOUNDS.maxMeasuredRuns + 1,
      }),
    ).rejects.toThrow();
  });

  it("aggregates a real engine pair fairly (same warm-up, same run count)", async () => {
    const fixture = getFixture("F-01-text-single");
    const current = await runBenchmarkSeries(
      currentEngineBenchmarkAdapter("pdf-to-text"),
      fixture,
      { warmupRuns: 1, measuredRuns: 3, maxMeasuredRuns: 3 },
    );
    const candidateEngine = (await import("@/lib/benchmarks/engines/pdfjs-candidate"))
      .createPdfjsTextCandidate();
    const candidate = await runBenchmarkSeries(candidateEngine, fixture, {
      warmupRuns: 1,
      measuredRuns: 3,
      maxMeasuredRuns: 3,
    });
    for (const series of [current, candidate]) {
      expect(series.warmupRuns).toBe(1);
      expect(series.measuredRuns).toBe(3);
      expect(series.metricsStable).toBe(true);
      expect(series.timing.samples).toBe(3);
    }
  }, 60_000);
});
