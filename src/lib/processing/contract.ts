/**
 * Processing boundary — the contract every PDFKit tool implementation honours.
 *
 * PDFKit's layering:
 *
 *   Presentation (app/, components/)
 *        ↓
 *   Application logic (lib/tools, lib/upload)
 *        ↓
 *   API (app/api/tools/<tool>/route.ts)
 *        ↓
 *   Processing service (lib/processing/service.ts)
 *        ↓
 *   Tool processor (lib/processing/processors/*)
 *        ↓
 *   PDF library (pdf-lib)
 *
 * Rules:
 * - Processors are **server only**. Nothing under `components/` may import a
 *   processor; the browser talks to the API route instead.
 * - Processors receive already-validated input and return bytes. They never
 *   touch HTTP, `FormData`, React or the filesystem.
 * - Expected failures are raised as `ProcessingError` (see `errors.ts`) so the
 *   service can turn them into a structured, safe response.
 */

import "server-only";

import type { ProcessingLimits } from "@/lib/processing/limits";

/** A single validated input document handed to a processor. */
export interface ProcessingInputFile {
  /** Stable id for this file within the request (used for ordering/reporting). */
  id: string;
  /** Original file name as supplied by the client (never trusted for typing). */
  name: string;
  /** Size in bytes of {@link bytes}. */
  size: number;
  /** MIME type reported by the client. Advisory only — content is verified. */
  mimeType: string;
  /** The file content, held in memory for the duration of the request. */
  bytes: Uint8Array;
}

export interface ProcessingRequest<TOptions = Record<string, unknown>> {
  toolId: string;
  /** Input files **in the exact order the user arranged them**. */
  files: ProcessingInputFile[];
  options?: TOptions;
}

/** A produced document. Bytes are streamed straight back in the response. */
export interface ProcessingArtifact {
  name: string;
  mimeType: string;
  size: number;
  bytes: Uint8Array;
}

export interface ProcessingSuccess {
  status: "succeeded";
  /**
   * Produced documents, in output order. A tool may return several (Split PDF);
   * the HTTP layer decides how to deliver them — one file is streamed directly,
   * many are bundled into a ZIP.
   */
  artifacts: ProcessingArtifact[];
  /** Preferred ZIP name when several artifacts are bundled together. */
  bundleName?: string;
  /** Safe, non-identifying diagnostics (counts, durations, page totals). */
  meta?: Record<string, number | string>;
}

export interface ProcessingFailure {
  status: "failed";
  error: {
    code: string;
    message: string;
    details?: string[];
  };
}

export type ProcessingResult = ProcessingSuccess | ProcessingFailure;

/** Per-processor input rules, enforced before any parsing happens. */
export interface ProcessorInputRules {
  /** Minimum number of files the tool needs to do its job. */
  minFiles: number;
  /** Maximum number of files this tool accepts, when lower than the global cap. */
  maxFiles?: number;
  /** Accepted lower-case file extensions, e.g. `[".pdf"]`. */
  extensions: readonly string[];
  /** Accepted MIME types (advisory: content is verified separately). */
  mimeTypes: readonly string[];
}

/** Runtime context handed to a processor by the service. */
export interface ProcessingContext {
  /** Effective limits for this request, including `maxOutputs`. */
  limits: ProcessingLimits;
}

/** The single interface every tool implementation provides. */
export interface ToolProcessor<TOptions = Record<string, unknown>> {
  /** Must match a tool id in the catalog (`src/lib/tools`). */
  readonly toolId: string;
  readonly input: ProcessorInputRules;
  /**
   * Runs the tool. Implementations throw `ProcessingError` for expected
   * failures (invalid PDF, unsupported input); the service converts those into
   * a `ProcessingFailure`.
   */
  process(
    request: ProcessingRequest<TOptions>,
    context: ProcessingContext,
  ): Promise<ProcessingSuccess>;
}
