// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleProcessingRequest } from "@/lib/hardening/route";
import { activeJobCount } from "@/lib/hardening/guards";
import { findProcessor } from "@/lib/processing/registry";
import { getUsageService } from "@/lib/usage/service";
import { getTelemetrySnapshot, resetTelemetry } from "@/lib/monitoring/telemetry";
import { runBulkBatch } from "@/lib/bulk/runner";
import { getBulkOperation } from "@/lib/tools/bulk";
import type { UserIdentity } from "@/lib/auth/types";
import {
  makeJpeg,
  makeNumberedPdf,
  makeScannedPdf,
} from "@/test/pdf-fixtures";

/**
 * Phase 63, Step 7 — multi-user load validation.
 *
 * Simulated LEGITIMATE users (not a DDoS): every scenario drives the REAL
 * hardened route handler with REAL processors, real validation, real quota
 * metering (in-memory repository) and the real IP rate limiter. Each "user"
 * is a distinct identity + distinct client IP so per-user and per-IP
 * isolation can be verified. No limits are changed; the current architecture
 * is exercised exactly as production would run it (minus PostgreSQL/Redis,
 * which are documented production requirements).
 *
 * Scenarios:
 *   A — 10 simultaneous users: isolation, accounting, no crashes
 *   B — 25 simultaneous users with the concurrency cap active
 *   C — 50 simultaneous users: stability, bounded metrics, measured timings
 *   D — 5 simultaneous bulk batches through the real client runner
 *   E — many users behind ONE shared IP bucket (rate-limit behavior)
 *   F — anonymous/free/pro/business metered independently
 */

let userSeq = 0;
function nextUserId(prefix: string): string {
  userSeq += 1;
  return `${prefix}-${userSeq}`;
}

function identity(tier: UserIdentity["tier"], userId: string, authenticated = true): UserIdentity {
  return {
    isAuthenticated: authenticated,
    userId,
    email: authenticated ? `${userId}@example.test` : null,
    name: null,
    status: "active",
    tier,
  };
}

async function pdfFile(name: string, pages: number): Promise<File> {
  const bytes = await makeNumberedPdf(pages);
  return new File([bytes as BlobPart], name, { type: "application/pdf" });
}

async function jpegFile(name: string): Promise<File> {
  const bytes = await makeJpeg(120, 160, 7, 70);
  return new File([bytes as BlobPart], name, { type: "image/jpeg" });
}

function postTool(
  toolId: string,
  files: File[],
  who: { identity: UserIdentity; ip: string },
  fields: Record<string, string> = {},
): Promise<Response> {
  const form = new FormData();
  for (const file of files) form.append("files", file, file.name);
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  const request = new Request(`http://localhost/api/tools/${toolId}`, {
    method: "POST",
    headers: { "x-forwarded-for": who.ip },
    body: form,
  });
  return handleProcessingRequest(request, {
    toolId,
    fallbackFileName: "out",
    identity: who.identity,
  });
}

async function errorBody(response: Response) {
  return (await response.json()) as { error: { code: string } };
}

