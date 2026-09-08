// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { runBulkBatch } from "@/lib/bulk/runner";
import {
  BULK_BATCH_CEILINGS,
  BULK_REQUEST_PACING_MS,
  BULK_SHARED_BUDGETS,
  getBulkOperation,
  resolveBulkBatchCaps,
} from "@/lib/tools/bulk";
import { DEFAULT_TIER_QUOTAS } from "@/lib/usage/config";
import { DEFAULT_HARDENING_CONFIG } from "@/lib/hardening/config";
import { getProcessingLimits } from "@/lib/processing/limits";
import { validateFiles } from "@/lib/upload/file-validation";

/**
 * Phase 63, Step 8 — bulk limit validation.
 *
 * Tests the CURRENT limits only (nothing is raised) and proves each limit
 * stops processing honestly. Values are asserted from the code that enforces
 * them, so an accidental limit change breaks this file loudly.
 *
 * Behavioural stop coverage (pages/output/images budgets, pacing window,
 * single-flight, retry budgets) lives in `runner.load.test.ts` (Phase 62);
 * the 120 s watchdog and the 60/min IP limiter are exercised in
 * `multi-user.load.test.ts` (Phase 63). This file pins the numbers those
 * tests rely on and adds the per-tier batch-size limits.
 */

function entries(count: number): { id: string; file: File }[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `f-${index}`,
    file: new File([new Uint8Array(64)], `f-${index}.pdf`, { type: "application/pdf" }),
  }));
}

