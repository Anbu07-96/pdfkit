import "server-only";

import type { ConversionType } from "@/lib/engines/types";

/**
 * Benchmark foundation types (Phase 71) + controlled-execution types
 * (Phase 72).
 *
 * Isolated by construction: nothing under `src/lib/processing`, `src/app`,
 * `src/lib/hardening` or the engine router imports this directory — the
 * dependency direction is strictly benchmarks → production code, never the
 * reverse. An isolation test enforces this statically.
 *
 * The benchmark framework is deterministic, offline, privacy-safe and based
 * entirely on synthetic in-memory fixtures. It can compare the current
 * engine against a candidate engine WITHOUT touching `selectEngine()` or
 * the live registry.
 */

/** Bump when the harness or metric definitions change. */
export const BENCHMARK_VERSION = 2 as const;
/** Bump when the fixture corpus changes. */
export const FIXTURE_VERSION = 2 as const;

/** A produced document in benchmark terms (mirrors ProcessingArtifact). */
export interface BenchmarkArtifact {
  readonly name: string;
  readonly mimeType: string;
  readonly size: number;
  readonly bytes: Uint8Array;
}

/** What a benchmark engine produces for one input file. */
export interface BenchmarkEngineRun {
  readonly artifacts: readonly BenchmarkArtifact[];
  readonly meta?: Record<string, number | string>;
}

/**
 * A benchmark engine. The CURRENT production engines are wrapped through
 * their existing adapter objects (see engines/current-adapter.ts); candidate
 * engines implement this interface directly and are NEVER registered in the
 * live engine registry.
 */
export interface BenchmarkEngine {
  /** Stable engine id, e.g. "current-pdfium-text" or "candidate-pdfjs-text". */
  readonly id: string;
  /** Engine/adapter version string. */
  readonly version: string;
  /** The conversion this engine performs in benchmark terms. */
  readonly conversion: ConversionType;
  /** Run the conversion on one file. Throws on failure (typed or not). */
  run(file: { name: string; bytes: Uint8Array }): Promise<BenchmarkEngineRun>;
}

/** Ground truth for one table fixture: the exact cells in reading order. */
export interface TableGroundTruth {
  /** Rows of cell strings, row-major, in planted reading order. */
  readonly rows: readonly (readonly string[])[];
}

/** Expected page size in PDF units (ground truth for dimension checks). */
export interface PageDimensionGroundTruth {
  readonly width: number;
  readonly height: number;
}

/**
 * A synthetic, repo-owned fixture. `provenance` must state how the bytes are
 * produced; no downloaded or copyrighted documents are permitted anywhere in
 * the corpus. Anchors are synthetic tokens planted in the document so that
 * content preservation can be measured objectively without retaining or
 * exposing real content.
 *
 * Phase 72 adds explicit machine-readable provenance (`generator`,
 * `synthetic`, `copyright`) and explicit ground truth beyond page counts:
 * ordered anchors, expected tokens, unicode/symbol characters, blank pages,
 * table cells, image counts and page dimensions. Ground truth ALWAYS comes
 * from the fixture definition itself — never from one engine's output.
 */
export interface BenchmarkFixture {
  readonly id: string;
  readonly version: number;
  /** Corpus category, e.g. "text", "table", "multicolumn", "scanned". */
  readonly category: string;
  /** Machine-readable characteristic tags, e.g. ["unicode", "landscape"]. */
  readonly characteristics: readonly string[];
  /** What the fixture exists to measure. */
  readonly purpose: string;
  /** Which builder produced the bytes (machine-readable provenance). */
  readonly generator: string;
  /** Always true for this corpus: no fixture contains real-world content. */
  readonly synthetic: true;
  /** Copyright/provenance statement. */
  readonly copyright: string;
  /** How the bytes are produced (provenance / license statement). */
  readonly provenance: string;
  /** Builds the fixture bytes in memory. */
  build(): Promise<Uint8Array>;
  readonly expected: {
    /** Page count the document really has. */
    readonly pageCount: number;
    /** Synthetic anchor tokens that a faithful text conversion must carry. */
    readonly anchors: readonly string[];
    /**
     * Anchors in intended READING order (row-major, top-to-bottom). Used by
     * the reading-order metric; `anchors` may be in a different (e.g.
     * planted/draw) order.
     */
    readonly orderedAnchors?: readonly string[];
    /**
     * Ordered [left, right] anchor pairs for column fixtures: a faithful
     * reading order puts left before right for every pair.
     */
    readonly columnPairs?: readonly (readonly [string, string])[];
    /** Distinct non-anchor word tokens planted in the document. */
    readonly tokens?: readonly string[];
    /** Whitespace-normalized character count of all planted text. */
    readonly characterCount?: number;
    /** Canonical single-flow text (normalized comparison target). */
    readonly canonicalText?: string;
    /** Specific non-ASCII characters that must survive extraction. */
    readonly unicodeChars?: readonly string[];
    /** Specific symbol characters that must survive extraction. */
    readonly symbolChars?: readonly string[];
    /** 1-based pages that carry no extractable text (image-only). */
    readonly imageOnlyPages?: readonly number[];
    /** 1-based pages that are blank (planted empty). */
    readonly blankPages?: readonly number[];
    /** Rows a faithful table extraction should find, when planted. */
    readonly tableRowsExpected?: number;
    /** Exact planted table cells (ground truth for table metrics). */
    readonly table?: TableGroundTruth;
    /** Planted embedded image count, when images are planted. */
    readonly imageCount?: number;
    /** Expected page sizes (PDF units), in page order. */
    readonly pageDimensions?: readonly PageDimensionGroundTruth[];
    /** True when the fixture is meant to fail (failure-behavior metric). */
    readonly expectsFailure?: boolean;
  };
}

