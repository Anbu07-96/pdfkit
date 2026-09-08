import "server-only";

import type { TelemetryEvent } from "@/lib/monitoring/telemetry-events";

/**
 * Provider-neutral metrics interface (Phase 63, Step 4).
 *
 * Processing code records typed telemetry events through the facade in
 * `src/lib/monitoring/telemetry.ts`; it never touches a provider directly.
 * A provider turns those events into bounded, queryable aggregates.
 *
 * Contract for every implementation:
 * - `record` must never throw (telemetry must not break processing) and must
 *   never block the caller for longer than microseconds.
 * - Storage must be strictly bounded: fixed-size buffers, fixed key sets and
 *   clamped counters only. No unbounded event store.
 * - `snapshot` must be safe to expose to an authenticated operator: no user
 *   identities, no IPs, no file names, no document data — aggregates only.
 */

/** Percentile/summary statistics over a bounded window of durations. */
export interface DurationStats {
  count: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  minMs: number;
  maxMs: number;
}

/** Environment facts supplied by the caller (keeps the provider dependency-free). */
export interface SnapshotContext {
  /** Currently running processing jobs in this process. */
  activeJobs?: number;
  /** Resident set size in bytes, when available. */
  rssBytes?: number;
  /** V8 heap in use, in bytes, when available. */
  heapUsedBytes?: number;
}

/**
 * The full operational snapshot (Phase 63, Step 3). Answers traffic,
 * processing, bulk, error, resource and quota questions from bounded
 * aggregates only.
 */
export interface TelemetrySnapshot {
  schemaVersion: 1;
  /** Sanitized deployment/environment identifier (never a secret). */
  environment: string;
  /** When this provider started aggregating (ISO). */
  startedAt: string;
  /** When the snapshot was taken (ISO). */
  generatedAt: string;
  traffic: {
    /** Requests per minute, oldest first, covering the last 60 minutes. */
    requestsPerMinute: number[];
    /** Requests per hour, oldest first, covering the last 24 hours. */
    requestsPerHour: number[];
    requestsTotal: number;
  };
  jobs: {
    started: number;
    completed: number;
    failed: number;
    /** completed / (completed + failed); null before the first settled job. */
    successRate: number | null;
    duration: DurationStats;
  };
  bulk: {
    batchesStarted: number;
    batchesCompleted: number;
    batchesCancelled: number;
    batchesBudgetStopped: number;
    batchesQuotaStopped: number;
    /** Files observed server-side (jobs carrying a batch id). */
    filesProcessed: number;
    filesFailed: number;
    /** Client-reported averages — honest about their source. */
    avgFilesPerBatch: number | null;
    avgBatchDurationMs: number | null;
    source: "client-reported+server-correlated";
  };
  errors: {
    /** Known tool ids only; anything unexpected folds into "other". */
    byTool: Record<string, { failed: number; total: number }>;
    byCode: Record<string, number>;
    byCategory: Record<string, number>;
  };
  statuses: {
    ok2xx: number;
    err4xx: number;
    count429: number;
    count503: number;
    count504: number;
  };
  bytes: {
    inputTotal: number;
    outputTotal: number;
    inputAvg: number;
    outputAvg: number;
  };
  quota: {
    rejectionsByTier: Record<string, number>;
    rejectionsTotal: number;
  };
  system: {
    activeJobs: number;
    rssBytes: number | null;
    heapUsedBytes: number | null;
    nodeVersion: string;
  };
}

/** A metrics provider. See the module comment for the contract. */
export interface MetricsProvider {
  readonly name: string;
  record(event: TelemetryEvent, timestamp: Date): void;
  snapshot(context: SnapshotContext): TelemetrySnapshot;
  /** Reset all aggregates (tests and tooling only). */
  reset(): void;
}
