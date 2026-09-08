import "server-only";

import { logStructuredEvent, logStructuredJob } from "@/lib/monitoring/logger";
import type { TelemetryEvent } from "@/lib/monitoring/telemetry-events";
import { clampCount } from "@/lib/monitoring/telemetry-events";
import type { MetricsProvider } from "@/lib/monitoring/metrics/types";
import { InMemoryMetricsProvider } from "@/lib/monitoring/metrics/in-memory-provider";

/**
 * Telemetry facade (Phase 63, Steps 2–4).
 *
 * The single pipeline operational telemetry flows through:
 *
 *     processing code  →  recordTelemetryEvent()  →  ┬→ metrics provider (bounded aggregates)
 *                                                     └→ existing structured logger (log pipeline)
 *
 * - Processing code depends on this facade only — never on a provider — so a
 *   PostgreSQL/Redis/Sentry-backed provider can be added later without
 *   touching processing code.
 * - Every event is also emitted as a structured log line (same event names
 *   as Phase 62, so existing log pipelines keep working), EXCEPT the
 *   high-frequency `http_response` and `job_started` events which are
 *   metrics-only to avoid doubling per-request log volume.
 * - Recording must never break processing: provider errors are swallowed.
 * - Privacy: see the contract in `telemetry-events.ts`. This facade
 *   defensively clamps counts/durations; callers supply trusted metadata.
 */

let provider: MetricsProvider | undefined;

/**
 * The active metrics provider. `PDFKIT_METRICS_PROVIDER` selects an
 * implementation; today only "in-memory" exists (the default). Unknown
 * values fall back to in-memory with a warning — telemetry fails open,
 * processing never does.
 */
export function getMetricsProvider(): MetricsProvider {
  if (provider) return provider;
  const configured = (process.env.PDFKIT_METRICS_PROVIDER ?? "in-memory").trim();
  if (configured !== "in-memory") {
    console.warn(
      `[telemetry] Unknown PDFKIT_METRICS_PROVIDER "${configured}"; using in-memory. ` +
        "No other provider is implemented yet (Phase 63).",
    );
  }
  provider = new InMemoryMetricsProvider();
  return provider;
}

/** Replace the provider (tests). */
export function setMetricsProviderForTests(next: MetricsProvider | undefined): void {
  provider = next;
}

/** Record one telemetry event. Never throws. */
export function recordTelemetryEvent(event: TelemetryEvent): void {
  try {
    getMetricsProvider().record(event, new Date());
  } catch {
    // Swallowed by design: metrics must not break processing.
  }
  try {
    emitLogLine(event);
  } catch {
    // Also swallowed: logging must not break processing either.
  }
}

/**
 * Which events also produce a structured log line. Phase 62 log shapes are
 * preserved exactly; new high-frequency events stay metrics-only.
 */
function emitLogLine(event: TelemetryEvent): void {
  switch (event.type) {
    case "job_started":
    case "http_response":
      // Metrics-only: one extra line per request would double log volume;
      // `job_completed` (which Phase 62 already logs) covers per-request logs.
      return;
    case "job_completed":
    case "job_failed": {
      logStructuredJob({
        toolId: event.toolId,
        outcome: event.type === "job_completed" ? "succeeded" : "failed",
        fileCount: clampCount(event.fileCount),
        totalBytes: clampCount(event.inputBytes, 2 ** 40),
        durationMs: clampCount(event.durationMs, 86_400_000),
        ...(event.type === "job_failed"
          ? { code: event.errorCode, errorCategory: event.errorCategory }
          : {}),
        ...(event.tier ? { tier: event.tier } : {}),
        ...(event.batchId ? { batchId: event.batchId } : {}),
        ...(event.requestId ? { requestId: event.requestId } : {}),
      });
      return;
    }
    case "quota_rejected":
      logStructuredEvent("quota_rejected", {
        toolId: event.toolId,
        tier: event.tier,
        reason: event.reason,
        ...(event.requestedBytes !== undefined
          ? { requestedBytes: clampCount(event.requestedBytes, 2 ** 40) }
          : {}),
      });
      return;
    case "rate_limited":
      logStructuredEvent("rate_limited", {
        ...(event.retryAfterSeconds !== undefined
          ? { retryAfterSeconds: clampCount(event.retryAfterSeconds, 86_400) }
          : {}),
      });
      return;
    case "request_timeout":
      logStructuredEvent("request_timeout", {
        toolId: event.toolId,
        timeoutMs: clampCount(event.timeoutMs, 600_000),
        ...(event.requestId ? { requestId: event.requestId } : {}),
      });
      return;
    case "server_busy":
      logStructuredEvent("server_busy", { toolId: event.toolId });
      return;
    case "batch_started":
      logStructuredEvent("batch_started", {
        batchId: event.batchId,
        operation: event.operation,
        fileCount: clampCount(event.fileCount, 10_000),
        source: "client",
      });
      return;
    case "batch_completed":
      logStructuredEvent("batch_completed", {
        batchId: event.batchId,
        operation: event.operation,
        fileCount: clampCount(event.fileCount, 10_000),
        succeeded: clampCount(event.succeeded, 10_000),
        failed: clampCount(event.failed, 10_000),
        skipped: clampCount(event.skipped, 10_000),
        cancelled: clampCount(event.cancelled, 10_000),
        elapsedMs: clampCount(event.elapsedMs, 86_400_000),
        source: "client",
      });
      return;
    case "batch_cancelled":
    case "batch_budget_stopped":
    case "batch_quota_stopped":
      logStructuredEvent(event.type, {
        batchId: event.batchId,
        operation: event.operation,
        settledFiles: clampCount(event.settledFiles, 10_000),
        totalFiles: clampCount(event.totalFiles, 10_000),
        ...(event.type === "batch_budget_stopped" ? { reason: event.reason } : {}),
        source: "client",
      });
      return;
  }
}

/** Take a metrics snapshot (admin endpoint / diagnostics). */
export function getTelemetrySnapshot(
  context: Parameters<MetricsProvider["snapshot"]>[0],
): ReturnType<MetricsProvider["snapshot"]> {
  return getMetricsProvider().snapshot(context);
}

/** Reset telemetry aggregates (tests and internal tooling only). */
export function resetTelemetry(): void {
  getMetricsProvider().reset();
}
