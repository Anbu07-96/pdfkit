// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { runBulkBatch } from "@/lib/bulk/runner";
import {
  getBulkOperation,
  resolveBulkBatchCaps,
  BULK_REQUEST_PACING_MS,
} from "@/lib/tools/bulk";

/**
 * Batch runner tests. `fetch` and `sleep` are injected, so the tests assert
 * the runner's orchestration contract — pacing, budget stops, quota stops,
 * backoff and cancellation — without any network or real timers.
 */

function makeFile(name: string, size = 1024): File {
  return new File([new Uint8Array(size)], name, { type: "application/pdf" });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function binaryResponse(
  bytes: Uint8Array,
  headers: Record<string, string> = {},
): Response {
  return new Response(bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      "content-type": "application/octet-stream",
      "content-disposition": 'attachment; filename="result.docx"',
      ...headers,
    },
  });
}

const CAPS = resolveBulkBatchCaps("pro", 500, 2 * 1024 * 1024 * 1024);

describe("runBulkBatch", () => {
  it("processes every file sequentially and collects successful results", async () => {
    const operation = getBulkOperation("pdf-to-word")!;
    const files = [
      { id: "a", file: makeFile("a.pdf") },
      { id: "b", file: makeFile("b.pdf") },
    ];
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(binaryResponse(new Uint8Array([1, 2, 3])))
      .mockResolvedValueOnce(binaryResponse(new Uint8Array([4, 5, 6])));

    const run = await runBulkBatch({
      operation,
      files,
      caps: CAPS,
      signal: new AbortController().signal,
      fetchImpl,
      sleep: async () => {},
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(run.stopReason).toBeUndefined();
    expect(run.results.map((result) => result.status)).toEqual([
      "succeeded",
      "succeeded",
    ]);
    expect(run.results[0].fileName).toBe("result.docx");
    expect(run.budgets.outputBytes).toBe(6);
  });

  it("paces request starts so a fast-failing batch stays under the rate limit", async () => {
    const operation = getBulkOperation("pdf-to-word")!;
    const files = [1, 2, 3].map((n) => ({
      id: `f${n}`,
      file: makeFile(`f${n}.pdf`),
    }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { code: "INVALID_PDF", message: "nope" } }, 400));

    await runBulkBatch({
      operation,
      files,
      caps: CAPS,
      signal: new AbortController().signal,
      fetchImpl,
      sleep,
    });

    // First request is immediate; every later request must be paced.
    expect(sleep).toHaveBeenCalledTimes(2);
    for (const call of sleep.mock.calls) {
      expect(call[0]).toBeLessThanOrEqual(BULK_REQUEST_PACING_MS);
      expect(call[0]).toBeGreaterThan(0);
    }
  });

  it("marks a file failed and continues with the rest", async () => {
    const operation = getBulkOperation("pdf-to-word")!;
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(binaryResponse(new Uint8Array([1])))
      .mockResolvedValueOnce(
        jsonResponse({ error: { code: "INVALID_PDF", message: "Not a PDF." } }, 400),
      )
      .mockResolvedValueOnce(binaryResponse(new Uint8Array([2])));

    const run = await runBulkBatch({
      operation,
      files: [
        { id: "good", file: makeFile("good.pdf") },
        { id: "bad", file: makeFile("bad.pdf") },
        { id: "good2", file: makeFile("good2.pdf") },
      ],
      caps: CAPS,
      signal: new AbortController().signal,
      fetchImpl,
      sleep: async () => {},
    });

    const statuses = Object.fromEntries(run.results.map((r) => [r.id, r.status]));
    expect(statuses).toEqual({
      good: "succeeded",
      bad: "failed",
      good2: "succeeded",
    });
    expect(run.results.find((r) => r.id === "bad")?.error?.code).toBe("INVALID_PDF");
  });

  it("stops the whole batch on QUOTA_EXCEEDED and skips the remaining files", async () => {
    const operation = getBulkOperation("pdf-to-word")!;
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(binaryResponse(new Uint8Array([1])))
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { code: "QUOTA_EXCEEDED", message: "Daily plan processing quota exceeded." } },
          429,
        ),
      );

    const run = await runBulkBatch({
      operation,
      files: [1, 2, 3].map((n) => ({ id: `f${n}`, file: makeFile(`f${n}.pdf`) })),
      caps: CAPS,
      signal: new AbortController().signal,
      fetchImpl,
      sleep: async () => {},
    });

    expect(run.stopReason).toBe("quota");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const statuses = Object.fromEntries(run.results.map((r) => [r.id, r.status]));
    expect(statuses).toEqual({
      f1: "succeeded",
      f2: "skipped-quota",
      f3: "skipped-quota",
    });
  });

  it("backs off on TOO_MANY_REQUESTS and then succeeds", async () => {
    const operation = getBulkOperation("pdf-to-word")!;
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { code: "TOO_MANY_REQUESTS", message: "Too many requests." } },
          429,
        ),
      )
      .mockResolvedValueOnce(binaryResponse(new Uint8Array([9])));

    const run = await runBulkBatch({
      operation,
      files: [{ id: "f1", file: makeFile("f1.pdf") }],
      caps: CAPS,
      signal: new AbortController().signal,
      fetchImpl,
      sleep,
    });

    expect(run.results[0].status).toBe("succeeded");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(60_000, expect.any(AbortSignal));
  });

  it("backs off on SERVER_BUSY and eventually fails after the retry budget", async () => {
    const operation = getBulkOperation("pdf-to-word")!;
    const fetchImpl = vi.fn().mockImplementation(() =>
      Promise.resolve(
        jsonResponse({ error: { code: "SERVER_BUSY", message: "busy" } }, 503),
      ),
    );
    const sleep = vi.fn().mockResolvedValue(undefined);

    const run = await runBulkBatch({
      operation,
      files: [{ id: "f1", file: makeFile("f1.pdf") }],
      caps: CAPS,
      signal: new AbortController().signal,
      fetchImpl,
      sleep,
    });

    // 1 initial attempt + 3 retries.
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(run.results[0].status).toBe("failed");
    expect(run.results[0].error?.code).toBe("SERVER_BUSY");
  });

  it("stops scheduling raster work once the page budget is exhausted", async () => {
    const operation = getBulkOperation("pdf-to-jpg")!;
    const caps = { ...CAPS, maxPagesPerBatch: 10, maxOutputBytesPerBatch: 10_000_000 };
    // Each file reports 6 rendered pages.
    const fetchImpl = vi.fn().mockImplementation(() =>
      Promise.resolve(binaryResponse(new Uint8Array(10), { "x-pdfkit-pages": "6" })),
    );

    const run = await runBulkBatch({
      operation,
      files: [1, 2, 3].map((n) => ({ id: `f${n}`, file: makeFile(`f${n}.pdf`) })),
      caps,
      signal: new AbortController().signal,
      fetchImpl,
      sleep: async () => {},
    });

    // f1 (6 pages) + f2 (6 pages) = 12 ≥ 10 → f3 must be skipped.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(run.stopReason).toBe("budget-pages");
    expect(run.results[2].status).toBe("skipped-budget");
    expect(run.budgets.pagesUsed).toBe(12);
  });

  it("stops the batch once the output byte budget is reached", async () => {
    const operation = getBulkOperation("pdf-to-word")!;
    const caps = { ...CAPS, maxOutputBytesPerBatch: 5 };
    // Budgets are checked *between* files, so the file that crosses the cap
    // still completes — the overshoot is bounded by one file's output, which
    // the server caps per file.
    const fetchImpl = vi.fn().mockImplementation(() =>
      Promise.resolve(binaryResponse(new Uint8Array(5))),
    );

    const run = await runBulkBatch({
      operation,
      files: [1, 2].map((n) => ({ id: `f${n}`, file: makeFile(`f${n}.pdf`) })),
      caps,
      signal: new AbortController().signal,
      fetchImpl,
      sleep: async () => {},
    });

    expect(run.stopReason).toBe("budget-output");
    expect(run.results[1].status).toBe("skipped-budget");
  });

  it("stops an image-budget batch once extracted images exceed the cap", async () => {
    const operation = getBulkOperation("extract-images")!;
    const caps = { ...CAPS, maxExtractedImagesPerBatch: 150 };
    const fetchImpl = vi.fn().mockImplementation(() =>
      Promise.resolve(
        binaryResponse(new Uint8Array(4), { "x-pdfkit-extracted-images": "100" }),
      ),
    );

    const run = await runBulkBatch({
      operation,
      files: [1, 2, 3].map((n) => ({ id: `f${n}`, file: makeFile(`f${n}.pdf`) })),
      caps,
      signal: new AbortController().signal,
      fetchImpl,
      sleep: async () => {},
    });

    expect(run.stopReason).toBe("budget-images");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(run.results[2].status).toBe("skipped-budget");
    expect(run.budgets.imagesUsed).toBe(200);
  });

  it("sends the required options for page-selection endpoints", async () => {
    const operation = getBulkOperation("extract-images")!;
    const fetchImpl = vi.fn().mockResolvedValue(
      binaryResponse(new Uint8Array(1), { "x-pdfkit-extracted-images": "1" }),
    );

    await runBulkBatch({
      operation,
      files: [{ id: "f1", file: makeFile("f1.pdf") }],
      caps: CAPS,
      signal: new AbortController().signal,
      fetchImpl,
      sleep: async () => {},
    });

    const form = fetchImpl.mock.calls[0][1].body as FormData;
    expect(form.get("pages")).toBe("all");
    expect(form.get("files")).toBeInstanceOf(File);
  });

  it("cancels the batch: in-flight file cancelled, queued files cancelled", async () => {
    const operation = getBulkOperation("pdf-to-word")!;
    const controller = new AbortController();
    const fetchImpl = vi.fn().mockImplementation(() => {
      controller.abort();
      return Promise.reject(new DOMException("Aborted", "AbortError"));
    });

    const run = await runBulkBatch({
      operation,
      files: [1, 2].map((n) => ({ id: `f${n}`, file: makeFile(`f${n}.pdf`) })),
      caps: CAPS,
      signal: controller.signal,
      fetchImpl,
      sleep: async () => {},
    });

    expect(run.stopReason).toBe("cancelled");
    expect(run.results.map((r) => r.status)).toEqual(["cancelled", "cancelled"]);
  });

  it("respects carried-over budgets when retrying failed files", async () => {
    const operation = getBulkOperation("pdf-to-word")!;
    const caps = { ...CAPS, maxOutputBytesPerBatch: 8 };
    const fetchImpl = vi.fn().mockImplementation(() =>
      Promise.resolve(binaryResponse(new Uint8Array(4))),
    );

    // The first attempt already produced 8 bytes in this session — the whole
    // session budget — so the retry must not be allowed to add anything.
    const run = await runBulkBatch({
      operation,
      files: [{ id: "f1", file: makeFile("f1.pdf") }],
      caps,
      signal: new AbortController().signal,
      initialBudgets: { pagesUsed: 0, outputBytes: 8, imagesUsed: 0 },
      fetchImpl,
      sleep: async () => {},
    });

    expect(run.stopReason).toBe("budget-output");
    expect(run.results[0].status).toBe("skipped-budget");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports progress after each file settles", async () => {
    const operation = getBulkOperation("pdf-to-word")!;
    const fetchImpl = vi.fn().mockImplementation(() =>
      Promise.resolve(binaryResponse(new Uint8Array(2))),
    );
    const onProgress = vi.fn();

    await runBulkBatch({
      operation,
      files: [1, 2].map((n) => ({ id: `f${n}`, file: makeFile(`f${n}.pdf`) })),
      caps: CAPS,
      signal: new AbortController().signal,
      fetchImpl,
      onProgress,
      sleep: async () => {},
    });

    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenLastCalledWith({
      settled: 2,
      total: 2,
      pagesUsed: 0,
      outputBytes: 4,
      imagesUsed: 0,
    });
  });
});