describe("bulk limit validation (Step 8)", () => {
  it("pins the current tier ceilings: files and total upload bytes", () => {
    expect(BULK_BATCH_CEILINGS.anonymous).toEqual({
      files: 10,
      inputBytes: 50 * 1024 * 1024,
    });
    expect(BULK_BATCH_CEILINGS.free).toEqual({
      files: 50,
      inputBytes: 100 * 1024 * 1024,
    });
    expect(BULK_BATCH_CEILINGS.pro).toEqual({
      files: 100,
      inputBytes: 250 * 1024 * 1024,
    });
    expect(BULK_BATCH_CEILINGS.business).toEqual({
      files: 100,
      inputBytes: 250 * 1024 * 1024,
    });
  });

  it("pins the shared budgets: pages, output bytes, extracted images", () => {
    expect(BULK_SHARED_BUDGETS.maxPagesPerBatch).toBe(200);
    expect(BULK_SHARED_BUDGETS.maxOutputBytesPerBatch).toBe(200 * 1024 * 1024);
    expect(BULK_SHARED_BUDGETS.maxExtractedImagesPerBatch).toBe(400);
  });

  it("pins the pacing window and the hardening defaults the runner relies on", () => {
    expect(BULK_REQUEST_PACING_MS).toBe(1_100); // ~54 req/min < 60/min IP limit
    expect(DEFAULT_HARDENING_CONFIG.requestTimeoutMs).toBe(120_000);
    expect(DEFAULT_HARDENING_CONFIG.rateLimitPerMinute).toBe(60);
  });

  it("pins the per-file and per-request server size limits", () => {
    const limits = getProcessingLimits();
    expect(limits.maxFileSize).toBe(25 * 1024 * 1024);
    expect(limits.maxTotalSize).toBe(100 * 1024 * 1024);
  });

  it("derives caps as min(tier ceiling, daily quota)", () => {
    // Default quotas: the tier ceilings bind for every tier.
    const anonymous = resolveBulkBatchCaps(
      "anonymous",
      DEFAULT_TIER_QUOTAS.anonymous.dailyJobLimit,
      DEFAULT_TIER_QUOTAS.anonymous.dailyByteLimit,
    );
    expect(anonymous.maxFilesPerBatch).toBe(10);
    expect(anonymous.maxTotalInputBytes).toBe(50 * 1024 * 1024);

    const free = resolveBulkBatchCaps(
      "free",
      DEFAULT_TIER_QUOTAS.free.dailyJobLimit,
      DEFAULT_TIER_QUOTAS.free.dailyByteLimit,
    );
    expect(free.maxFilesPerBatch).toBe(50);
    expect(free.maxTotalInputBytes).toBe(100 * 1024 * 1024);

    const pro = resolveBulkBatchCaps(
      "pro",
      DEFAULT_TIER_QUOTAS.pro.dailyJobLimit,
      DEFAULT_TIER_QUOTAS.pro.dailyByteLimit,
    );
    expect(pro.maxFilesPerBatch).toBe(100);
    expect(pro.maxTotalInputBytes).toBe(250 * 1024 * 1024);

    const business = resolveBulkBatchCaps(
      "business",
      DEFAULT_TIER_QUOTAS.business.dailyJobLimit,
      DEFAULT_TIER_QUOTAS.business.dailyByteLimit,
    );
    expect(business.maxFilesPerBatch).toBe(100);
    expect(business.maxTotalInputBytes).toBe(250 * 1024 * 1024);

    // A reduced environment quota binds instead of the ceiling: quotas can
    // only ever SHRINK a batch, never enlarge it beyond the ceiling.
    const squeezed = resolveBulkBatchCaps("pro", 12, 3 * 1024 * 1024);
    expect(squeezed.maxFilesPerBatch).toBe(12);
    expect(squeezed.maxTotalInputBytes).toBe(3 * 1024 * 1024);
  });

  it("runs a full anonymous-tier batch at its exact ceiling (10 files)", async () => {
    const operation = getBulkOperation("pdf-to-word")!;
    const caps = resolveBulkBatchCaps(
      "anonymous",
      DEFAULT_TIER_QUOTAS.anonymous.dailyJobLimit,
      DEFAULT_TIER_QUOTAS.anonymous.dailyByteLimit,
    );
    const fetchImpl = okFetch();
    const run = await runBulkBatch({
      operation,
      files: entries(caps.maxFilesPerBatch),
      caps,
      signal: new AbortController().signal,
      fetchImpl,
      sleep: async () => {},
    });

    expect(fetchImpl).toHaveBeenCalledTimes(10);
    expect(run.results).toHaveLength(10);
    expect(run.results.every((r) => r.status === "succeeded")).toBe(true);
    expect(run.stopReason).toBeUndefined();
  });

  it("runs free/pro/business batches at their ceilings (50/100/100 files)", async () => {
    const operation = getBulkOperation("pdf-to-text")!;
    for (const tier of ["free", "pro", "business"] as const) {
      const caps = resolveBulkBatchCaps(
        tier,
        DEFAULT_TIER_QUOTAS[tier].dailyJobLimit,
        DEFAULT_TIER_QUOTAS[tier].dailyByteLimit,
      );
      const fetchImpl = okFetch();
      const run = await runBulkBatch({
        operation,
        files: entries(caps.maxFilesPerBatch),
        caps,
        signal: new AbortController().signal,
        fetchImpl,
        sleep: async () => {},
      });

      expect(fetchImpl, tier).toHaveBeenCalledTimes(caps.maxFilesPerBatch);
      expect(run.results.every((r) => r.status === "succeeded"), tier).toBe(true);
    }
  });

  it("rejects files beyond the tier ceiling before any request is sent", () => {
    const caps = resolveBulkBatchCaps(
      "anonymous",
      DEFAULT_TIER_QUOTAS.anonymous.dailyJobLimit,
      DEFAULT_TIER_QUOTAS.anonymous.dailyByteLimit,
    );
    // The upload zone's shared validation (wired to the caps by the bulk
    // workspace) is the preflight guard: an 11th anonymous file is rejected
    // client-side, before any request exists to meter or rate-limit.
    const result = validateFiles(
      entries(11).map((entry) => entry.file),
      {
        extensions: [".pdf"],
        mimeTypes: ["application/pdf"],
        maxFiles: caps.maxFilesPerBatch,
        maxTotalSize: caps.maxTotalInputBytes,
        maxFileSize: 25 * 1024 * 1024,
      },
    );
    expect(result.accepted).toHaveLength(10);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].reason).toBe("too-many-files");
  });
});

/** Minimal fetch that always succeeds (single-flight is asserted elsewhere). */
function okFetch() {
  return vi.fn(async () =>
    new Response(new Uint8Array(32), {
      status: 200,
      headers: {
        "content-type": "application/octet-stream",
        "content-disposition": 'attachment; filename="out.txt"',
      },
    }),
  );
}