/** Machine-readable result of one engine run over one fixture. */
export interface BenchmarkRunResult {
  readonly benchmarkVersion: typeof BENCHMARK_VERSION;
  readonly fixtureVersion: number;
  readonly fixtureId: string;
  readonly engineId: string;
  readonly engineVersion: string;
  readonly conversion: ConversionType;
  readonly success: boolean;
  /**
   * Measured metrics (ids documented in metrics.ts). Numeric, boolean or
   * typed error-code string values only — never document content, names
   * beyond the fixture id, or paths.
   */
  readonly metrics: Record<string, number | boolean | string>;
  /** Uniformly applied QualityGate verdict (same code as production). */
  readonly quality?: {
    readonly state: string;
    readonly score: number;
    readonly checks: number;
  };
  /** Typed error category on failure — codes only, never content. */
  readonly error?: { readonly category: string };
  /** Reproducibility metadata. */
  readonly runtime: {
    readonly node: string;
    readonly platform: string;
    readonly wallClockMs: number;
  };
}

/* ------------------------------------------------------------------ */
/* Phase 72 — applicability, series and report types                    */
/* ------------------------------------------------------------------ */

/** Can the candidate meaningfully compete on a conversion at all? */
export type ApplicabilityStatus = "YES" | "PARTIAL" | "NO";

/** What kind of benchmark comparison is fair for this conversion? */
export type EvaluationScope = "direct" | "component" | "not-comparable";

/** One row of the Phase 72 applicability matrix (§2 of the phase spec). */
export interface ApplicabilityEntry {
  readonly conversion: ConversionType;
  /** Engine the live registry serves for this conversion today. */
  readonly currentEngine: string;
  readonly status: ApplicabilityStatus;
  readonly scope: EvaluationScope;
  /** Why this status holds (facts, not marketing). */
  readonly reason: string;
}

/** Aggregated timing statistics for one engine/fixture series. */
export interface TimingStats {
  readonly samples: number;
  readonly medianMs: number;
  readonly meanMs: number;
  readonly minMs: number;
  readonly maxMs: number;
  readonly stdDevMs: number;
  /** Only reported when the sample count permits (>= 8). */
  readonly p95Ms?: number;
}

/** A repeated-run series over one engine/fixture pair. */
export interface BenchmarkSeriesResult {
  readonly benchmarkVersion: typeof BENCHMARK_VERSION;
  readonly fixtureVersion: number;
  readonly fixtureId: string;
  readonly engineId: string;
  readonly engineVersion: string;
  readonly conversion: ConversionType;
  readonly success: boolean;
  /** Metrics of the median-timing run. */
  readonly metrics: Record<string, number | boolean | string>;
  /** True when every measured run produced identical comparable metrics. */
  readonly metricsStable: boolean;
  readonly quality?: {
    readonly state: string;
    readonly score: number;
    readonly checks: number;
  };
  readonly error?: { readonly category: string };
  readonly timing: TimingStats;
  /** Median heap delta across measured runs (HEURISTIC, indicative only). */
  readonly heapDeltaBytesMedian: number;
  /** Warm-up runs executed and excluded from measurement. */
  readonly warmupRuns: number;
  readonly measuredRuns: number;
  /** True when the per-case runtime budget stopped the series early. */
  readonly truncated: boolean;
}

/** One fixture compared across the applicable benchmark engines. */
export interface Phase72CaseResult {
  readonly fixtureId: string;
  readonly conversion: ConversionType;
  readonly scope: EvaluationScope;
  readonly runs: readonly BenchmarkSeriesResult[];
}

/** QualityGate correlation summary (diagnostic, never enforced). */
export interface QualityCorrelationGroup {
  readonly state: string;
  readonly engineId: string;
  readonly runs: number;
  /** Mean anchor preservation over successful runs where defined. */
  readonly meanAnchorPreservation?: number;
  /** Mean expected-token recall over successful runs where defined. */
  readonly meanTokenRecall?: number;
}

/** The complete machine-readable Phase 72 evidence artifact. */
export interface Phase72Report {
  readonly benchmarkVersion: typeof BENCHMARK_VERSION;
  readonly fixtureVersion: number;
  readonly generatedAt: string;
  readonly runtime: {
    readonly node: string;
    readonly platform: string;
    readonly cpuModel?: string;
  };
  readonly seriesConfig: {
    readonly warmupRuns: number;
    readonly minMeasuredRuns: number;
    readonly maxMeasuredRuns: number;
    readonly fastExtensionThresholdMs: number;
    readonly maxCaseWallClockMs: number;
  };
  readonly applicability: readonly ApplicabilityEntry[];
  readonly cases: readonly Phase72CaseResult[];
  readonly qualityCorrelation: readonly QualityCorrelationGroup[];
  /** Prose notes carry NO content — statuses and reasons only. */
  readonly notes: readonly string[];
}
