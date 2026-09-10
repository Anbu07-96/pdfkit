import "server-only";

import type { ConversionType } from "@/lib/engines/types";

/**
 * Benchmark foundation types (Phase 71).
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
export const BENCHMARK_VERSION = 1 as const;
/** Bump when the fixture corpus changes. */
export const FIXTURE_VERSION = 1 as const;

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

/**
 * A synthetic, repo-owned fixture. `provenance` must state how the bytes are
 * produced; no downloaded or copyrighted documents are permitted anywhere in
 * the corpus. Anchors are synthetic tokens planted in the document so that
 * content preservation can be measured objectively without retaining or
 * exposing real content.
 */
export interface BenchmarkFixture {
  readonly id: string;
  readonly version: number;
  /** Corpus category, e.g. "text", "table", "multicolumn", "scanned". */
  readonly category: string;
  /** What the fixture exists to measure. */
  readonly purpose: string;
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
     * Ordered [left, right] anchor pairs for column fixtures: a faithful
     * reading order puts left before right for every pair.
     */
    readonly columnPairs?: readonly (readonly [string, string])[];
    /** 1-based pages that carry no extractable text (image-only). */
    readonly imageOnlyPages?: readonly number[];
    /** Rows a faithful table extraction should find, when planted. */
    readonly tableRowsExpected?: number;
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
   * typed error-code string values only — never document content.
   * only — never document content, names beyond the fixture id, or paths.
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
