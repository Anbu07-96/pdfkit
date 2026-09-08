// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { unzipSync, zipSync } from "fflate";
import { runBulkBatch } from "@/lib/bulk/runner";
import type { BulkBatchCaps } from "@/lib/tools/bulk";
import {
  getBulkOperation,
  resolveBulkBatchCaps,
  BULK_REQUEST_PACING_MS,
} from "@/lib/tools/bulk";
import { buildBatchEntries } from "@/lib/bulk/zip";
import type { BatchZipEntryInput } from "@/lib/bulk/zip";

/**
 * Phase 62 Part 8 — deterministic load and stress scenarios.
 *
 * Every scenario runs against a simulated `fetchImpl` (no network, no real
 * timers) and asserts the runner's production-load contract:
 *   - strict request concurrency of 1 (never two files in flight),
 *   - pacing between request starts,
 *   - rate-limit/busy retry budgets (no request storms),
 *   - quota and budget stops that halt work honestly,
 *   - cancellation that stops scheduling immediately,
 *   - no file submitted more than once per attempt budget,
 *   - results that always flatten into a valid ZIP.
 */

const PRO_CAPS = resolveBulkBatchCaps("pro", 500, 2 * 1024 * 1024 * 1024);
const BUSINESS_CAPS = resolveBulkBatchCaps("business", 500, 2 * 1024 * 1024 * 1024);

function makeFile(name: string, size = 1024): File {
  return new File([new Uint8Array(size)], name, { type: "application/pdf" });
}

function entries(count: number, size = 1024): { id: string; file: File }[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `f-${String(index + 1).padStart(3, "0")}`,
    file: makeFile(`f-${String(index + 1).padStart(3, "0")}.pdf`, size),
  }));
}

function okResponse(
  name: string,
  bytes = 4096,
  headers: Record<string, string> = {},
): Response {
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "content-type": "application/octet-stream",
      "content-disposition": `attachment; filename="${name}"`,
      ...headers,
    },
  });
}

function errorResponse(
  code: string,
  message: string,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/** Wraps a fetch impl, asserting single-flight behaviour and recording submissions. */
function instrumented(impl: (init?: RequestInit) => Promise<Response>) {
  let inFlight = 0;
  let maxInFlight = 0;
  const submitted: string[] = [];
  const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      const body = init?.body as FormData;
      const files = body.getAll("files") as File[];
      expect(files).toHaveLength(1);
      submitted.push(files[0].name);
      return await impl(init);
    } finally {
      inFlight -= 1;
    }
  });
  return {
    fetchImpl,
    stats: {
      get maxInFlight() {
        return maxInFlight;
      },
      get attempts() {
        return submitted.length;
      },
      get submitted() {
        return [...submitted];
      },
    },
  };
}

const instantSleep = async () => {};

