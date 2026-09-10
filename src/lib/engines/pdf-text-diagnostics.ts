import "server-only";

import type { EngineResult } from "@/lib/engines/types";
import { ProcessingError } from "@/lib/processing/errors";
import { recordTelemetryEvent } from "@/lib/monitoring/telemetry";

/**
 * PDF → text engine diagnostics (Phase 74) — evidence, not routing.
 *
 * Phase 74's question: after launch, how often does the current pdfium
 * engine hit genuine TECHNICAL failures on real documents, of which kinds,
 * and (measured separately, by manual replay) would pdfjs have recovered
 * the same bytes? The answer feeds a FUTURE fallback decision; it never
 * influences this one. This module classifies and buckets what an engine
 * run already produced and hands a privacy-safe event to the Phase 63
 * telemetry facade. It has no other effect:
 *
 * - **Behavior-neutral by construction**: both entry points swallow every
 *   error, including their own; processing output, error codes, engine
 *   selection, QualityGate verdicts and limits are untouched.
 * - **Privacy-safe by construction**: the event carries ONLY fixed-
 *   vocabulary labels and buckets — no bytes, no text, no filenames, no
 *   metadata, no exception messages, no stacks, no identifiers. Raw
 *   durations/bytes/pages never leave this module unbucketed.
 * - **Bounded**: one event per engine run; the attempt model stays 1, so at
 *   most one event per pdf-to-text request. Buckets are closed sets, so
 *   metrics cardinality is fixed (no high-cardinality attack surface).
 *
 * The engine diagnostic kill switch mirrors the Phase 73 engine gate's
 * shape but fails the OTHER way, deliberately: engine SELECTION fails
 * closed (a typo must never change processing), diagnostics fail OPEN (a
 * typo must never silently destroy the evidence record — diagnostics
 * cannot affect processing, so the safer direction is to keep measuring).
 *
 * See docs/pdf-text-evidence.md for the full evidence contract.
 */

/** The environment variable name (names only, never values, in messages). */
export const PDF_TEXT_DIAGNOSTICS_VARIABLE = "PDFKIT_PDF_TEXT_DIAGNOSTICS";

/** Values that disable the engine diagnostics. */
const DISABLE_VALUES = new Set(["off", "0", "false", "disabled"]);

/** Approved value spellings (anything else warns in environment validation). */
export const PDF_TEXT_DIAGNOSTICS_APPROVED_VALUES = [
  "on",
  "off",
  "1",
  "0",
  "true",
  "false",
  "disabled",
] as const;

/** Outcome classification (Phase 74 §3). */
export type PdfTextRunOutcome = "success" | "technical_failure" | "validation_failure";

/**
 * Classify a typed processing error code from a pdf-to-text engine run.
 *
 * - `VALIDATION_ERROR` — the request was rejected before any PDF parsing
 *   (missing file, invalid options). NOT an engine failure: excluded from
 *   the technical-failure denominator.
 * - everything else — the run reached the engine stage and failed there
 *   (`INVALID_PDF`, `ENCRYPTED_PDF`, `TOO_MANY_OUTPUTS`,
 *   `PROCESSING_ERROR`, `INTERNAL_ERROR`, …). A technical failure.
 */
export function classifyPdfTextErrorCode(code: string): "technical_failure" | "validation_failure" {
  return code === "VALIDATION_ERROR" ? "validation_failure" : "technical_failure";
}

/** Duration buckets (Phase 74 §15). Closed set, sanitize-metrics-safe. */
const DURATION_BUCKETS = ["lt-100ms", "100-500ms", "500ms-1s", "1-5s", "gt-5s"] as const;

/** Total input size buckets. Closed set. */
const SIZE_BUCKETS = ["0-100kb", "100kb-1mb", "1mb-5mb", "5mb-10mb", "gt-10mb"] as const;

const KB = 1024;
const MB = 1024 * 1024;

export function bucketDurationMs(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) return DURATION_BUCKETS[0];
  if (durationMs < 100) return "lt-100ms";
  if (durationMs < 500) return "100-500ms";
  if (durationMs < 1_000) return "500ms-1s";
  if (durationMs < 5_000) return "1-5s";
  return "gt-5s";
}

export function bucketInputBytes(totalBytes: number): string {
  if (!Number.isFinite(totalBytes) || totalBytes < 0) return SIZE_BUCKETS[0];
  if (totalBytes < 100 * KB) return "0-100kb";
  if (totalBytes < MB) return "100kb-1mb";
  if (totalBytes < 5 * MB) return "1mb-5mb";
  if (totalBytes < 10 * MB) return "5mb-10mb";
  return "gt-10mb";
}

