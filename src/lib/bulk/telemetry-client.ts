/**
 * Bulk batch lifecycle telemetry client (Phase 63).
 *
 * The browser is the only place that knows when a client-orchestrated batch
 * starts, finishes, is cancelled or stops on a budget — the server only sees
 * per-file jobs. This module reports those batch-level transitions to
 * `POST /api/bulk/telemetry` as strictly-validated, metadata-only beacons.
 *
 * Rules:
 * - fire-and-forget: failures are swallowed, the UI never waits or depends
 *   on the beacon;
 * - metadata only: operation, batch id and counts — never file names,
 *   document contents or anything user-identifying;
 * - at most a handful of beacons per batch (start + one terminal event),
 *   never per file, so batch pacing and rate limits are unaffected;
 * - nothing is persisted client-side (no localStorage/sessionStorage).
 */

export interface BatchStartedBeacon {
  event: "batch_started";
  operation: string;
  batchId: string;
  fileCount: number;
}

export interface BatchCompletedBeacon {
  event: "batch_completed";
  operation: string;
  batchId: string;
  fileCount: number;
  succeeded: number;
  failed: number;
  skipped: number;
  cancelled: number;
  elapsedMs: number;
}

export interface BatchStoppedBeacon {
  event: "batch_cancelled" | "batch_budget_stopped" | "batch_quota_stopped";
  operation: string;
  batchId: string;
  settledFiles: number;
  totalFiles: number;
  /** Only for budget stops: "pages" | "output" | "images". */
  reason?: string;
}

export type BatchTelemetryBeacon =
  | BatchStartedBeacon
  | BatchCompletedBeacon
  | BatchStoppedBeacon;

/** Send one lifecycle beacon. Never throws, never blocks. */
export function sendBatchTelemetryBeacon(beacon: BatchTelemetryBeacon): void {
  try {
    const promise = fetch("/api/bulk/telemetry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(beacon),
      keepalive: true,
    });
    // Swallow every failure: telemetry must never surface in the UI.
    promise.catch(() => {});
  } catch {
    // fetch itself threw (offline, ad-blocker): ignore.
  }
}
