import "server-only";

import type {
  ProcessingArtifact,
  ProcessingContext,
  ProcessingRequest,
  ProcessorInputRules,
} from "@/lib/processing/contract";

/**
 * Conversion engine abstraction — public types (Phase 67, Stage 1).
 *
 * This layer sits between the processing registry and the conversion
 * implementations PDFKit already ships:
 *
 * ```text
 * ToolProcessor (processing registry entry)
 *      ↓
 * ConversionRouter        — src/lib/engines/router.ts
 *      ↓
 * EngineRegistry          — src/lib/engines/registry.ts
 *      ↓
 * current engine adapter  — src/lib/engines/adapters/current.ts
 *      ↓
 * existing processing implementation (processors/*, unchanged)
 * ```
 *
 * Stage 1 is deliberately minimal: there is exactly **one** registered engine
 * per conversion type, and it is the current implementation. No second
 * engine, no retry, no fallback and no quality scoring exists in this stage;
 * the types below reserve the shape those later stages will need so the
 * layer does not have to be redesigned when they arrive. Everything marked
 * PLANNED in this file is documented, not implemented.
 */

/**
 * The conversion types the engine layer serves.
 *
 * These are the eleven AVAILABLE tools whose job is a document *conversion*
 * (content transformation between formats, powered by an engine that could
 * plausibly have alternatives). Page-structure tools (merge, split, rotate,
 * watermark, …) and security tools stay direct processors: no alternative
 * engine is contemplated for them, so routing them would be ceremony without
 * benefit. A test enforces that every id here is an AVAILABLE catalog tool
 * with a registered processor.
 */
export const CONVERSION_TYPES = [
  "compare-documents",
  "compress-pdf",
  "extract-images",
  "extract-tables",
  "images-to-pdf",
  "pdf-to-excel",
  "pdf-to-jpg",
  "pdf-to-png",
  "pdf-to-text",
  "pdf-to-word",
  "png-to-pdf",
] as const;

export type ConversionType = (typeof CONVERSION_TYPES)[number];

/** What an engine can do. Informational in Stage 1 (capability inspection). */
export type EngineCapability =
  | "text-extraction"
  | "rasterization"
  | "image-encoding"
  | "image-decoding"
  | "document-generation"
  | "table-heuristics"
  | "text-comparison"
  | "lossless-optimization";

/**
 * Where an engine executes. Every engine PDFKit ships today runs in-process
 * (WASM/JS libraries inside the Node process). `child-process` (isolated
 * native binaries) and `remote-service` (external APIs) are PLANNED and
 * require an explicit security and licensing review before any engine uses
 * them.
 */
export type EngineExecutionClass =
  | "in-process"
  | "child-process"
  | "remote-service";

/**
 * What an engine costs to run. Everything today is local and free;
 * `metered`/`subscription` exist so future commercial engines are declared
 * honestly rather than smuggled in.
 */
export type EngineCostClass = "local" | "metered" | "subscription";

/** Static description of an engine. Data only — never behaviour. */
export interface EngineDescriptor {
  /** Stable, unique engine id, e.g. "current-pdfium-docx". */
  readonly id: string;
  /** Short human-readable name (documentation and inspection only). */
  readonly name: string;
  /** The conversion this engine serves. */
  readonly conversionType: ConversionType;
  /** The catalog tool this engine currently powers. */
  readonly toolId: string;
  /** What the engine can do. Informational in Stage 1. */
  readonly capabilities: readonly EngineCapability[];
  /** How and where the engine executes. */
  readonly executionClass: EngineExecutionClass;
  /** Cost characteristics. */
  readonly costClass: EngineCostClass;
  /** Licence summary of the underlying libraries (informational). */
  readonly license: string;
  /** Version of this adapter within the abstraction layer. */
  readonly version: string;
  /** Whether the engine may be routed to. */
  readonly available: boolean;
  /** Why the engine is unavailable, when it is not. */
  readonly unavailableReason?: string;
}

/**
 * What an engine is asked to do.
 *
 * Stage 1 deliberately reuses `ProcessingRequest` unchanged. Current-engine
 * adapters delegate to the existing processors, and handing them the very
 * same object guarantees identical behaviour — no field stripping, no
 * copying, no second parse. A narrower shape is PLANNED only if a future
 * engine genuinely needs less (and would then be constructed by the router).
 */
export type EngineRequest<TOptions = Record<string, unknown>> =
  ProcessingRequest<TOptions>;

/** A non-fatal note about a produced output. Always empty in Stage 1. */
export interface EngineWarning {
  readonly code: string;
  readonly message: string;
}

/**
 * Validation state of an engine's output.
 *
 * Stage 1 never evaluates output quality: every result carries
 * `not-evaluated`. `passed`/`failed` are PLANNED for the OutputValidator /
 * QualityGate stages; they are typed now so those stages extend rather than
 * redesign this layer.
 */
export type OutputValidationState =
  | { readonly status: "not-evaluated" }
  | { readonly status: "passed"; readonly checks: readonly string[] }
  | { readonly status: "failed"; readonly checks: readonly string[] };

/**
 * A successful engine run: the produced documents (same contract as a
 * `ProcessingSuccess`) plus the engine-layer facts later stages need.
 */
export interface EngineResult {
  /** Produced documents, in output order. */
  readonly artifacts: ProcessingArtifact[];
  /** Preferred ZIP name when several artifacts are bundled together. */
  readonly bundleName?: string;
  /** Safe, non-identifying meta from the underlying implementation. */
  readonly meta?: Record<string, number | string>;
  /** Which engine produced this result. */
  readonly engineId: string;
  /**
   * 1-based attempt number. Always 1 in Stage 1 — no retry exists, so this
   * is an honest fact, not a placeholder.
   */
  readonly attempt: number;
  /** Wall-clock duration of the engine run, in milliseconds. */
  readonly durationMs: number;
  /** Non-fatal notes about the output. Always empty in Stage 1. */
  readonly warnings: readonly EngineWarning[];
  /** Quality/validation verdict. Always `not-evaluated` in Stage 1. */
  readonly validation: OutputValidationState;
}

/**
 * Typed representation of an engine failure, for future retry and fallback
 * decisions. PLANNED — Stage 4.
 *
 * Stage 1 never constructs this type. Failures propagate as the original
 * `ProcessingError` instances, untouched, so error semantics are identical to
 * the direct-processor path. The type exists so later stages can add
 * classification and fallback without redesigning the layer.
 */
export interface EngineFailure {
  /** The engine that failed. */
  readonly engineId: string;
  /** The processing error code (from `ProcessingErrorCode`). */
  readonly code: string;
  /** The safe, user-facing message. */
  readonly message: string;
  /** Optional safe details. */
  readonly details?: readonly string[];
}

/** The interface every conversion engine implements. */
export interface ConversionEngine<TOptions = Record<string, unknown>> {
  readonly descriptor: EngineDescriptor;
  /**
   * Input rules for this engine. Current-engine adapters borrow these from
   * the underlying processor (never redefined), so request validation is
   * byte-identical to the direct path.
   */
  readonly input: ProcessorInputRules;
  /**
   * Run the conversion.
   *
   * Stage 1: throws `ProcessingError` exactly like the underlying processor
   * does. The adapter performs no catching, classification or wrapping —
   * failure semantics are the existing ones.
   */
  run(
    request: EngineRequest<TOptions>,
    context: ProcessingContext,
  ): Promise<EngineResult>;
}
