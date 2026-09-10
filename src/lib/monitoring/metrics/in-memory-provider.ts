import "server-only";

import type { TelemetryEvent } from "@/lib/monitoring/telemetry-events";
import { clampCount, sanitizeMetricsKey } from "@/lib/monitoring/telemetry-events";
import type {
  DurationStats,
  MetricsProvider,
  SnapshotContext,
  TelemetrySnapshot,
} from "@/lib/monitoring/metrics/types";

/**
 * Bounded in-memory metrics provider (Phase 63, Step 3).
 *
 * Everything here is structurally bounded:
 * - job durations: a fixed 4,096-entry ring buffer (percentiles over the
 *   most recent window — not all history);
 * - request traffic: fixed 61-entry minute ring and 25-entry hour ring;
 * - by-key maps (tool/code/category/tier): sanitized keys, hard size caps,
 *   unknown keys fold into "other";
 * - counters: plain monotonic numbers.
 *
 * There is no event store: raw events are never retained, only aggregates.
 * The provider keeps no imports beyond the event types so it can never form
 * a module cycle with processing code.
 */

const DURATION_RING_SIZE = 4_096;
const MINUTE_RING_SIZE = 61; // current minute + last 60
const HOUR_RING_SIZE = 25; // current hour + last 24
const MAX_MAP_KEYS = 128;

/** Fixed-cardinality tier counters (telemetry tiers are a known set). */
const TIER_KEYS = ["anonymous", "free", "pro", "business", "other"] as const;

interface Bucket {
  /** Absolute bucket index (minutes or hours since epoch). */
  index: number;
  count: number;
}

function newBuckets(size: number): Bucket[] {
  return Array.from({ length: size }, () => ({ index: -1, count: 0 }));
}

/** Increment a bucket ring for `now`, rotating stale slots. */
function bump(ring: Bucket[], bucketIndex: number): void {
  for (const slot of ring) {
    if (slot.index === bucketIndex) {
      slot.count += 1;
      return;
    }
  }
  // No slot for this bucket yet: reuse the stalest (smallest index) slot.
  let oldest = ring[0];
  for (const slot of ring) {
    if (slot.index < oldest.index) oldest = slot;
  }
  oldest.index = bucketIndex;
  oldest.count = 1;
}

/** Read the ring oldest-first, including only buckets >= `sinceIndex`. */
function readBuckets(ring: Bucket[], sinceIndex: number): number[] {
  const live = ring.filter((slot) => slot.index >= sinceIndex);
  live.sort((a, b) => a.index - b.index);
  return live.map((slot) => slot.count);
}

/** A fixed-capacity key→counter map that folds overflow into "other". */
class CappedCounters {
  private readonly counts = new Map<string, number>();

  constructor(private readonly cap: number = MAX_MAP_KEYS) {}

  bump(key: string): void {
    const safe = sanitizeMetricsKey(key);
    if (this.counts.has(safe)) {
      this.counts.set(safe, this.counts.get(safe)! + 1);
      return;
    }
    if (this.counts.size >= this.cap) {
      this.counts.set("other", (this.counts.get("other") ?? 0) + 1);
      return;
    }
    this.counts.set(safe, 1);
  }

  has(key: string): boolean {
    return this.counts.has(sanitizeMetricsKey(key));
  }

  get(key: string): number {
    return this.counts.get(sanitizeMetricsKey(key)) ?? 0;
  }

  entries(): Record<string, number> {
    return Object.fromEntries(this.counts);
  }

  reset(): void {
    this.counts.clear();
  }
}

interface ToolStats {
  total: number;
  failed: number;
}

class CappedToolStats {
  private readonly stats = new Map<string, ToolStats>();

  constructor(private readonly cap: number = MAX_MAP_KEYS) {}