describe("runBulkBatch — load and stress scenarios", () => {
  it("scenario 1: a 10-file batch stays single-flight, paced and ZIP-valid", async () => {
    const operation = getBulkOperation("pdf-to-word")!;
    const files = entries(10);
    const { fetchImpl, stats } = instrumented(() =>
      Promise.resolve(okResponse("result.docx")),
    );
    const phases: string[] = [];

    const run = await runBulkBatch({
      operation,
      files,
      caps: PRO_CAPS,
      signal: new AbortController().signal,
      fetchImpl,
      sleep: instantSleep,
      onPhase: (phase) => phases.push(phase.kind),
    });

    expect(stats.maxInFlight).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(10);
    // One request per file, each file exactly once.
    expect(new Set(stats.submitted).size).toBe(10);
    // Pacing fires between consecutive request starts (N-1 times).
    expect(phases.filter((kind) => kind === "pacing")).toHaveLength(9);
    expect(run.results.every((result) => result.status === "succeeded")).toBe(true);
    expect(run.stopReason).toBeUndefined();

    // The produced results flatten into a valid ZIP with one entry per file.
    const zipInputs: BatchZipEntryInput[] = run.results
      .filter((result) => result.status === "succeeded" && result.blob)
      .map((result) => ({
        sourceName: result.name,
        resultName: result.fileName ?? result.name,
        blob: result.blob!,
      }));
    const { files: zipFiles } = await buildBatchEntries(zipInputs, true);
    expect(Object.keys(zipFiles)).toHaveLength(10);
    const archive = zipSync(zipFiles, { level: 0 });
    const roundTripped = unzipSync(archive);
    expect(Object.keys(roundTripped)).toHaveLength(10);
  });

  it("scenario 2: a 50-file batch with mixed outcomes keeps going past failures", async () => {
    const operation = getBulkOperation("pdf-to-text")!;
    const files = entries(50);
    let call = 0;
    const { fetchImpl, stats } = instrumented(() => {
      call += 1;
      // Every 5th file is permanently invalid; the rest succeed.
      if (call % 5 === 0) {
        return Promise.resolve(
          errorResponse("INVALID_PDF", "Not a readable PDF.", 400),
        );
      }
      return Promise.resolve(okResponse("result.txt", 2048));
    });

    const run = await runBulkBatch({
      operation,
      files,
      caps: PRO_CAPS,
      signal: new AbortController().signal,
      fetchImpl,
      sleep: instantSleep,
    });

    expect(stats.maxInFlight).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(50);
    const succeeded = run.results.filter((r) => r.status === "succeeded");
    const failed = run.results.filter((r) => r.status === "failed");
    expect(succeeded).toHaveLength(40);
    expect(failed).toHaveLength(10);
    expect(failed.every((r) => r.error?.code === "INVALID_PDF")).toBe(true);
    expect(run.stopReason).toBeUndefined();
    expect(run.budgets.outputBytes).toBe(40 * 2048);
  });

  it("scenario 3: a 100-file batch (tier ceiling) submits every file exactly once", async () => {
    const operation = getBulkOperation("pdf-to-word")!;
    const files = entries(100, 512);
    const { fetchImpl, stats } = instrumented(() =>
      Promise.resolve(okResponse("result.docx", 512)),
    );

    const run = await runBulkBatch({
      operation,
      files,
      caps: BUSINESS_CAPS,
      signal: new AbortController().signal,
      fetchImpl,
      sleep: instantSleep,
    });

    expect(stats.maxInFlight).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(100);
    const counts = new Map<string, number>();
    for (const name of stats.submitted) counts.set(name, (counts.get(name) ?? 0) + 1);
    expect(counts.size).toBe(100);
    expect([...counts.values()].every((count) => count === 1)).toBe(true);
    expect(run.results).toHaveLength(100);
    expect(run.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("scenario 4: sustained 429s never become a request storm", async () => {
    const operation = getBulkOperation("pdf-to-word")!;
    const files = entries(5);
    const sleep = vi.fn().mockResolvedValue(undefined);
    const { fetchImpl, stats } = instrumented(() =>
      Promise.resolve(
        errorResponse("TOO_MANY_REQUESTS", "Too many requests.", 429, {
          "retry-after": "1",
        }),
      ),
    );

    const run = await runBulkBatch({
      operation,
      files,
      caps: PRO_CAPS,
      signal: new AbortController().signal,
      fetchImpl,
      sleep,
    });

    // 1 initial attempt + MAX_RATE_LIMIT_RETRIES(2) per file, exactly.
    expect(fetchImpl).toHaveBeenCalledTimes(15);
    expect(stats.maxInFlight).toBe(1);
    // Every backoff used the server-provided Retry-After (1 s); the only
    // other waits are pacing waits, which are bounded by the pacing window.
    const waits = sleep.mock.calls.map((call) => call[0]);
    expect(waits.filter((ms) => ms === 1_000)).toHaveLength(10);
    for (const ms of waits) {
      expect(ms).toBeLessThanOrEqual(BULK_REQUEST_PACING_MS);
    }
    expect(run.results.every((r) => r.status === "failed")).toBe(true);
    expect(run.results.every((r) => r.error?.code === "TOO_MANY_REQUESTS")).toBe(true);
    // The batch kept moving; it did not stop the whole run on 429s.
    expect(run.stopReason).toBeUndefined();
  });

  it("scenario 5: sustained 503s exhaust the busy-retry budget and fail honestly", async () => {
    const operation = getBulkOperation("pdf-to-word")!;
    const files = entries(3);
    const sleep = vi.fn().mockResolvedValue(undefined);
    const { fetchImpl } = instrumented(() =>
      Promise.resolve(
        errorResponse("SERVER_BUSY", "Server is at capacity.", 503, {
          "retry-after": "3",
        }),
      ),
    );

    const run = await runBulkBatch({
      operation,
      files,
      caps: PRO_CAPS,
      signal: new AbortController().signal,
      fetchImpl,
      sleep,
    });

    // 1 attempt + 3 busy retries per file.
    expect(fetchImpl).toHaveBeenCalledTimes(12);
    expect(run.results.every((r) => r.status === "failed")).toBe(true);
    expect(run.results.every((r) => r.error?.code === "SERVER_BUSY")).toBe(true);
  });

  it("scenario 6: cancelling mid-batch stops scheduling immediately", async () => {
    const operation = getBulkOperation("pdf-to-word")!;
    const files = entries(10);
    const controller = new AbortController();
    const { fetchImpl, stats } = instrumented(() => {
      // Cancel as soon as the 5th file is dispatched.
      if (stats.attempts >= 5) controller.abort();
      return Promise.resolve(okResponse("result.docx"));
    });

    const run = await runBulkBatch({
      operation,
      files,
      caps: PRO_CAPS,
      signal: controller.signal,
      fetchImpl,
      sleep: instantSleep,
    });

    expect(stats.maxInFlight).toBe(1);
    // Exactly the five dispatched requests happened; nothing after the cancel.
    expect(fetchImpl).toHaveBeenCalledTimes(5);
    expect(run.stopReason).toBe("cancelled");
    const statuses = run.results.map((result) => result.status);
    // The five in-flight-era files settled as succeeded; the rest cancelled.
    expect(statuses.slice(0, 5)).toEqual([
      "succeeded",
      "succeeded",
      "succeeded",
      "succeeded",
      "succeeded",
    ]);
    expect(statuses.slice(5)).toEqual(
      Array.from({ length: 5 }, () => "cancelled"),
    );
    expect(statuses).not.toContain("queued");
  });

  it("scenario 7: quota exhaustion halts the batch and skips the rest", async () => {
    const operation = getBulkOperation("pdf-to-word")!;
    const files = entries(10);
    let call = 0;
    const { fetchImpl } = instrumented(() => {
      call += 1;
      if (call === 4) {
        return Promise.resolve(
          errorResponse("QUOTA_EXCEEDED", "Daily quota reached.", 402),
        );
      }
      return Promise.resolve(okResponse("result.docx"));
    });

    const run = await runBulkBatch({
      operation,
      files,
      caps: PRO_CAPS,
      signal: new AbortController().signal,
      fetchImpl,
      sleep: instantSleep,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(run.stopReason).toBe("quota");
    expect(run.results.filter((r) => r.status === "succeeded")).toHaveLength(3);
    expect(run.results.filter((r) => r.status === "skipped-quota")).toHaveLength(7);
    // Quota consumption is honest: only the three successes produced output.
    expect(run.budgets.outputBytes).toBe(3 * 4096);
  });

  it("scenario 8: the page budget stops the batch before overrunning", async () => {
    const operation = getBulkOperation("pdf-to-jpg")!; // pageBudget: true
    const files = entries(10);
    const caps: BulkBatchCaps = {
      ...PRO_CAPS,
      maxPagesPerBatch: 200,
    };
    const { fetchImpl } = instrumented(() =>
      Promise.resolve(okResponse("page-1.jpg", 2048, { "x-pdfkit-pages": "60" })),
    );

    const run = await runBulkBatch({
      operation,
      files,
      caps,
      signal: new AbortController().signal,
      fetchImpl,
      sleep: instantSleep,
    });

    // Files 1-3 land at 180 pages; the 4th crosses the line and completes
    // (bounded overshoot, per-file caps enforced server-side), then the
    // pre-flight check stops the rest: exactly 4 requests, 240 pages counted.
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(run.stopReason).toBe("budget-pages");
    expect(run.budgets.pagesUsed).toBe(240);
    expect(run.results.filter((r) => r.status === "skipped-budget")).toHaveLength(6);
  });

  it("scenario 9: the output-byte budget stops the batch before overrunning", async () => {
    const operation = getBulkOperation("pdf-to-text")!;
    const files = entries(10);
    const caps: BulkBatchCaps = {
      ...PRO_CAPS,
      maxOutputBytesPerBatch: 10 * 1024,
    };
    const { fetchImpl } = instrumented(() =>
      Promise.resolve(okResponse("result.txt", 4 * 1024)),
    );

    const run = await runBulkBatch({
      operation,
      files,
      caps,
      signal: new AbortController().signal,
      fetchImpl,
      sleep: instantSleep,
    });

    // 3 × 4 KiB = 12 KiB ≥ 10 KiB → the 4th file is skipped before dispatch
    // and every remaining file is labelled skipped-budget.
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(run.stopReason).toBe("budget-output");
    expect(run.budgets.outputBytes).toBe(12 * 1024);
    expect(run.results.filter((r) => r.status === "skipped-budget")).toHaveLength(7);
  });

  it("scenario 10: large files (25 MB each) are held one at a time", async () => {
    const operation = getBulkOperation("pdf-to-word")!;
    const files = entries(4, 25 * 1024 * 1024);
    const { fetchImpl, stats } = instrumented(() =>
      Promise.resolve(okResponse("result.docx", 1024 * 1024)),
    );

    const run = await runBulkBatch({
      operation,
      files,
      caps: PRO_CAPS,
      signal: new AbortController().signal,
      fetchImpl,
      sleep: instantSleep,
    });

    expect(stats.maxInFlight).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(run.results.every((r) => r.status === "succeeded")).toBe(true);
    expect(run.budgets.outputBytes).toBe(4 * 1024 * 1024);
    for (const result of run.results) {
      expect(result.size).toBe(25 * 1024 * 1024);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("scenario 11: many small files stay paced and under the rate limit", async () => {
    const operation = getBulkOperation("pdf-to-text")!;
    const files = entries(100, 256);
    const sleep = vi.fn().mockResolvedValue(undefined);
    const pacingWaits: number[] = [];
    const { fetchImpl, stats } = instrumented(() =>
      Promise.resolve(okResponse("result.txt", 128)),
    );

    const run = await runBulkBatch({
      operation,
      files,
      caps: BUSINESS_CAPS,
      signal: new AbortController().signal,
      fetchImpl,
      sleep,
      onPhase: (phase) => {
        if (phase.kind === "pacing") pacingWaits.push(phase.waitMs);
      },
    });

    expect(fetchImpl).toHaveBeenCalledTimes(100);
    expect(stats.maxInFlight).toBe(1);
    // Pacing fired before every request after the first.
    expect(pacingWaits).toHaveLength(99);
    for (const wait of pacingWaits) {
      expect(wait).toBeGreaterThan(0);
      expect(wait).toBeLessThanOrEqual(BULK_REQUEST_PACING_MS);
    }
    expect(run.results.every((r) => r.status === "succeeded")).toBe(true);
  });

  it("scenario 12: raster-heavy extraction respects the image budget and flattens archives", async () => {
    const operation = getBulkOperation("extract-images")!; // imageBudget: true
    const files = entries(10);
    const caps: BulkBatchCaps = {
      ...PRO_CAPS,
      maxExtractedImagesPerBatch: 400,
    };
    // Each result is a real ZIP with 150 images — the raster-heavy shape.
    const innerArchive = zipSync(
      Object.fromEntries(
        Array.from({ length: 150 }, (_, i) => [
          `image-${String(i + 1).padStart(3, "0")}.jpg`,
          new Uint8Array(64),
        ]),
      ),
      { level: 0 },
    );
    const { fetchImpl, stats } = instrumented(() =>
      Promise.resolve(
        new Response(innerArchive, {
          status: 200,
          headers: {
            "content-type": "application/zip",
            "content-disposition": 'attachment; filename="images.zip"',
            "x-pdfkit-extracted-images": "150",
          },
        }),
      ),
    );

    const run = await runBulkBatch({
      operation,
      files,
      caps,
      signal: new AbortController().signal,
      fetchImpl,
      sleep: instantSleep,
    });

    // The budget check is pre-flight (never over-schedule): files 1-3 run and
    // land at 450 images counted, then the batch stops honestly with the
    // remaining files labelled skipped-budget.
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(stats.maxInFlight).toBe(1);
    expect(run.stopReason).toBe("budget-images");
    expect(run.budgets.imagesUsed).toBe(450);
    expect(run.results.filter((r) => r.status === "skipped-budget")).toHaveLength(7);

    // The three settled archives flatten into per-document folders (entries
    // stay under the per-archive cap).
    const zipInputs: BatchZipEntryInput[] = run.results
      .filter((result) => result.status === "succeeded" && result.blob)
      .map((result) => ({
        sourceName: result.name,
        resultName: result.fileName ?? result.name,
        blob: result.blob!,
      }));
    const { files: zipFiles } = await buildBatchEntries(zipInputs, true);
    expect(Object.keys(zipFiles)).toHaveLength(3 * 150);
    const folders = new Set(Object.keys(zipFiles).map((name) => name.split("/")[0]));
    expect(folders.size).toBe(3);
  });
});
