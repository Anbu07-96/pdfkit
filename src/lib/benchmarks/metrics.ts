import "server-only";

import type { BenchmarkFixture } from "@/lib/benchmarks/types";

/**
 * Benchmark metrics (Phase 71).
 *
 * Every metric is labeled OBJECTIVE (mechanically measurable, no judgement)
 * or HEURISTIC (an informative signal whose interpretation involves a
 * convention). No metric is called "fidelity" — fidelity claims require the
 * Stage 4 benchmark campaign on the full corpus.
 *
 * Metric ids (stable, machine-readable):
 *
 * | id | label | definition |
 * | --- | --- | --- |
 * | output.exists | OBJECTIVE | at least one artifact was produced |
 * | output.count | OBJECTIVE | number of artifacts |
 * | output.bytes | OBJECTIVE | total produced bytes |
 * | text.characterCount | OBJECTIVE | characters in text/* outputs |
 * | text.anchorPreservation | OBJECTIVE | planted synthetic anchors present in text output (0–1) |
 * | text.pageCoverage | OBJECTIVE | page markers found / expected pages (0–1) |
 * | text.columnOrderPreserved | OBJECTIVE* | left-anchor precedes its right-anchor per planted pair (0–1); *the pair convention is defined by the fixture, the index comparison is mechanical |
 * | table.rowsExtracted | OBJECTIVE | rows reported by the engine meta, when present |
 * | images.extracted | OBJECTIVE | images reported by the engine meta, when present |
 * | failure.errorCategory | OBJECTIVE | typed error code on failure ("NON_TYPED_ERROR" otherwise) |
 * | performance.wallClockMs | OBJECTIVE | measured wall time (measurement, not a quality claim) |
 * | performance.heapDeltaBytes | HEURISTIC | process.memoryUsage heap delta — noisy, indicative only |
 *
 * Proposed Stage 4 comparison thresholds for these metrics live in
 * docs/benchmark-plan.md as DRAFT — none are enforced here.
 */

/** Decode the text content of text/* artifacts (bounded by artifact size). */
function extractText(artifacts: readonly { mimeType: string; bytes: Uint8Array }[]): string {
  const decoder = new TextDecoder();
  let text = "";
  for (const artifact of artifacts) {
    if (artifact.mimeType.toLowerCase().startsWith("text/")) {
      text += decoder.decode(artifact.bytes);
    }
  }
  return text;
}

/** Count `--- Page N ---` markers in a text output (current convention). */
function countPageMarkers(text: string): number {
  const matches = text.match(/--- Page \d+ ---/g);
  return matches ? matches.length : 0;
}

export interface MetricComputationInput {
  readonly fixture: BenchmarkFixture;
  readonly artifacts: readonly { name: string; mimeType: string; size: number; bytes: Uint8Array }[];
  readonly meta?: Record<string, number | string>;
}

/** Compute the applicable metrics for one benchmark run. Never throws. */
export function computeMetrics({
  fixture,
  artifacts,
  meta,
}: MetricComputationInput): Record<string, number | boolean | string> {
  const metrics: Record<string, number | boolean | string> = {};

  metrics["output.exists"] = artifacts.length > 0;
  metrics["output.count"] = artifacts.length;
  metrics["output.bytes"] = artifacts.reduce(
    (total, artifact) => total + artifact.size,
    0,
  );

  const text = extractText(artifacts);
  if (artifacts.length > 0 && artifacts.some((a) => a.mimeType.toLowerCase().startsWith("text/"))) {
    metrics["text.characterCount"] = text.length;

    const anchors = fixture.expected.anchors;
    if (anchors.length > 0) {
      const preserved = anchors.filter((anchor) => text.includes(anchor)).length;
      metrics["text.anchorPreservation"] = preserved / anchors.length;
    }

    if (fixture.expected.pageCount > 0) {
      const markers = countPageMarkers(text);
      metrics["text.pageCoverage"] =
        markers === 0 ? 0 : Math.min(1, markers / fixture.expected.pageCount);
    }

    const pairs = fixture.expected.columnPairs;
    if (pairs && pairs.length > 0) {
      let ordered = 0;
      for (const [left, right] of pairs) {
        const leftIndex = text.indexOf(left);
        const rightIndex = text.indexOf(right);
        if (leftIndex >= 0 && rightIndex >= 0 && leftIndex < rightIndex) {
          ordered += 1;
        }
      }
      metrics["text.columnOrderPreserved"] = ordered / pairs.length;
    }
  }

  if (typeof meta?.rowsExtracted === "number") {
    metrics["table.rowsExtracted"] = meta.rowsExtracted;
  }
  if (typeof meta?.extractedImagesCount === "number") {
    metrics["images.extracted"] = meta.extractedImagesCount;
  }

  return metrics;
}

/** Categorise a benchmark failure by typed error code (codes only). */
export function errorCategory(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code.length > 0) return code;
  }
  return "NON_TYPED_ERROR";
}
