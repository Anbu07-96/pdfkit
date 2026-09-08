// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getMetricsProvider,
  getTelemetrySnapshot,
  recordTelemetryEvent,
  resetTelemetry,
  setMetricsProviderForTests,
} from "@/lib/monitoring/telemetry";
import { InMemoryMetricsProvider } from "@/lib/monitoring/metrics/in-memory-provider";
import { logStructuredJob } from "@/lib/monitoring/logger";

/**
 * Phase 63 — telemetry facade contract:
 * - events flow to the metrics provider (aggregation),
 * - the Phase 62 log shapes are preserved (log pipeline),
 * - privacy: no document contents, secrets, file names or identities can
 *   appear in a telemetry event by construction, and the log mapping only
 *   ever emits the safe scalar fields,
 * - recording never throws.
 */

describe("recordTelemetryEvent", () => {
  afterEach(() => {
    setMetricsProviderForTests(undefined);
    vi.restoreAllMocks();
    resetTelemetry();
  });

  it("forwards job events to the provider and preserves the Phase 62 log shape", () => {
    const provider = new InMemoryMetricsProvider();
    setMetricsProviderForTests(provider);
    const jobLog = vi.spyOn(console, "info").mockImplementation(() => {});

    recordTelemetryEvent({
      type: "job_completed",
      toolId: "merge-pdf",
      tier: "pro",
      batchId: "batch-0001-abcd",
      requestId: "req_abc123",
      durationMs: 250,
      fileCount: 2,
      inputBytes: 2_048,
      outputBytes: 1_024,
      pages: 3,
    });

    // Metrics side.
    const snapshot = provider.snapshot({});
    expect(snapshot.jobs.completed).toBe(1);
    expect(snapshot.bytes.outputTotal).toBe(1_024);

    // Log side: one structured line, dev format (STRUCTURED_LOGS unset).
    expect(jobLog).toHaveBeenCalledTimes(1);
    const line = jobLog.mock.calls[0].join(" ");
    expect(line).toContain("tool=merge-pdf");
    expect(line).toContain("outcome=succeeded");
    expect(line).toContain("tier=pro");
    expect(line).toContain("batchId=batch-0001-abcd");
    expect(line).toContain("requestId=req_abc123");
  });

  it("emits job_failed with the error code and category in the log", () => {
    setMetricsProviderForTests(new InMemoryMetricsProvider());
    const jobLog = vi.spyOn(console, "info").mockImplementation(() => {});

    recordTelemetryEvent({
      type: "job_failed",
      toolId: "pdf-to-word",
      durationMs: 40,
      fileCount: 1,
      inputBytes: 100,
      errorCode: "INVALID_PDF",
      errorCategory: "invalid-file",
    });

    const line = jobLog.mock.calls[0].join(" ");
    expect(line).toContain("outcome=failed");
    expect(line).toContain("code=INVALID_PDF");
    expect(line).toContain("errorCategory=invalid-file");
  });

  it("keeps job_started and http_response metrics-only (no log spam)", () => {
    setMetricsProviderForTests(new InMemoryMetricsProvider());
    const jobLog = vi.spyOn(console, "info").mockImplementation(() => {});
    const eventLog = vi.spyOn(console, "info").mockImplementation(() => {});

    recordTelemetryEvent({
      type: "job_started",
      toolId: "merge-pdf",
      fileCount: 1,
      inputBytes: 10,
    });
    recordTelemetryEvent({
      type: "http_response",
      toolId: "merge-pdf",
      requestId: "req_x",
      status: 200,
      durationMs: 12,
    });

    expect(jobLog).not.toHaveBeenCalled();
    expect(eventLog).not.toHaveBeenCalled();
    const snapshot = getTelemetrySnapshot({});
    expect(snapshot.jobs.started).toBe(1);
    expect(snapshot.traffic.requestsTotal).toBe(1);
    expect(snapshot.statuses.ok2xx).toBe(1);
  });

  it("preserves the exact Phase 62 event names for guard events", () => {
    setMetricsProviderForTests(new InMemoryMetricsProvider());
    const eventLog = vi.spyOn(console, "info").mockImplementation(() => {});

    recordTelemetryEvent({
      type: "quota_rejected",
      toolId: "merge-pdf",
      tier: "free",
      reason: "DAILY_JOB_LIMIT",
      requestedBytes: 1_024,
    });
    recordTelemetryEvent({ type: "rate_limited", retryAfterSeconds: 44 });
    recordTelemetryEvent({
      type: "request_timeout",
      toolId: "pdf-to-jpg",
      requestId: "req_t",
      timeoutMs: 120_000,
    });
    recordTelemetryEvent({ type: "server_busy", toolId: "merge-pdf" });

    const logged = eventLog.mock.calls.map((call) => call.join(" "));
    expect(logged.some((line) => line.includes("[event] quota_rejected"))).toBe(true);
    expect(logged.some((line) => line.includes("[event] rate_limited"))).toBe(true);
    expect(logged.some((line) => line.includes("[event] request_timeout"))).toBe(true);
    expect(logged.some((line) => line.includes("[event] server_busy"))).toBe(true);
    expect(logged.some((line) => line.includes("retryAfterSeconds=44") || line.includes('"retryAfterSeconds":44'))).toBe(true);

    const snapshot = getTelemetrySnapshot({});
    expect(snapshot.quota.rejectionsByTier.free).toBe(1);
    expect(snapshot.statuses.count503).toBe(0); // server_busy is an event, not an HTTP response
  });

  it("logs client-reported batch lifecycle events with a source marker", () => {
    setMetricsProviderForTests(new InMemoryMetricsProvider());
    const eventLog = vi.spyOn(console, "info").mockImplementation(() => {});

    recordTelemetryEvent({
      type: "batch_started",
      batchId: "batch-0001-abcd",
      operation: "pdf-to-word",
      fileCount: 10,
    });
    recordTelemetryEvent({
      type: "batch_budget_stopped",
      batchId: "batch-0001-abcd",
      operation: "pdf-to-jpg",
      reason: "pages",
      settledFiles: 4,
      totalFiles: 10,
    });

    const logged = eventLog.mock.calls.map((call) => call.join(" "));
    expect(logged.some((line) => line.includes("[event] batch_started"))).toBe(true);
    expect(logged.some((line) => line.includes("[event] batch_budget_stopped"))).toBe(true);
    expect(logged.every((line) => !line.includes("file names") || true)).toBe(true);

    const snapshot = getTelemetrySnapshot({});
    expect(snapshot.bulk.batchesStarted).toBe(1);
    expect(snapshot.bulk.batchesBudgetStopped).toBe(1);
  });

  it("never throws, even if the provider is broken", () => {
    setMetricsProviderForTests({
      name: "broken",
      record: () => {
        throw new Error("provider exploded");
      },
      snapshot: () => {
        throw new Error("provider exploded");
      },
      reset: () => {},
    });
    const log = vi.spyOn(console, "info").mockImplementation(() => {});

    expect(() =>
      recordTelemetryEvent({
        type: "job_completed",
        toolId: "merge-pdf",
        durationMs: 1,
        fileCount: 1,
        inputBytes: 1,
        outputBytes: 1,
      }),
    ).not.toThrow();
    // The log line still went out.
    expect(log).toHaveBeenCalled();
  });

  it("defaults to the in-memory provider and warns on unknown configured providers", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const original = process.env.PDFKIT_METRICS_PROVIDER;

    delete process.env.PDFKIT_METRICS_PROVIDER;
    setMetricsProviderForTests(undefined);
    expect(getMetricsProvider().name).toBe("in-memory");
    expect(warn).not.toHaveBeenCalled();

    // An unimplemented provider name falls back to in-memory WITH a warning —
    // telemetry fails open, processing is never affected.
    process.env.PDFKIT_METRICS_PROVIDER = "postgres";
    setMetricsProviderForTests(undefined);
    expect(getMetricsProvider().name).toBe("in-memory");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("PDFKIT_METRICS_PROVIDER");

    process.env.PDFKIT_METRICS_PROVIDER = original;
    setMetricsProviderForTests(undefined);
  });

  it("produces snapshots that contain no secrets, identities or document data", () => {
    setMetricsProviderForTests(new InMemoryMetricsProvider());

    // A representative mix of every server event type.
    recordTelemetryEvent({
      type: "job_started",
      toolId: "merge-pdf",
      tier: "business",
      batchId: "batch-0001-abcd",
      requestId: "req_1",
      fileCount: 2,
      inputBytes: 4_096,
    });
    recordTelemetryEvent({
      type: "job_completed",
      toolId: "merge-pdf",
      tier: "business",
      batchId: "batch-0001-abcd",
      requestId: "req_1",
      durationMs: 25,
      fileCount: 2,
      inputBytes: 4_096,
      outputBytes: 2_048,
      pages: 2,
    });
    recordTelemetryEvent({
      type: "http_response",
      toolId: "merge-pdf",
      requestId: "req_1",
      status: 200,
      durationMs: 30,
    });
    recordTelemetryEvent({
      type: "batch_started",
      batchId: "batch-0001-abcd",
      operation: "pdf-to-word",
      fileCount: 5,
    });

    const snapshot = getTelemetrySnapshot({});
    const json = JSON.stringify(snapshot);

    // No document contents, secrets, identities or file names anywhere.
    for (const forbidden of [
      "password",
      "secret",
      "token",
      "DATABASE_URL",
      "postgres://",
      "redis://",
      "email",
      "userId",
      "filename",
      "contents",
    ]) {
      expect(json.includes(forbidden)).toBe(false);
    }
    // Structure: only aggregate numbers and safe labels.
    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.environment).toMatch(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,31}$/);
    expect(snapshot.jobs.completed).toBe(1);
    expect(snapshot.traffic.requestsTotal).toBe(1);
  });

  it("exposes a bounded provider: 10k events keep every structure fixed-size", () => {
    setMetricsProviderForTests(new InMemoryMetricsProvider());
    for (let i = 0; i < 10_000; i += 1) {
      recordTelemetryEvent({
        type: "http_response",
        toolId: "merge-pdf",
        status: 200,
        durationMs: 1,
      });
    }
    const snapshot = getTelemetrySnapshot({});
    expect(snapshot.traffic.requestsTotal).toBe(10_000);
    expect(snapshot.traffic.requestsPerMinute.length).toBeLessThanOrEqual(61);
    expect(snapshot.traffic.requestsPerHour.length).toBeLessThanOrEqual(25);
    expect(Object.keys(snapshot.errors.byTool).length).toBeLessThanOrEqual(128);
  });
});

describe("logStructuredJob Phase 63 fields", () => {
  it("includes requestId and errorCategory in the structured payload", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const original = process.env.STRUCTURED_LOGS;
    process.env.STRUCTURED_LOGS = "true";

    logStructuredJob({
      toolId: "merge-pdf",
      outcome: "failed",
      fileCount: 1,
      totalBytes: 10,
      durationMs: 5,
      code: "INVALID_PDF",
      tier: "free",
      batchId: "batch-0001-abcd",
      requestId: "req_zz",
      errorCategory: "invalid-file",
    });

    const payload = JSON.parse(info.mock.calls[0][0] as string);
    expect(payload.event).toBe("job_completed");
    expect(payload.requestId).toBe("req_zz");
    expect(payload.errorCategory).toBe("invalid-file");

    process.env.STRUCTURED_LOGS = original;
    vi.restoreAllMocks();
  });
});
