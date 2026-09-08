// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/bulk/telemetry/route";
import { getTelemetrySnapshot, resetTelemetry } from "@/lib/monitoring/telemetry";

/**
 * Phase 63 — bulk telemetry beacon. The beacon accepts strictly-validated,
 * metadata-only batch lifecycle events from the browser. Client values are
 * untrusted: anything unexpected is a 400, and nothing is ever stored raw.
 */

function post(body: unknown, headers: Record<string, string> = {}, ip = "8.8.4.4") {
  return POST(
    new Request("http://localhost/api/bulk/telemetry", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": ip,
        origin: "http://localhost:3000",
        ...headers,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

const VALID_STARTED = {
  event: "batch_started",
  operation: "pdf-to-word",
  batchId: "batch-0001-abcd",
  fileCount: 10,
};

describe("POST /api/bulk/telemetry", () => {
  beforeEach(() => {
    resetTelemetry();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetTelemetry();
  });

  it("accepts a valid batch_started beacon and records it", async () => {
    const response = await post(VALID_STARTED);
    expect(response.status).toBe(204);

    const snapshot = getTelemetrySnapshot({});
    expect(snapshot.bulk.batchesStarted).toBe(1);
    expect(snapshot.bulk.avgFilesPerBatch).toBe(10);
  });

  it("accepts the full batch_completed payload", async () => {
    const response = await post({
      event: "batch_completed",
      operation: "pdf-to-jpg",
      batchId: "batch-0002-abcd",
      fileCount: 50,
      succeeded: 40,
      failed: 5,
      skipped: 3,
      cancelled: 2,
      elapsedMs: 180_000,
    });
    expect(response.status).toBe(204);
    const snapshot = getTelemetrySnapshot({});
    expect(snapshot.bulk.batchesCompleted).toBe(1);
    expect(snapshot.bulk.avgBatchDurationMs).toBe(180_000);
  });

  it("accepts budget-stop, quota-stop and cancellation beacons", async () => {
    expect(
      (
        await post({
          event: "batch_budget_stopped",
          operation: "pdf-to-jpg",
          batchId: "batch-0003-abcd",
          reason: "pages",
          settledFiles: 4,
          totalFiles: 10,
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await post({
          event: "batch_quota_stopped",
          operation: "pdf-to-png",
          batchId: "batch-0004-abcd",
          settledFiles: 2,
          totalFiles: 10,
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await post({
          event: "batch_cancelled",
          operation: "pdf-to-text",
          batchId: "batch-0005-abcd",
          settledFiles: 3,
          totalFiles: 9,
        })
      ).status,
    ).toBe(204);

    const snapshot = getTelemetrySnapshot({});
    expect(snapshot.bulk.batchesBudgetStopped).toBe(1);
    expect(snapshot.bulk.batchesQuotaStopped).toBe(1);
    expect(snapshot.bulk.batchesCancelled).toBe(1);
  });

  it("rejects unknown event types, operations and malformed batch ids", async () => {
    expect((await post({ ...VALID_STARTED, event: "trojan_horse" })).status).toBe(400);
    expect((await post({ ...VALID_STARTED, operation: "word-to-pdf" })).status).toBe(400);
    expect((await post({ ...VALID_STARTED, operation: "../../etc/passwd" })).status).toBe(400);
    expect((await post({ ...VALID_STARTED, batchId: "bad id" })).status).toBe(400);
    expect((await post({ ...VALID_STARTED, batchId: "short" })).status).toBe(400);
    expect((await post({ ...VALID_STARTED, batchId: "x".repeat(100) })).status).toBe(400);
  });

  it("rejects invalid counts and missing required fields", async () => {
    expect((await post({ ...VALID_STARTED, fileCount: -1 })).status).toBe(400);
    expect((await post({ ...VALID_STARTED, fileCount: 100_001 })).status).toBe(400);
    expect((await post({ ...VALID_STARTED, fileCount: "ten" })).status).toBe(400);
    expect((await post({ ...VALID_STARTED, fileCount: undefined })).status).toBe(400);
    expect(
      (
        await post({
          event: "batch_completed",
          operation: "pdf-to-word",
          batchId: "batch-0006-abcd",
          fileCount: 2,
        })
      ).status,
    ).toBe(400);
  });

  it("rejects oversized and non-JSON bodies", async () => {
    expect((await post("not json")).status).toBe(400);
    expect((await post("", {}, "8.8.4.5")).status).toBe(400);
    const huge = JSON.stringify({
      ...VALID_STARTED,
      fileCount: 10,
      padding: "x".repeat(3_000),
    });
    expect((await post(huge)).status).toBe(400);
  });

  it("ignores extra/unknown fields without recording them", async () => {
    const response = await post({
      ...VALID_STARTED,
      filename: "sensitive-invoice.pdf",
      contents: "fake document text",
      token: "leak-attempt",
    });
    expect(response.status).toBe(204);
    // The event is recorded, but the snapshot can only contain aggregates.
    const json = JSON.stringify(getTelemetrySnapshot({}));
    expect(json.includes("sensitive-invoice")).toBe(false);
    expect(json.includes("leak-attempt")).toBe(false);
  });

  it("rate-limits abuse under its own scope without touching the processing bucket", async () => {
    // Exhaust the beacon scope for one IP (60/min default in the config).
    let lastStatus = 204;
    for (let i = 0; i < 62; i += 1) {
      lastStatus = (await post(VALID_STARTED, {}, "8.8.4.6")).status;
    }
    expect(lastStatus).toBe(429);

    // A different IP is unaffected.
    expect((await post(VALID_STARTED, {}, "8.8.4.7")).status).toBe(204);
  });

  it("rejects cross-origin posts (CSRF guard)", async () => {
    const response = await post(VALID_STARTED, { origin: "https://evil.example.com" });
    expect(response.status).toBe(400);
  });
});