  private entry(toolId: string): ToolStats | null {
    const safe = sanitizeMetricsKey(toolId);
    let entry = this.stats.get(safe);
    if (!entry) {
      if (this.stats.size >= this.cap) return null; // fold into "other"
      entry = { total: 0, failed: 0 };
      this.stats.set(safe, entry);
    }
    return entry;
  }

  record(toolId: string, failed: boolean): void {
    const entry = this.entry(toolId);
    if (entry) {
      entry.total += 1;
      if (failed) entry.failed += 1;
      return;
    }
    const other = this.entry("other")!;
    other.total += 1;
    if (failed) other.failed += 1;
  }

  entries(): Record<string, { failed: number; total: number }> {
    return Object.fromEntries(this.stats);
  }

  reset(): void {
    this.stats.clear();
  }
}

interface PdfTextEngineStats {
  runs: number;
  success: number;
  technicalFailures: number;
  validationFailures: number;
}

/**
 * Per-engine pdf-to-text diagnostic counters (Phase 74). The engine set is
 * closed (2 engines), but the same capped-fold-into-"other" discipline as
 * tool stats applies so a hostile label can never grow the map.
 */
class CappedPdfTextEngineStats {
  private readonly stats = new Map<string, PdfTextEngineStats>();

  constructor(private readonly cap: number = 8) {}

  record(
    engineId: string,
    outcome: "success" | "technical_failure" | "validation_failure",
  ): void {
    const safe = sanitizeMetricsKey(engineId);
    let entry = this.stats.get(safe);
    if (!entry) {
      if (this.stats.size >= this.cap) {
        entry = this.stats.get("other") ?? {
          runs: 0,
          success: 0,
          technicalFailures: 0,
          validationFailures: 0,
        };
        this.stats.set("other", entry);
      } else {
        entry = { runs: 0, success: 0, technicalFailures: 0, validationFailures: 0 };
        this.stats.set(safe, entry);
      }
    }
    entry.runs += 1;
    if (outcome === "success") entry.success += 1;
    else if (outcome === "technical_failure") entry.technicalFailures += 1;
    else entry.validationFailures += 1;
  }

  entries(): Record<string, PdfTextEngineStats> {
    return Object.fromEntries(this.stats);
  }

  reset(): void {
    this.stats.clear();
  }
}

export class InMemoryMetricsProvider implements MetricsProvider {
  readonly name = "in-memory";

  private startedAt = new Date();

  // Traffic
  private minuteRing = newBuckets(MINUTE_RING_SIZE);
  private hourRing = newBuckets(HOUR_RING_SIZE);
  private requestsTotal = 0;

  // Jobs
  private jobsStarted = 0;
  private jobsCompleted = 0;
  private jobsFailed = 0;
  private durations = new Float64Array(DURATION_RING_SIZE);
  private durationCount = 0;
  private durationWrite = 0;
  private durationSum = 0;

  // Bulk (server-correlated)
  private bulkFilesProcessed = 0;
  private bulkFilesFailed = 0;

  // Bulk (client-reported)
  private batchesStarted = 0;
  private batchesCompleted = 0;
  private batchesCancelled = 0;
  private batchesBudgetStopped = 0;
  private batchesQuotaStopped = 0;
  private batchFilesSum = 0;
  private batchDurationSum = 0;

  // Errors
  private byTool = new CappedToolStats();
  private byCode = new CappedCounters();
  private byCategory = new CappedCounters();

  // HTTP statuses
  private ok2xx = 0;
  private err4xx = 0;
  private count429 = 0;
  private count503 = 0;
  private count504 = 0;

  // Bytes
  private inputTotal = 0;
  private outputTotal = 0;

  // Quota
  private rejectionsByTier = new CappedCounters();

  // PDF → text engine diagnostics (Phase 74)
  private pdfTextByEngine = new CappedPdfTextEngineStats();
  private pdfTextFailureCodes = new CappedCounters();
  private pdfTextQualityStates = new CappedCounters();
  private pdfTextValidationStatuses = new CappedCounters();
  private pdfTextDurationBuckets = new CappedCounters();
  private pdfTextInputSizeBuckets = new CappedCounters();
  private pdfTextPageCountBuckets = new CappedCounters();
  private pdfTextEligibleRuns = 0;
  private pdfTextTechnicalFailures = 0;

