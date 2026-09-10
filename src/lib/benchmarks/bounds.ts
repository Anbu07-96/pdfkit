import "server-only";

import type { BenchmarkFixture } from "@/lib/benchmarks/types";
import { FIXTURE_VERSION } from "@/lib/benchmarks/types";

/**
 * Phase 72 resource bounds (§14 of the phase spec).
 *
 * All benchmark execution stays inside these limits. They are deliberately
 * generous enough for evidence and tight enough that no fixture can turn
 * into a decompression bomb or a resource-exhaustion payload:
 *
 * - fixtures are small (bytes) and bounded (pages);
 * - every case runs a fixed, small number of iterations;
 * - a per-case wall-clock budget stops a series early (recorded as
 *   `truncated`) instead of letting it run forever;
 * - the PDF.js loading task is always destroyed (enforced by test with an
 *   injected mock loader);
 * - no child processes are used anywhere in the benchmark path.
 */

export const BENCHMARK_BOUNDS = {
  /** Maximum generated fixture size. */
  maxFixtureBytes: 2_000_000,
  /** Maximum fixture page count. */
  maxFixturePages: 60,
  /** Maximum warm-up runs per case (excluded from measurement). */
  maxWarmupRuns: 2,
  /** Minimum measured runs per case (when the budget allows). */
  minMeasuredRuns: 5,
  /** Maximum measured runs per case (fast cases extend toward this). */
  maxMeasuredRuns: 10,
  /** A case whose median run is at or below this is "fast" and may extend
   * its run count toward maxMeasuredRuns. */
  fastExtensionThresholdMs: 50,
  /** Total wall-clock budget per engine/fixture case. */
  maxCaseWallClockMs: 30_000,
} as const;

/** Thrown (typed) when a fixture or configuration violates the bounds. */
export class BenchmarkBoundsError extends Error {
  readonly code = "BENCHMARK_BOUNDS_VIOLATION";
  constructor(message: string) {
    super(message);
    this.name = "BenchmarkBoundsError";
  }
}

/** Validate the static definition of a fixture (before any bytes exist). */
export function validateFixtureDefinition(fixture: BenchmarkFixture): string[] {
  const problems: string[] = [];
  if (fixture.version !== FIXTURE_VERSION) {
    problems.push(`version ${fixture.version} != corpus version ${FIXTURE_VERSION}`);
  }
  if (fixture.synthetic !== true) problems.push("synthetic must be true");
  for (const field of ["purpose", "generator", "copyright", "provenance"] as const) {
    if (!fixture[field] || fixture[field].trim().length === 0) {
      problems.push(`missing ${field}`);
    }
  }
  if (!Number.isInteger(fixture.expected.pageCount) || fixture.expected.pageCount < 0) {
    problems.push("pageCount must be a non-negative integer");
  }
  if (fixture.expected.pageCount > BENCHMARK_BOUNDS.maxFixturePages) {
    problems.push(`pageCount ${fixture.expected.pageCount} exceeds the corpus bound`);
  }
  const anchors = fixture.expected.anchors;
  if (new Set(anchors).size !== anchors.length) {
    problems.push("anchors must be unique");
  }
  const ordered = fixture.expected.orderedAnchors;
  if (ordered) {
    if (new Set(ordered).size !== ordered.length) {
      problems.push("orderedAnchors must be unique");
    }
    const anchorSet = new Set(anchors);
    for (const anchor of ordered) {
      if (!anchorSet.has(anchor)) {
        problems.push(`orderedAnchor ${anchor} is not in expected anchors`);
      }
    }
  }
  const table = fixture.expected.table;
  if (table) {
    if (table.rows.length === 0) problems.push("table ground truth has no rows");
    const width = table.rows[0]?.length ?? 0;
    if (table.rows.some((row) => row.length !== width)) {
      problems.push("table ground truth rows are not rectangular");
    }
    const cellSet = new Set(table.rows.flat());
    if (cellSet.size !== table.rows.flat().length) {
      problems.push("table ground truth cells must be unique");
    }
    const anchorSet = new Set(anchors);
    for (const cell of cellSet) {
      if (!anchorSet.has(cell)) {
        problems.push(`table cell ${cell} is not listed in expected anchors`);
      }
    }
  }
  if (
    fixture.expected.tableRowsExpected !== undefined &&
    table &&
    fixture.expected.tableRowsExpected !== table.rows.length
  ) {
    problems.push("tableRowsExpected disagrees with the table ground truth");
  }
  return problems;
}

/** Validate generated fixture bytes against the resource bounds. */
export function assertFixtureBytesWithinBounds(
  fixture: BenchmarkFixture,
  bytes: Uint8Array,
): void {
  if (bytes.length > BENCHMARK_BOUNDS.maxFixtureBytes) {
    throw new BenchmarkBoundsError(
      `${fixture.id}: ${bytes.length} bytes exceeds the ${BENCHMARK_BOUNDS.maxFixtureBytes}-byte bound`,
    );
  }
  if (
    fixture.expected.pageCount > 0 &&
    fixture.expected.pageCount > BENCHMARK_BOUNDS.maxFixturePages
  ) {
    throw new BenchmarkBoundsError(
      `${fixture.id}: ${fixture.expected.pageCount} pages exceeds the ${BENCHMARK_BOUNDS.maxFixturePages}-page bound`,
    );
  }
}

/** Validate a series configuration against the iteration bounds. */
export function assertSeriesConfigWithinBounds(config: {
  warmupRuns: number;
  measuredRuns: number;
}): void {
  if (config.warmupRuns < 0 || config.warmupRuns > BENCHMARK_BOUNDS.maxWarmupRuns) {
    throw new BenchmarkBoundsError("warm-up runs outside the bounds");
  }
  if (
    config.measuredRuns < 1 ||
    config.measuredRuns > BENCHMARK_BOUNDS.maxMeasuredRuns
  ) {
    throw new BenchmarkBoundsError("measured runs outside the bounds");
  }
}
