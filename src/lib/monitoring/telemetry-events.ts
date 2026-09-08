/**
 * Typed telemetry events (Phase 63, Step 2).
 *
 * The operational observability model. Every field is metadata chosen by
 * trusted server code (or strictly validated client beacons, marked below).
 *
 * PRIVACY CONTRACT — a telemetry event must NEVER contain:
 * - uploaded document contents or extracted text
 * - passwords, tokens, cookies or authentication secrets
 * - payment information
 * - raw file names or user identities (counts and bytes only)
 * - IP addresses or connection strings
 *
 * Events are metadata: what ran, for which plan tier, how long it took, how
 * many bytes moved, and which safe error category resulted.
 */

/** Safe plan tier label (never a user id). */
export type TelemetryTier = "anonymous" | "free" | "pro" | "business" | "other";

export type TelemetryEvent =
  /** A processing job was admitted and is starting. */
  | {
      type: "job_started";
      toolId: string;
      tier?: string;
      batchId?: string;
      requestId?: string;
      fileCount: number;
      inputBytes: number;
    }
  /** A processing job finished successfully. */
  | {
      type: "job_completed";
      toolId: string;
      tier?: string;
      batchId?: string;
      requestId?: string;
      durationMs: number;
      fileCount: number;
      inputBytes: number;
      outputBytes: number;
      /** Rendered/processed pages, when the processor reports them. */
      pages?: number;
      /** Extracted images, when the processor reports them. */
      images?: number;
    }
  /** A processing job failed validation or processing. */
  | {
      type: "job_failed";
      toolId: string;
      tier?: string;
      batchId?: string;
      requestId?: string;
      durationMs: number;
      fileCount: number;
      inputBytes: number;
      errorCode: string;
      errorCategory: string;
    }
  /** The quota preflight rejected the request before any work started. */
  | {
      type: "quota_rejected";
      toolId: string;
      tier: string;
      reason: string;
      requestedBytes?: number;
    }
  /** The IP rate limiter rejected the request. */
  | { type: "rate_limited"; retryAfterSeconds?: number }
  /** The request watchdog fired; the job keeps running privately. */
  | { type: "request_timeout"; toolId: string; requestId?: string; timeoutMs: number }
  /** The concurrency cap rejected the request (fail fast, no queue). */
  | { type: "server_busy"; toolId: string }
  /** A processing route produced its final HTTP response. */
  | {
      type: "http_response";
      toolId: string;
      requestId?: string;
      status: number;
      durationMs: number;
    }
  /*
   * Client-reported bulk batch lifecycle events (Phase 63). Sent by the
   * browser runner through the strictly-validated beacon endpoint. These are
   * UNTRUSTED aggregates used for UX telemetry only — never for
   * authorization, quota or security decisions.
   */
  | { type: "batch_started"; batchId: string; operation: string; fileCount: number }
  | {
      type: "batch_completed";
      batchId: string;
      operation: string;
      fileCount: number;
      succeeded: number;
      failed: number;
      skipped: number;
      cancelled: number;
      elapsedMs: number;
    }
  | {
      type: "batch_cancelled";
      batchId: string;
      operation: string;
      settledFiles: number;
      totalFiles: number;
    }
  | {
      type: "batch_budget_stopped";
      batchId: string;
      operation: string;
      reason: string;
      settledFiles: number;
      totalFiles: number;
    }
  | {
      type: "batch_quota_stopped";
      batchId: string;
      operation: string;
      settledFiles: number;
      totalFiles: number;
    };

/** All event type discriminants, for validation of client beacons. */
export const BATCH_LIFECYCLE_EVENT_TYPES = [
  "batch_started",
  "batch_completed",
  "batch_cancelled",
  "batch_budget_stopped",
  "batch_quota_stopped",
] as const;

export type BatchLifecycleEventType = (typeof BATCH_LIFECYCLE_EVENT_TYPES)[number];

/** Clamp a count-like number into a safe integer range (defensive). */
export function clampCount(value: number, max = 1_000_000): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(Math.floor(value), max);
}

/** Sanitize a free-form identifier for use as a metrics key. */
export function sanitizeMetricsKey(value: string, fallback = "other"): string {
  const cleaned = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(cleaned)) return fallback;
  return cleaned;
}