  record(event: TelemetryEvent, timestamp: Date): void {
    try {
      this.apply(event, timestamp);
    } catch {
      // Telemetry must never break the caller.
    }
  }

  private apply(event: TelemetryEvent, timestamp: Date): void {
    switch (event.type) {
      case "job_started": {
        this.jobsStarted += 1;
        this.byTool.record(event.toolId, false);
        if (event.inputBytes > 0) this.inputTotal += clampCount(event.inputBytes, 2 ** 40);
        break;
      }
      case "job_completed": {
        this.jobsCompleted += 1;
        this.pushDuration(event.durationMs);
        this.byTool.record(event.toolId, false);
        this.outputTotal += clampCount(event.outputBytes, 2 ** 40);
        if (event.batchId) this.bulkFilesProcessed += 1;
        break;
      }
      case "job_failed": {
        this.jobsFailed += 1;
        this.pushDuration(event.durationMs);
        this.byTool.record(event.toolId, true);
        this.byCode.bump(event.errorCode);
        this.byCategory.bump(event.errorCategory);
        if (event.batchId) this.bulkFilesFailed += 1;
        break;
      }
      case "quota_rejected": {
        this.rejectionsByTier.bump(event.tier);
        this.byCode.bump("QUOTA_EXCEEDED");
        this.byCategory.bump("daily-quota");
        break;
      }
      case "rate_limited": {
        this.byCode.bump("TOO_MANY_REQUESTS");
        this.byCategory.bump("rate-limited");
        break;
      }
      case "request_timeout": {
        this.byCode.bump("REQUEST_TIMEOUT");
        this.byCategory.bump("timeout");
        break;
      }
      case "server_busy": {
        this.byCode.bump("SERVER_BUSY");
        this.byCategory.bump("server-busy");
        break;
      }
      case "http_response": {
        this.requestsTotal += 1;
        bump(this.minuteRing, Math.floor(timestamp.getTime() / 60_000));
        bump(this.hourRing, Math.floor(timestamp.getTime() / 3_600_000));
        const status = clampCount(event.status, 599);
        if (status >= 200 && status < 300) this.ok2xx += 1;
        else if (status >= 400 && status < 500) this.err4xx += 1;
        if (status === 429) this.count429 += 1;
        if (status === 503) this.count503 += 1;
        if (status === 504) this.count504 += 1;
        break;
      }
      case "batch_started": {
        this.batchesStarted += 1;
        this.batchFilesSum += clampCount(event.fileCount, 10_000);
        break;
      }
      case "batch_completed": {
        this.batchesCompleted += 1;
        this.batchDurationSum += clampCount(event.elapsedMs, 86_400_000);
        break;
      }
      case "batch_cancelled": {
        this.batchesCancelled += 1;
        break;
      }
      case "batch_budget_stopped": {
        this.batchesBudgetStopped += 1;
        break;
      }
      case "batch_quota_stopped": {
        this.batchesQuotaStopped += 1;
        break;
      }
      case "pdf_text_engine_run": {
        // Phase 74: bounded aggregates over closed-vocabulary labels.
        // Raw values were already bucketed before the event existed.
        this.pdfTextByEngine.record(event.engineId, event.outcome);
        this.pdfTextDurationBuckets.bump(event.durationBucket);
        this.pdfTextInputSizeBuckets.bump(event.inputSizeBucket);
        this.pdfTextPageCountBuckets.bump(event.pageCountBucket);
        if (event.outcome !== "success") {
          this.pdfTextFailureCodes.bump(event.failureCode ?? "unknown");
          if (event.outcome === "technical_failure") {
            this.pdfTextTechnicalFailures += 1;
          }
        } else {
          if (event.qualityState !== undefined) {
            this.pdfTextQualityStates.bump(event.qualityState);
          }
          if (event.validationStatus !== undefined) {
            this.pdfTextValidationStatuses.bump(event.validationStatus);
          }
        }
        // §9 denominator: eligible = reached the engine stage = success +
        // technical failures. Validation failures are excluded.
        if (event.outcome !== "validation_failure") {
          this.pdfTextEligibleRuns += 1;
        }
        break;
      }
    }
  }