describe("multi-user load validation", () => {
  beforeEach(() => {
    resetTelemetry();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    resetTelemetry();
  });

  /* ------------------------------------------------------------------ */
  /* Scenario A — 10 simultaneous users                                  */
  /* ------------------------------------------------------------------ */
  it("scenario A: 10 concurrent users stay isolated with correct accounting", async () => {
    const users = Array.from({ length: 10 }, (_, i) => ({
      identity: identity("free", nextUserId("load-a")),
      // Distinct page counts (2..11): a crossed response would be detectable.
      pages: i + 2,
      ip: `10.10.1.${i + 1}`,
    }));

    const startedAt = Date.now();
    const responses = await Promise.all(
      users.map(async (user) =>
        postTool("pdf-to-word", [await pdfFile(`a-${user.pages}.pdf`, user.pages)], {
          identity: user.identity,
          ip: user.ip,
        }),
      ),
    );
    const wallMs = Date.now() - startedAt;

    // Every user succeeded and got THEIR OWN page count back.
    for (let i = 0; i < users.length; i += 1) {
      expect(responses[i].status, `user ${i}`).toBe(200);
      expect(responses[i].headers.get("x-pdfkit-pages")).toBe(String(users[i].pages));
      expect(responses[i].headers.get("x-pdfkit-request-id")).toMatch(/^req_[a-f0-9]{16}$/);
    }

    // Correct job accounting: exactly one job per user, bytes recorded.
    for (const user of users) {
      const summary = await getUsageService().getUserSummary(user.identity);
      expect(summary.jobsUsed).toBe(1);
      expect(summary.bytesUsed).toBeGreaterThan(0);
    }

    // Telemetry saw 10 requests and 10 completed jobs.
    const snapshot = getTelemetrySnapshot({});
    expect(snapshot.traffic.requestsTotal).toBe(10);
    expect(snapshot.jobs.completed).toBe(10);
    expect(snapshot.jobs.failed).toBe(0);
    expect(snapshot.jobs.duration.count).toBe(10);

    // Measured (local, synthetic): report the wave duration for the record.
    console.info(
      `[load] scenario A: 10 concurrent users completed in ${wallMs}ms ` +
        `(p50=${snapshot.jobs.duration.p50Ms}ms p95=${snapshot.jobs.duration.p95Ms}ms)`,
    );
  });

  /* ------------------------------------------------------------------ */
  /* Scenario B — 25 users with the concurrency cap                      */
  /* ------------------------------------------------------------------ */
  it("scenario B: the concurrency cap bounds in-flight jobs and fails fast with 503", async () => {
    vi.stubEnv("PDFKIT_MAX_CONCURRENT_JOBS", "4");

    // Slow the real processor just enough to observe concurrency.
    const mergeProcessor = findProcessor("pdf-to-word")!;
    const originalProcess = mergeProcessor.process.bind(mergeProcessor);
    let inFlight = 0;
    let maxInFlight = 0;
    vi.spyOn(mergeProcessor, "process").mockImplementation(async (request, ctx) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        await new Promise((resolve) => setTimeout(resolve, 60));
        return originalProcess(request, ctx);
      } finally {
        inFlight -= 1;
      }
    });

    const users = Array.from({ length: 25 }, (_, i) => ({
      identity: identity("free", nextUserId("load-b")),
      ip: `10.10.2.${i + 1}`,
    }));
    const files = await Promise.all(users.map((_, i) => pdfFile(`b-${i}.pdf`, 1)));

    const responses = await Promise.all(
      users.map((user, i) =>
        postTool("pdf-to-word", [files[i]], { identity: user.identity, ip: user.ip }),
      ),
    );

    const busy = responses.filter((r) => r.status === 503);
    const ok = responses.filter((r) => r.status === 200);
    expect(maxInFlight).toBeLessThanOrEqual(4);
    expect(ok.length).toBe(4);
    expect(busy.length).toBe(21);
    for (const response of busy) {
      expect(await (await errorBody(response)).error.code).toBe("SERVER_BUSY");
    }

    // Honest clients retry (sequentially — a concurrent wave would rightly
    // hit the cap again): the busy users get through when slots free up.
    for (let i = 0; i < users.length; i += 1) {
      if (responses[i].status === 503) {
        const retry = await postTool("pdf-to-word", [files[i]], {
          identity: users[i].identity,
          ip: users[i].ip,
        });
        expect(retry.status).toBe(200);
      }
    }

    // Accounting: exactly 25 successful jobs, one per user.
    for (const user of users) {
      const summary = await getUsageService().getUserSummary(user.identity);
      expect(summary.jobsUsed).toBe(1);
    }
    const snapshot = getTelemetrySnapshot({});
    expect(snapshot.statuses.count503).toBe(21);
    expect(snapshot.jobs.completed).toBe(25);
    console.info(
      `[load] scenario B: cap=4, maxInFlight=${maxInFlight}, ` +
        `${ok.length} admitted immediately, ${busy.length} honest 503s, all 25 completed`,
    );
  });

  /* ------------------------------------------------------------------ */
  /* Scenario C — 50 simultaneous users                                  */
  /* ------------------------------------------------------------------ */
  it("scenario C: 50 concurrent users all complete with bounded metrics", async () => {
    const users = Array.from({ length: 50 }, (_, i) => ({
      identity: identity("free", nextUserId("load-c")),
      pages: 1 + (i % 3),
      ip: `10.10.3.${i + 1}`,
    }));
    const files = await Promise.all(
      users.map((user) => pdfFile(`c-${user.pages}.pdf`, user.pages)),
    );

    const memoryBefore = process.memoryUsage().rss;
    const startedAt = Date.now();
    const responses = await Promise.all(
      users.map((user, i) =>
        postTool("pdf-to-word", [files[i]], { identity: user.identity, ip: user.ip }),
      ),
    );
    const wallMs = Date.now() - startedAt;

    expect(responses.every((r) => r.status === 200)).toBe(true);
    expect(activeJobCount()).toBe(0); // no leaked slots

    // Every user accounted exactly once.
    const summaries = await Promise.all(
      users.map((user) => getUsageService().getUserSummary(user.identity)),
    );
    expect(summaries.every((s) => s.jobsUsed === 1)).toBe(true);

    // Metrics stay bounded regardless of user count.
    const snapshot = getTelemetrySnapshot({});
    expect(snapshot.traffic.requestsTotal).toBe(50);
    expect(snapshot.jobs.completed).toBe(50);
    expect(snapshot.traffic.requestsPerMinute.length).toBeLessThanOrEqual(61);
    expect(snapshot.jobs.duration.count).toBe(50);
    expect(Object.keys(snapshot.errors.byTool).length).toBeLessThanOrEqual(128);

    const memoryAfter = process.memoryUsage().rss;
    console.info(
      `[load] scenario C: 50 concurrent users in ${wallMs}ms ` +
        `(p50=${snapshot.jobs.duration.p50Ms}ms p95=${snapshot.jobs.duration.p95Ms}ms ` +
        `p99=${snapshot.jobs.duration.p99Ms}ms, rss delta ≈ ${(
          (memoryAfter - memoryBefore) /
          1_048_576
        ).toFixed(1)} MB)`,
    );
    // Structural sanity on memory (soft: local machine dependent).
    expect(memoryAfter).toBeLessThan(memoryBefore + 512 * 1_048_576);
  });

  /* ------------------------------------------------------------------ */
  /* Scenario D — 5 simultaneous bulk batches                            */
  /* ------------------------------------------------------------------ */
  it("scenario D: five users run different bulk operations concurrently without interference", async () => {
    const scanned = await makeScannedPdf(1); // PDF with an embedded JPEG

    interface BulkUser {
      operationId: string;
      files: File[];
    }
    const bulkUsers: BulkUser[] = [
      { operationId: "pdf-to-word", files: await makeBatch("w", ".pdf", 10, 1) },
      { operationId: "pdf-to-text", files: await makeBatch("t", ".pdf", 10, 1) },
      { operationId: "pdf-to-jpg", files: await makeBatch("j", ".pdf", 10, 1) },
      {
        operationId: "extract-images",
        files: [new File([scanned as BlobPart], "x-scan.pdf", { type: "application/pdf" })],
      },
      { operationId: "images-to-pdf", files: await makeBatch("i", ".jpg", 10, 1, true) },
    ];

    async function makeBatch(
      prefix: string,
      extension: string,
      count: number,
      pages: number,
      jpeg = false,
    ): Promise<File[]> {
      return Promise.all(
        Array.from({ length: count }, (_, i) =>
          jpeg ? jpegFile(`${prefix}-${i}${extension}`) : pdfFile(`${prefix}-${i}${extension}`, pages),
        ),
      );
    }

    const runs = await Promise.all(
      bulkUsers.map(async (user, userIndex) => {
        const who = {
          identity: identity("free", nextUserId("load-d")),
          ip: `10.10.4.${userIndex + 1}`,
        };
        const operation = getBulkOperation(user.operationId)!;
        const serverFetch: typeof fetch = async (url, init) => {
          const request = new Request(new URL(String(url), "http://localhost").toString(), {
            method: "POST",
            headers: {
              ...(init?.headers as Record<string, string> | undefined),
              "x-forwarded-for": who.ip,
            },
            body: init?.body as FormData,
          });
          return handleProcessingRequest(request, {
            toolId: user.operationId,
            fallbackFileName: "out",
            identity: who.identity,
            // Mirror the route files' readOptions: the two page-selection
            // tools read their `pages` option out of the multipart form.
            ...(user.operationId === "pdf-to-text" || user.operationId === "extract-images"
              ? {
                  readOptions: (form: FormData) => {
                    const pages = form.get("pages");
                    return typeof pages === "string" ? { pages } : {};
                  },
                }
              : {}),
          });
        };
        const run = await runBulkBatch({
          operation,
          files: user.files.map((file, i) => ({ id: `${userIndex}-${i}`, file })),
          caps: {
            tier: "free",
            maxFilesPerBatch: 50,
            maxTotalInputBytes: 100 * 1024 * 1024,
            maxPagesPerBatch: 200,
            maxOutputBytesPerBatch: 200 * 1024 * 1024,
            maxExtractedImagesPerBatch: 400,
          },
          signal: new AbortController().signal,
          fetchImpl: serverFetch,
          sleep: async () => {}, // no pacing delay: the load is the 5 parallel batches
        });
        return { user, who, run };
      }),
    );

    for (const { user, run } of runs) {
      // Every file of every batch settled as succeeded.
      expect(run.stopReason, user.operationId).toBeUndefined();
      expect(
        run.results.every((r) => r.status === "succeeded"),
        user.operationId,
      ).toBe(true);
      // No cross-batch contamination: exactly this batch's file names.
      const ownNames = new Set(user.files.map((file) => file.name));
      expect(new Set(run.results.map((r) => r.name))).toEqual(ownNames);
    }

    // Per-user quota accounting: word/text/jpg/images-to-pdf used 10 jobs,
    // extract-images used 1.
    for (const { who, user, run } of runs) {
      const summary = await getUsageService().getUserSummary(who.identity);
      expect(summary.jobsUsed, user.operationId).toBe(run.results.length);
    }

    // Server-side batch correlation: every per-file job carried a batch id.
    const snapshot = getTelemetrySnapshot({});
    const expectedFiles = 10 + 10 + 10 + 1 + 10;
    expect(snapshot.bulk.filesProcessed).toBe(expectedFiles);
    expect(snapshot.jobs.completed).toBe(expectedFiles);
    console.info(
      `[load] scenario D: 5 concurrent bulk batches, ${expectedFiles} files, ` +
        `all succeeded, all batch-correlated`,
    );
  });

  /* ------------------------------------------------------------------ */
  /* Scenario E — many users, one shared IP bucket                       */
  /* ------------------------------------------------------------------ */
  it("scenario E: users behind one shared IP hit the rate limit together (honest 429s)", async () => {
    // One pro identity (500-job quota) behind ONE IP: the shared per-IP
    // bucket (60/min) must cut in before the quota does.
    const who = {
      identity: identity("pro", nextUserId("load-e")),
      ip: "10.10.5.1",
    };
    const file = await pdfFile("e.pdf", 1);

    let okCount = 0;
    let rateLimited = 0;
    let quotaCount = 0;
    let firstRetryAfter: string | null = null;

    for (let i = 0; i < 62; i += 1) {
      const response = await postTool("pdf-to-word", [file], who);
      if (response.status === 200) {
        okCount += 1;
      } else {
        const body = await errorBody(response);
        if (body.error.code === "TOO_MANY_REQUESTS") {
          rateLimited += 1;
          firstRetryAfter ??= response.headers.get("retry-after");
        } else if (body.error.code === "QUOTA_EXCEEDED") {
          quotaCount += 1;
        }
      }
    }

    // Exactly the limit was admitted; the overflow got honest 429s with a
    // real Retry-After (never faked) — and the quota never fired.
    expect(okCount).toBe(60);
    expect(rateLimited).toBe(2);
    expect(quotaCount).toBe(0);
    expect(firstRetryAfter).not.toBeNull();
    expect(Number(firstRetryAfter)).toBeGreaterThanOrEqual(1);
    expect(Number(firstRetryAfter)).toBeLessThanOrEqual(60);

    const snapshot = getTelemetrySnapshot({});
    expect(snapshot.statuses.count429).toBe(2);
    expect(snapshot.traffic.requestsTotal).toBe(62);
    console.info(
      `[load] scenario E: shared IP bucket admitted ${okCount}, ` +
        `rate-limited ${rateLimited} (Retry-After: ${firstRetryAfter}s)`,
    );
  });

  /* ------------------------------------------------------------------ */
  /* Scenario F — tiers metered independently                            */
  /* ------------------------------------------------------------------ */
  it("scenario F: anonymous/free/pro/business quotas meter independently", async () => {
    const anonId = identity("anonymous", nextUserId("load-f-anon"), false);
    const freeId = identity("free", nextUserId("load-f-free"));
    const proId = identity("pro", nextUserId("load-f-pro"));
    const businessId = identity("business", nextUserId("load-f-biz"));

    // Anonymous: 10 jobs/day → the 11th is rejected.
    const anonFile = await pdfFile("f-anon.pdf", 1);
    for (let i = 0; i < 10; i += 1) {
      const response = await postTool("pdf-to-word", [anonFile], {
        identity: anonId,
        ip: "10.10.6.1",
      });
      expect(response.status).toBe(200);
    }
    const anonEleventh = await postTool("pdf-to-word", [anonFile], {
      identity: anonId,
      ip: "10.10.6.1",
    });
    expect(anonEleventh.status).toBe(429);
    expect((await errorBody(anonEleventh)).error.code).toBe("QUOTA_EXCEEDED");

    // Free: 50 jobs/day → the 51st is rejected.
    const freeFile = await pdfFile("f-free.pdf", 1);
    for (let i = 0; i < 50; i += 1) {
      const response = await postTool("pdf-to-word", [freeFile], {
        identity: freeId,
        ip: "10.10.6.2",
      });
      expect(response.status).toBe(200);
    }
    const freeFiftyFirst = await postTool("pdf-to-word", [freeFile], {
      identity: freeId,
      ip: "10.10.6.2",
    });
    expect((await errorBody(freeFiftyFirst)).error.code).toBe("QUOTA_EXCEEDED");

    // Pro and business still have their full quotas — independent metering.
    const proFile = await pdfFile("f-pro.pdf", 1);
    for (let i = 0; i < 3; i += 1) {
      const response = await postTool("pdf-to-word", [proFile], {
        identity: proId,
        ip: "10.10.6.3",
      });
      expect(response.status).toBe(200);
    }
    const businessFile = await pdfFile("f-biz.pdf", 1);
    for (let i = 0; i < 3; i += 1) {
      const response = await postTool("pdf-to-word", [businessFile], {
        identity: businessId,
        ip: "10.10.6.4",
      });
      expect(response.status).toBe(200);
    }

    const [anonSummary, freeSummary, proSummary, businessSummary] = await Promise.all([
      getUsageService().getUserSummary(anonId),
      getUsageService().getUserSummary(freeId),
      getUsageService().getUserSummary(proId),
      getUsageService().getUserSummary(businessId),
    ]);
    expect(anonSummary.jobsUsed).toBe(10);
    expect(anonSummary.jobsRemaining).toBe(0);
    expect(freeSummary.jobsUsed).toBe(50);
    expect(freeSummary.jobsRemaining).toBe(0);
    expect(proSummary.jobsUsed).toBe(3);
    expect(proSummary.jobsRemaining).toBe(497);
    expect(businessSummary.jobsUsed).toBe(3);
    expect(businessSummary.jobsRemaining).toBe(4997);

    // Telemetry attributes the rejections to the right tiers.
    const snapshot = getTelemetrySnapshot({});
    expect(snapshot.quota.rejectionsByTier.anonymous).toBe(1);
    expect(snapshot.quota.rejectionsByTier.free).toBe(1);
    expect(snapshot.quota.rejectionsByTier.pro).toBe(0);
    expect(snapshot.quota.rejectionsByTier.business).toBe(0);
    console.info(
      `[load] scenario F: anonymous 10/10 + rejected, free 50/50 + rejected, ` +
        `pro 3/500, business 3/5000 — independently metered`,
    );
  });

  /* ------------------------------------------------------------------ */
  /* Timeout behavior (Step 8: 120 s watchdog, compressed for the test)  */
  /* ------------------------------------------------------------------ */
  it("the request watchdog times out honestly and never leaks the job slot", async () => {
    vi.stubEnv("PDFKIT_REQUEST_TIMEOUT_MS", "100");

    const wordProcessor = findProcessor("pdf-to-word")!;
    const originalProcess = wordProcessor.process.bind(wordProcessor);
    vi.spyOn(wordProcessor, "process").mockImplementation(async (request, ctx) => {
      await new Promise((resolve) => setTimeout(resolve, 250));
      return originalProcess(request, ctx);
    });

    const who = {
      identity: identity("free", nextUserId("load-t")),
      ip: "10.10.7.1",
    };
    const response = await postTool("pdf-to-word", [await pdfFile("t.pdf", 1)], who);

    // The caller got an honest 504 while the job keeps running privately.
    expect(response.status).toBe(504);
    expect((await errorBody(response)).error.code).toBe("REQUEST_TIMEOUT");
    expect(activeJobCount()).toBe(1);

    const snapshot = getTelemetrySnapshot({});
    expect(snapshot.errors.byCode["request_timeout"]).toBe(1);
    expect(snapshot.statuses.count504).toBe(1);

    // The slot is released when the real job ends, not before.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(activeJobCount()).toBe(0);
    // The private completion was still counted as a job outcome.
    expect(getTelemetrySnapshot({}).jobs.completed).toBe(1);
  });
});