export function bucketPageCount(pageCount: number | undefined): string {
  if (pageCount === undefined || !Number.isFinite(pageCount) || pageCount < 1) {
    return "unknown";
  }
  if (pageCount === 1) return "1";
  if (pageCount <= 5) return "2-5";
  if (pageCount <= 20) return "6-20";
  if (pageCount <= 60) return "21-60";
  return "gt-60";
}

/**
 * Whether engine diagnostics are enabled. Enabled by default; disabled only
 * by an explicit off value (see the module comment for why this direction
 * is deliberate). Read per call — no caching, so a kill-switch flip applies
 * to subsequent runs deterministically within a process.
 */
export function isPdfTextDiagnosticsEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const normalized = env[PDF_TEXT_DIAGNOSTICS_VARIABLE]?.trim().toLowerCase();
  return !(normalized !== undefined && DISABLE_VALUES.has(normalized));
}

/** The bounded failure code for an arbitrary thrown value. */
function failureCodeOf(error: unknown): string {
  // Typed processing errors carry a closed-vocabulary code. Anything else
  // (a raw library exception, an internal bug) is recorded as the static
  // INTERNAL_ERROR label — the message and stack NEVER enter telemetry.
  if (error instanceof ProcessingError) return error.code;
  return "INTERNAL_ERROR";
}

/**
 * The structural slice of an engine request the diagnostics read: file byte
 * lengths, nothing else. (A minimal structural type — not EngineRequest —
 * so generic engine adapters can hand their request over without variance
 * friction, and so this module provably touches nothing else.)
 */
export interface PdfTextDiagnosticsRequestSlice {
  readonly files: readonly { readonly bytes?: Uint8Array }[];
}

function totalInputBytes(request: PdfTextDiagnosticsRequestSlice): number {
  return request.files.reduce((total, file) => total + (file.bytes?.length ?? 0), 0);
}

/** A quality/validation label that is guaranteed closed-vocabulary. */
function closedLabel(value: string | undefined, allowed: readonly string[]): string | undefined {
  return value !== undefined && (allowed as readonly string[]).includes(value)
    ? value
    : undefined;
}

const QUALITY_STATES = ["healthy", "suspicious", "insufficient", "not-evaluated"] as const;
const VALIDATION_STATUSES = ["passed", "failed", "not-evaluated"] as const;

/**
 * Record one successful pdf-to-text engine run. Never throws; never alters
 * the result it is handed.
 */
export function recordPdfTextEngineSuccess(input: {
  engineId: string;
  request: PdfTextDiagnosticsRequestSlice;
  result: EngineResult;
  durationMs: number;
}): void {
  try {
    if (!isPdfTextDiagnosticsEnabled()) return;
    const pages = input.result.meta?.pages;
    recordTelemetryEvent({
      type: "pdf_text_engine_run",
      engineId: input.engineId,
      outcome: "success",
      ...(closedLabel(input.result.quality?.state, QUALITY_STATES)
        ? { qualityState: input.result.quality?.state }
        : {}),
      ...(closedLabel(input.result.validation?.status, VALIDATION_STATUSES)
        ? { validationStatus: input.result.validation?.status }
        : {}),
      durationBucket: bucketDurationMs(input.durationMs),
      inputSizeBucket: bucketInputBytes(totalInputBytes(input.request)),
      pageCountBucket: bucketPageCount(
        typeof pages === "number" ? pages : undefined,
      ),
    });
  } catch {
    // Diagnostics must never break processing — swallowed by design.
  }
}

/**
 * Record one failed pdf-to-text engine run. Never throws; never alters the
 * error it is handed (the original error propagates to the caller
 * unchanged either way).
 */
export function recordPdfTextEngineFailure(input: {
  engineId: string;
  request: PdfTextDiagnosticsRequestSlice;
  error: unknown;
  durationMs: number;
}): void {
  try {
    if (!isPdfTextDiagnosticsEnabled()) return;
    const code = failureCodeOf(input.error);
    recordTelemetryEvent({
      type: "pdf_text_engine_run",
      engineId: input.engineId,
      outcome: classifyPdfTextErrorCode(code),
      failureCode: code,
      durationBucket: bucketDurationMs(input.durationMs),
      inputSizeBucket: bucketInputBytes(totalInputBytes(input.request)),
      pageCountBucket: "unknown",
    });
  } catch {
    // Diagnostics must never break processing — swallowed by design.
  }
}