  private pushDuration(durationMs: number): void {
    const value =
      Number.isFinite(durationMs) && durationMs > 0 ? Math.min(durationMs, 86_400_000) : 0;
    this.durations[this.durationWrite] = value;
    this.durationWrite = (this.durationWrite + 1) % DURATION_RING_SIZE;
    this.durationCount = Math.min(this.durationCount + 1, DURATION_RING_SIZE);
    this.durationSum += value;
  }

  private durationStats(): DurationStats {
    if (this.durationCount === 0) {
      return {
        count: 0,
        avgMs: 0,
        p50Ms: 0,
        p95Ms: 0,
        p99Ms: 0,
        minMs: 0,
        maxMs: 0,
      };
    }
    // Copy the live window (oldest first) and sort for percentiles.
    const start =
      this.durationCount < DURATION_RING_SIZE ? 0 : this.durationWrite;
    const window: number[] = [];
    for (let i = 0; i < this.durationCount; i += 1) {
      window.push(this.durations[(start + i) % DURATION_RING_SIZE]);
    }
    const sorted = [...window].sort((a, b) => a - b);
    const percentile = (fraction: number) => {
      const index = Math.min(
        sorted.length - 1,
        Math.floor(fraction * (sorted.length - 1)),
      );
      return sorted[index];
    };
    return {
      count: this.durationCount,
      avgMs: Math.round((this.durationSum / this.durationCount) * 100) / 100,
      p50Ms: percentile(0.5),
      p95Ms: percentile(0.95),
      p99Ms: percentile(0.99),
      minMs: sorted[0],
      maxMs: sorted[sorted.length - 1],
    };
  }

