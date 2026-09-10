// @vitest-environment node
import { describe, expect, it } from "vitest";
import { InMemoryMetricsProvider } from "@/lib/monitoring/metrics/in-memory-provider";
import type { TelemetryEvent } from "@/lib/monitoring/telemetry-events";

/**
 * Phase 63 — in-memory metrics provider contract. The provider must be
 * strictly bounded (fixed buffers, fixed key sets), never throw, and answer
 * the operational questions from Step 3.
 */

function minutesAgo(count: number): Date {
  return new Date(Date.now() - count * 60_000);
}

describe("InMemoryMetricsProvider", () => {
  it("aggregates traffic into per-minute and per-hour buckets", () => {
    const provider = new InMemoryMetricsProvider();
    const now = new Date();
    const event = (status: number): TelemetryEvent => ({
      type: "http_response",
      toolId: "merge-pdf",
      status,
      durationMs: 5,
    });

    for (let i = 0; i < 5; i += 1) provider.record(event(200), now);
    for (let i = 0; i < 3; i += 1) provider.record(event(200), minutesAgo(2));

    const snapshot = provider.snapshot({});
    expect(snapshot.traffic.requestsTotal).toBe(8);
    const perMinute = snapshot.traffic.requestsPerMinute;
    expect(perMinute.reduce((sum, n) => sum + n, 0)).toBe(8);
    expect(perMinute[perMinute.length - 1]).toBe(5); // current minute
    expect(snapshot.traffic.requestsPerHour.reduce((sum, n) => sum + n, 0)).toBe(8);
  });

  it("keeps only the last 60 minute buckets and 24 hour buckets", () => {
    const provider = new InMemoryMetricsProvider();
    const event: TelemetryEvent = {
      type: "http_response",
      toolId: "merge-pdf",
      status: 200,
      durationMs: 1,
    };
    // One request 90 minutes ago (outside the minute window, inside hourly),
    // one now.
    provider.record(event, minutesAgo(90));
    provider.record(event, new Date());

    const snapshot = provider.snapshot({});
    expect(snapshot.traffic.requestsPerMinute.reduce((sum, n) => sum + n, 0)).toBe(1);
    expect(snapshot.traffic.requestsPerHour.reduce((sum, n) => sum + n, 0)).toBe(2);
    expect(snapshot.traffic.requestsPerMinute.length).toBeLessThanOrEqual(61);
    expect(snapshot.traffic.requestsPerHour.length).toBeLessThanOrEqual(25);
  });

  it("computes job counts, success rate and duration percentiles", () => {
    const provider = new InMemoryMetricsProvider();
    provider.record(
      { type: "job_started", toolId: "merge-pdf", fileCount: 1, inputBytes: 100 },
      new Date(),
    );
    // Durations 1..100: p50=50, p95=95, p99=99.
    for (let i = 1; i <= 100; i += 1) {
      const event: TelemetryEvent =
        i <= 95
          ? {
              type: "job_completed",
              toolId: "merge-pdf",
              durationMs: i,
              fileCount: 1,
              inputBytes: 100,
              outputBytes: 50,
            }
          : {
              type: "job_failed",
              toolId: "merge-pdf",
              durationMs: i,
              fileCount: 1,
              inputBytes: 100,
              errorCode: "INVALID_PDF",
              errorCategory: "invalid-file",
            };
      provider.record(event, new Date());
    }

    const snapshot = provider.snapshot({});
    expect(snapshot.jobs.started).toBe(1);
    expect(snapshot.jobs.completed).toBe(95);
    expect(snapshot.jobs.failed).toBe(5);
    expect(snapshot.jobs.successRate).toBeCloseTo(95 / 100, 5);
    expect(snapshot.jobs.duration.count).toBe(100);
    expect(snapshot.jobs.duration.p50Ms).toBe(50);
    expect(snapshot.jobs.duration.p95Ms).toBe(95);
    expect(snapshot.jobs.duration.p99Ms).toBe(99);
    expect(snapshot.jobs.duration.minMs).toBe(1);
    expect(snapshot.jobs.duration.maxMs).toBe(100);
  });

  it("bounds the duration ring at 4096 entries (no unbounded history)", () => {
    const provider = new InMemoryMetricsProvider();
    for (let i = 1; i <= 10_000; i += 1) {
      provider.record(
        {
          type: "job_completed",
          toolId: "merge-pdf",
          durationMs: i,
          fileCount: 1,
          inputBytes: 1,
          outputBytes: 1,
        },
        new Date(),
      );
    }
    const snapshot = provider.snapshot({});
    expect(snapshot.jobs.duration.count).toBe(4_096);
    // The window holds the NEWEST durations (5905..10000).
    expect(snapshot.jobs.duration.minMs).toBe(5_905);
    expect(snapshot.jobs.duration.maxMs).toBe(10_000);
  });

  it("counts 2xx/4xx/429/503/504 status classes", () => {
    const provider = new InMemoryMetricsProvider();
    const record = (status: number) =>
      provider.record(
        { type: "http_response", toolId: "merge-pdf", status, durationMs: 1 },
        new Date(),
      );
    record(200);
    record(200);
    record(400);
    record(429);
    record(429);
    record(503);
    record(504);

    const snapshot = provider.snapshot({});
    expect(snapshot.statuses).toEqual({
      ok2xx: 2,
      err4xx: 3, // 400 + 429 + 429
      count429: 2,
      count503: 1,
      count504: 1,
    });
  });

  it("aggregates errors by tool, code and category", () => {
    const provider = new InMemoryMetricsProvider();
    provider.record(
      {
        type: "job_failed",
        toolId: "merge-pdf",
        durationMs: 3,
        fileCount: 1,
        inputBytes: 10,
        errorCode: "INVALID_PDF",
        errorCategory: "invalid-file",
      },
      new Date(),
    );
    provider.record(
      {
        type: "job_failed",
        toolId: "merge-pdf",
        durationMs: 4,
        fileCount: 1,
        inputBytes: 10,
        errorCode: "INVALID_PDF",
        errorCategory: "invalid-file",
      },
      new Date(),
    );
    provider.record(
      {
        type: "job_failed",
        toolId: "pdf-to-jpg",
        durationMs: 5,
        fileCount: 1,
        inputBytes: 10,
        errorCode: "TOO_MANY_REQUESTS",
        errorCategory: "rate-limited",
      },
      new Date(),
    );
    provider.record(
      { type: "job_completed", toolId: "pdf-to-jpg", durationMs: 6, fileCount: 1, inputBytes: 10, outputBytes: 9 },
      new Date(),
    );

    const snapshot = provider.snapshot({});
    expect(snapshot.errors.byTool["merge-pdf"]).toEqual({ failed: 2, total: 2 });
    expect(snapshot.errors.byTool["pdf-to-jpg"]).toEqual({ failed: 1, total: 2 });
    // Keys are sanitized to a fixed lowercase alphabet.
    expect(snapshot.errors.byCode["invalid_pdf"]).toBe(2);
    expect(snapshot.errors.byCode["too_many_requests"]).toBe(1);
    expect(snapshot.errors.byCategory["invalid-file"]).toBe(2);
    expect(snapshot.errors.byCategory["rate-limited"]).toBe(1);
  });

  it("folds hostile/unknown keys into 'other' and caps map sizes", () => {
    const provider = new InMemoryMetricsProvider();
    // Hostile tool ids: injection-shaped, oversized, empty.
    for (const toolId of [
      "../../etc/passwd",
      "x".repeat(500),
      "",
      "DROP TABLE--",
      "ok-tool",
    ]) {
      provider.record(
        {
          type: "job_failed",
          toolId,
          durationMs: 1,
          fileCount: 1,
          inputBytes: 1,
          errorCode: "PROCESSING_ERROR",
          errorCategory: "processing-failed",
        },
        new Date(),
      );
    }
    const snapshot = provider.snapshot({});
    const keys = Object.keys(snapshot.errors.byTool);
    expect(keys).toContain("other");
    expect(keys).toContain("ok-tool");
    expect(keys).not.toContain("../../etc/passwd");
    expect(keys.every((key) => key.length <= 64)).toBe(true);
    expect(keys.length).toBeLessThanOrEqual(128);
  });

  it("aggregates quota rejections by tier and byte throughput", () => {
    const provider = new InMemoryMetricsProvider();
    provider.record(
      { type: "quota_rejected", toolId: "merge-pdf", tier: "anonymous", reason: "DAILY_JOB_LIMIT" },
      new Date(),
    );
    provider.record(
      { type: "quota_rejected", toolId: "merge-pdf", tier: "pro", reason: "DAILY_BYTE_LIMIT" },
      new Date(),
    );
    provider.record(
      { type: "job_started", toolId: "merge-pdf", fileCount: 2, inputBytes: 1_000 },
      new Date(),
    );
    provider.record(
      { type: "job_completed", toolId: "merge-pdf", durationMs: 10, fileCount: 2, inputBytes: 1_000, outputBytes: 400 },
      new Date(),
    );

    const snapshot = provider.snapshot({});
    expect(snapshot.quota.rejectionsByTier.anonymous).toBe(1);
    expect(snapshot.quota.rejectionsByTier.pro).toBe(1);
    expect(snapshot.quota.rejectionsByTier.free).toBe(0);
    expect(snapshot.quota.rejectionsTotal).toBe(2);
    expect(snapshot.bytes.inputTotal).toBe(1_000);
    expect(snapshot.bytes.outputTotal).toBe(400);
    expect(snapshot.bytes.inputAvg).toBe(1_000); // per started job
    expect(snapshot.bytes.outputAvg).toBe(400); // per completed job
  });

  it("correlates bulk per-file jobs by batch id and tracks client lifecycle events", () => {
    const provider = new InMemoryMetricsProvider();
    provider.record(
      {
        type: "job_completed",
        toolId: "pdf-to-word",
        batchId: "batch-0001",
        durationMs: 10,
        fileCount: 1,
        inputBytes: 10,
        outputBytes: 5,
      },
      new Date(),
    );
    provider.record(
      {
        type: "job_failed",
        toolId: "pdf-to-word",
        batchId: "batch-0001",
        durationMs: 10,
        fileCount: 1,
        inputBytes: 10,
        errorCode: "INVALID_PDF",
        errorCategory: "invalid-file",
      },
      new Date(),
    );
    provider.record(
      { type: "batch_started", batchId: "batch-0001", operation: "pdf-to-word", fileCount: 10 },
      new Date(),
    );
    provider.record(
      {
        type: "batch_completed",
        batchId: "batch-0001",
        operation: "pdf-to-word",
        fileCount: 10,
        succeeded: 1,
        failed: 1,
        skipped: 8,
        cancelled: 0,
        elapsedMs: 45_000,
      },
      new Date(),
    );
    provider.record(
      { type: "batch_cancelled", batchId: "batch-0002", operation: "pdf-to-text", settledFiles: 3, totalFiles: 9 },
      new Date(),
    );
    provider.record(
      { type: "batch_budget_stopped", batchId: "batch-0003", operation: "pdf-to-jpg", reason: "pages", settledFiles: 4, totalFiles: 9 },
      new Date(),
    );
    provider.record(
      { type: "batch_quota_stopped", batchId: "batch-0004", operation: "pdf-to-png", settledFiles: 2, totalFiles: 9 },
      new Date(),
    );

    const snapshot = provider.snapshot({});
    expect(snapshot.bulk.filesProcessed).toBe(1);
    expect(snapshot.bulk.filesFailed).toBe(1);
    expect(snapshot.bulk.batchesStarted).toBe(1);
    expect(snapshot.bulk.batchesCompleted).toBe(1);
    expect(snapshot.bulk.batchesCancelled).toBe(1);
    expect(snapshot.bulk.batchesBudgetStopped).toBe(1);
    expect(snapshot.bulk.batchesQuotaStopped).toBe(1);
    expect(snapshot.bulk.avgFilesPerBatch).toBe(10);
    expect(snapshot.bulk.avgBatchDurationMs).toBe(45_000);
    expect(snapshot.bulk.source).toBe("client-reported+server-correlated");
  });

  it("never throws on malformed events and resets cleanly", () => {
    const provider = new InMemoryMetricsProvider();
    expect(() =>
      provider.record(
        {
          type: "job_completed",
          toolId: "merge-pdf",
          durationMs: Number.NaN,
          fileCount: -5,
          inputBytes: Number.POSITIVE_INFINITY,
          outputBytes: Number.NaN,
        },
        new Date(),
      ),
    ).not.toThrow();
    const snapshot = provider.snapshot({ activeJobs: 2, rssBytes: 123, heapUsedBytes: 45 });
    expect(snapshot.system.activeJobs).toBe(2);
    expect(snapshot.system.rssBytes).toBe(123);
    expect(snapshot.system.heapUsedBytes).toBe(45);
    expect(snapshot.system.nodeVersion).toBe(process.version);

    provider.reset();
    const afterReset = provider.snapshot({});
    expect(afterReset.jobs.completed).toBe(0);
    expect(afterReset.traffic.requestsTotal).toBe(0);
    expect(afterReset.errors.byTool).toEqual({});
  });

  it("aggregates pdf-to-text engine diagnostics with the Phase 74 denominator", () => {
    const provider = new InMemoryMetricsProvider();
    const now = new Date();
    const run = (
      over: Partial<Extract<TelemetryEvent, { type: "pdf_text_engine_run" }>>,
    ): TelemetryEvent => ({
      type: "pdf_text_engine_run",
      engineId: "current-pdfium-text",
      outcome: "success",
      durationBucket: "lt-100ms",
      inputSizeBucket: "0-100kb",
      pageCountBucket: "1",
      ...over,
    });

    provider.record(run({}), now); // pdfium success
    provider.record(
      run({
        engineId: "pdfjs-text",
        outcome: "success",
        qualityState: "healthy",
        validationStatus: "passed",
        pageCountBucket: "6-20",
      }),
      now,
    );
    provider.record(
      run({
        outcome: "technical_failure",
        failureCode: "INVALID_PDF",
        pageCountBucket: "unknown",
        durationBucket: "100-500ms",
      }),
      now,
    );
    provider.record(
      run({ outcome: "validation_failure", failureCode: "VALIDATION_ERROR" }),
      now,
    );

    const pdfText = provider.snapshot({}).pdfText;
    expect(pdfText.byEngine["current-pdfium-text"]).toEqual({
      runs: 3,
      success: 1,
      technicalFailures: 1,
      validationFailures: 1,
    });
    expect(pdfText.byEngine["pdfjs-text"]).toEqual({
      runs: 1,
      success: 1,
      technicalFailures: 0,
      validationFailures: 0,
    });
    // §9 denominator: eligible = success + technical failures = 3 here.
    expect(pdfText.eligibleRuns).toBe(3);
    expect(pdfText.technicalFailureRate).toBeCloseTo(1 / 3, 10);
    expect(pdfText.failureCodes).toEqual({ invalid_pdf: 1, validation_error: 1 });
    expect(pdfText.qualityStates).toEqual({ healthy: 1 });
    expect(pdfText.validationStatuses).toEqual({ passed: 1 });
    expect(pdfText.durationBuckets).toEqual({ "lt-100ms": 3, "100-500ms": 1 });
    expect(pdfText.pageCountBuckets).toEqual({ "1": 2, "6-20": 1, unknown: 1 });

    provider.reset();
    expect(provider.snapshot({}).pdfText.byEngine).toEqual({});
    expect(provider.snapshot({}).pdfText.technicalFailureRate).toBe(null);
  });

  it("bounds pdf-to-text engine diagnostics: hostile labels fold, maps cap", () => {
    const provider = new InMemoryMetricsProvider();
    const now = new Date();
    const hostile = (engineId: string): TelemetryEvent => ({
      type: "pdf_text_engine_run",
      engineId,
      outcome: "success",
      durationBucket: "INJECTION \n attempt",
      inputSizeBucket: "0-100kb",
      pageCountBucket: "1",
    });

    // More distinct engine labels than the cap: excess folds into "other".
    for (let index = 0; index < 12; index += 1) {
      provider.record(hostile(`engine-${index}`), now);
    }
    const pdfText = provider.snapshot({}).pdfText;
    expect(Object.keys(pdfText.byEngine).length).toBeLessThanOrEqual(9); // 8 + "other"
    // Hostile bucket labels never appear as-is.
    const json = JSON.stringify(pdfText);
    expect(json).not.toContain("INJECTION");
    expect(json).not.toContain("\\n");
    expect(() => provider.record(hostile("x".repeat(10_000)), now)).not.toThrow();
  });

  it("reports a sanitized environment identifier", () => {
    const provider = new InMemoryMetricsProvider();
    const original = process.env.PDFKIT_ENVIRONMENT;

    process.env.PDFKIT_ENVIRONMENT = "production-eu-1";
    expect(provider.snapshot({}).environment).toBe("production-eu-1");

    // A value shaped like a secret or connection string is never echoed.
    process.env.PDFKIT_ENVIRONMENT = "postgres://user:pass@db:5432/x";
    expect(provider.snapshot({}).environment).toBe("unknown");

    process.env.PDFKIT_ENVIRONMENT = original;
  });
});