  snapshot(context: SnapshotContext): TelemetrySnapshot {
    const now = Date.now();
    const settledJobs = this.jobsCompleted + this.jobsFailed;
    return {
      schemaVersion: 1,
      environment: readEnvironment(),
      startedAt: this.startedAt.toISOString(),
      generatedAt: new Date(now).toISOString(),
      traffic: {
        requestsPerMinute: readBuckets(this.minuteRing, Math.floor(now / 60_000) - 60),
        requestsPerHour: readBuckets(this.hourRing, Math.floor(now / 3_600_000) - 24),
        requestsTotal: this.requestsTotal,
      },
      jobs: {
        started: this.jobsStarted,
        completed: this.jobsCompleted,
        failed: this.jobsFailed,
        successRate: settledJobs === 0 ? null : this.jobsCompleted / settledJobs,
        duration: this.durationStats(),
      },
      bulk: {
        batchesStarted: this.batchesStarted,
        batchesCompleted: this.batchesCompleted,
        batchesCancelled: this.batchesCancelled,
        batchesBudgetStopped: this.batchesBudgetStopped,
        batchesQuotaStopped: this.batchesQuotaStopped,
        filesProcessed: this.bulkFilesProcessed,
        filesFailed: this.bulkFilesFailed,
        avgFilesPerBatch:
          this.batchesStarted === 0
            ? null
            : Math.round((this.batchFilesSum / this.batchesStarted) * 100) / 100,
        avgBatchDurationMs:
          this.batchesCompleted === 0
            ? null
            : Math.round(this.batchDurationSum / this.batchesCompleted),
        source: "client-reported+server-correlated",
      },
      errors: {
        byTool: this.byTool.entries(),
        byCode: this.byCode.entries(),
        byCategory: this.byCategory.entries(),
      },
      statuses: {
        ok2xx: this.ok2xx,
        err4xx: this.err4xx,
        count429: this.count429,
        count503: this.count503,
        count504: this.count504,
      },
      bytes: {
        inputTotal: this.inputTotal,
        outputTotal: this.outputTotal,
        inputAvg: this.jobsStarted === 0 ? 0 : this.inputTotal / this.jobsStarted,
        outputAvg: this.jobsCompleted === 0 ? 0 : this.outputTotal / this.jobsCompleted,
      },
      quota: {
        rejectionsByTier: Object.fromEntries(
          TIER_KEYS.map((tier) => [tier, this.rejectionsByTier.get(tier)]),
        ),
        rejectionsTotal:
          this.rejectionsByTier.get("anonymous") +
          this.rejectionsByTier.get("free") +
          this.rejectionsByTier.get("pro") +
          this.rejectionsByTier.get("business") +
          this.rejectionsByTier.get("other"),
      },
      system: {
        activeJobs: clampCount(context.activeJobs ?? 0, 1_000_000),
        rssBytes: context.rssBytes ?? null,
        heapUsedBytes: context.heapUsedBytes ?? null,
        nodeVersion: process.version,
      },
      pdfText: {
        byEngine: this.pdfTextByEngine.entries(),
        failureCodes: this.pdfTextFailureCodes.entries(),
        qualityStates: this.pdfTextQualityStates.entries(),
        validationStatuses: this.pdfTextValidationStatuses.entries(),
        durationBuckets: this.pdfTextDurationBuckets.entries(),
        inputSizeBuckets: this.pdfTextInputSizeBuckets.entries(),
        pageCountBuckets: this.pdfTextPageCountBuckets.entries(),
        eligibleRuns: this.pdfTextEligibleRuns,
        technicalFailureRate:
          this.pdfTextEligibleRuns === 0
            ? null
            : this.pdfTextTechnicalFailures / this.pdfTextEligibleRuns,
      },
    };
  }

  reset(): void {
    this.startedAt = new Date();
    this.minuteRing = newBuckets(MINUTE_RING_SIZE);
    this.hourRing = newBuckets(HOUR_RING_SIZE);
    this.requestsTotal = 0;
    this.jobsStarted = 0;
    this.jobsCompleted = 0;
    this.jobsFailed = 0;
    this.durations = new Float64Array(DURATION_RING_SIZE);
    this.durationCount = 0;
    this.durationWrite = 0;
    this.durationSum = 0;
    this.bulkFilesProcessed = 0;
    this.bulkFilesFailed = 0;
    this.batchesStarted = 0;
    this.batchesCompleted = 0;
    this.batchesCancelled = 0;
    this.batchesBudgetStopped = 0;
    this.batchesQuotaStopped = 0;
    this.batchFilesSum = 0;
    this.batchDurationSum = 0;
    this.byTool.reset();
    this.byCode.reset();
    this.byCategory.reset();
    this.ok2xx = 0;
    this.err4xx = 0;
    this.count429 = 0;
    this.count503 = 0;
    this.count504 = 0;
    this.inputTotal = 0;
    this.outputTotal = 0;
    this.rejectionsByTier.reset();
    this.pdfTextByEngine.reset();
    this.pdfTextFailureCodes.reset();
    this.pdfTextQualityStates.reset();
    this.pdfTextValidationStatuses.reset();
    this.pdfTextDurationBuckets.reset();
    this.pdfTextInputSizeBuckets.reset();
    this.pdfTextPageCountBuckets.reset();
    this.pdfTextEligibleRuns = 0;
    this.pdfTextTechnicalFailures = 0;
  }
}

/** Sanitized environment identifier. Never a secret, connection string or URL. */
function readEnvironment(): string {
  const raw = process.env.PDFKIT_ENVIRONMENT ?? process.env.NODE_ENV ?? "unknown";
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,31}$/.test(raw) ? raw : "unknown";
}
