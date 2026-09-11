// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as inspectPost } from "@/app/api/documents/inspect/route";
import { POST as thumbnailsPost } from "@/app/api/documents/thumbnails/route";
import {
  activeJobCount,
  releaseJobSlot,
  tryAcquireJobSlot,
} from "@/lib/hardening/guards";
import {
  getUsageRepository,
  InMemoryUsageRepository,
} from "@/lib/usage/repository";
import { getCurrentQuotaPeriodDate } from "@/lib/usage/quota";
import { makeNumberedPdf } from "@/test/pdf-fixtures";

/**
 * Phase 75B — the shared document endpoints (inspect / thumbnails) run
 * behind the SAME hardening sequence as the tool routes. These tests
 * exercise the REAL route handlers end to end (real guards, real pdfium,
 * real typed errors) — not isolated mocks — and prove anonymous traffic
 * can no longer bypass the rate limit, concurrency cap, quota check,
 * timeout watchdog or body-size gates through these endpoints.
 *
 * Isolation notes:
 * - every test uses a unique client IP (`x-forwarded-for`), so the
 *   in-memory rate limiter sees a fresh token per test;
 * - the in-memory usage repository is reset after every test so quota
 *   seeding never leaks into other tests;
 * - every test waits for the job counter to drain, mirroring the slot
 *   discipline of the wrapper (the watchdog never aborts real work).
 */

let ipCounter = 1;

/** A fresh client-IP per call → a fresh in-memory rate-limit token. */
function nextIp(): string {
  ipCounter += 1;
  return `198.51.100.${ipCounter % 250}`;
}

function buildRequest(
  path: string,
  files: { name: string; bytes: Uint8Array; type?: string }[],
  fields: Record<string, string> = {},
  headers: Record<string, string> = {},
  /** Pin the client IP when a test needs several requests to share one budget. */
  ip: string = nextIp(),
): Request {
  const form = new FormData();
  for (const file of files) {
    form.append(
      "files",
      new File([file.bytes as BlobPart], file.name, {
        type: file.type ?? "application/pdf",
      }),
    );
  }
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "x-forwarded-for": ip, ...headers },
    body: form,
  });
}

async function pdfBytes(pages: number): Promise<Uint8Array> {
  return makeNumberedPdf(pages);
}

async function errorBody(response: Response): Promise<{
  error: { code: string; message: string };
}> {
  return (await response.json()) as { error: { code: string; message: string } };
}

afterEach(async () => {
  vi.unstubAllEnvs();
  const repo = getUsageRepository();
  if (repo instanceof InMemoryUsageRepository) await repo.reset();
  // The watchdog never aborts real work: wait for any private job to end so
  // the next test starts from a clean slot count.
  await vi.waitFor(() => expect(activeJobCount()).toBe(0), { timeout: 5_000 });
});

describe("documents endpoints behind the shared hardening wrapper (Phase 75B)", () => {
  it("valid inspect and thumbnails requests still work (and carry a request id)", async () => {
    const inspectResponse = await inspectPost(
      buildRequest("/api/documents/inspect", [
        { name: "report.pdf", bytes: await pdfBytes(3) },
      ]),
    );
    expect(inspectResponse.status).toBe(200);
    expect(inspectResponse.headers.get("x-pdfkit-request-id")).toMatch(/^req_/);
    expect(((await inspectResponse.json()) as { pageCount: number }).pageCount).toBe(3);

    const thumbnailsResponse = await thumbnailsPost(
      buildRequest(
        "/api/documents/thumbnails",
        [{ name: "report.pdf", bytes: await pdfBytes(3) }],
        { pages: "1" },
      ),
    );
    expect(thumbnailsResponse.status).toBe(200);
    expect(thumbnailsResponse.headers.get("x-pdfkit-request-id")).toMatch(/^req_/);
    const body = (await thumbnailsResponse.json()) as {
      pageCount: number;
      thumbnails: { dataUrl: string }[];
    };
    expect(body.pageCount).toBe(3);
    expect(body.thumbnails).toHaveLength(1);
    expect(body.thumbnails[0].dataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it("inspect is rate-limited (429 on the next request once the budget is spent)", async () => {
    vi.stubEnv("PDFKIT_RATE_LIMIT_PER_MINUTE", "1");
    const ip = nextIp();

    const first = await inspectPost(
      buildRequest("/api/documents/inspect", [
        { name: "a.pdf", bytes: await pdfBytes(1) },
      ], {}, {}, ip),
    );
    expect(first.status).toBe(200);

    const second = await inspectPost(
      buildRequest("/api/documents/inspect", [
        { name: "a.pdf", bytes: await pdfBytes(1) },
      ], {}, {}, ip),
    );
    expect(second.status).toBe(429);
    expect((await errorBody(second)).error.code).toBe("TOO_MANY_REQUESTS");
    expect(second.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(second.headers.get("x-pdfkit-request-id")).toMatch(/^req_/);
  });

  it("thumbnails is rate-limited the same way", async () => {
    vi.stubEnv("PDFKIT_RATE_LIMIT_PER_MINUTE", "1");
    const ip = nextIp();

    const first = await thumbnailsPost(
      buildRequest("/api/documents/thumbnails", [
        { name: "a.pdf", bytes: await pdfBytes(1) },
      ], {}, {}, ip),
    );
    expect(first.status).toBe(200);

    const second = await thumbnailsPost(
      buildRequest("/api/documents/thumbnails", [
        { name: "a.pdf", bytes: await pdfBytes(1) },
      ], {}, {}, ip),
    );
    expect(second.status).toBe(429);
    expect((await errorBody(second)).error.code).toBe("TOO_MANY_REQUESTS");
  });

  it("each request is counted exactly once — no double application of the limit", async () => {
    vi.stubEnv("PDFKIT_RATE_LIMIT_PER_MINUTE", "2");
    const ip = nextIp();

    const responses: number[] = [];
    for (let index = 0; index < 3; index += 1) {
      const response = await inspectPost(
        buildRequest("/api/documents/inspect", [
          { name: "a.pdf", bytes: await pdfBytes(1) },
        ], {}, {}, ip),
      );
      responses.push(response.status);
    }
    // If the wrapper double-counted, the SECOND request would already 429.
    expect(responses).toEqual([200, 200, 429]);
  });

  it("concurrency protection applies: no slot, no work (503 SERVER_BUSY)", async () => {
    vi.stubEnv("PDFKIT_MAX_CONCURRENT_JOBS", "1");

    // Take the only slot the way a running job would.
    expect(tryAcquireJobSlot(1)).toBe(true);
    expect(activeJobCount()).toBe(1);

    const rejected = await inspectPost(
      buildRequest("/api/documents/inspect", [
        { name: "a.pdf", bytes: await pdfBytes(1) },
      ]),
    );
    expect(rejected.status).toBe(503);
    expect((await errorBody(rejected)).error.code).toBe("SERVER_BUSY");

    // Capacity returns when the slot is genuinely released.
    releaseJobSlot();
    const accepted = await inspectPost(
      buildRequest("/api/documents/inspect", [
        { name: "a.pdf", bytes: await pdfBytes(1) },
      ]),
    );
    expect(accepted.status).toBe(200);
  });

  it("the watchdog also covers inspect (shared wrapper, same behavior)", async () => {
    vi.stubEnv("PDFKIT_REQUEST_TIMEOUT_MS", "1");

    // Loading and counting 150 real page objects takes ~30ms — far beyond
    // the 1ms watchdog.
    const response = await inspectPost(
      buildRequest("/api/documents/inspect", [
        { name: "big.pdf", bytes: await pdfBytes(150) },
      ]),
    );
    expect(response.status).toBe(504);
    expect((await errorBody(response)).error.code).toBe("REQUEST_TIMEOUT");
  });

  it("rejects a malformed Content-Length before any work (400, typed)", async () => {
    const response = await inspectPost(
      new Request("http://localhost/api/documents/inspect", {
        method: "POST",
        headers: {
          "x-forwarded-for": nextIp(),
          "content-length": "not-a-number",
        },
      }),
    );
    expect(response.status).toBe(400);
    expect((await errorBody(response)).error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects an oversized file with the existing typed size error (413)", async () => {
    const oversized = new Uint8Array(25 * 1024 * 1024 + 1);
    const response = await inspectPost(
      buildRequest("/api/documents/inspect", [
        { name: "huge.pdf", bytes: oversized },
      ]),
    );
    expect(response.status).toBe(413);
    expect((await errorBody(response)).error.code).toBe("FILE_TOO_LARGE");
  });

  it("quota protection applies: an over-quota identity gets QUOTA_EXCEEDED, not work", async () => {
    // Seed the in-memory usage repository to the anonymous daily limit
    // (10 jobs/day) for the anonymous identity the test session uses.
    const repo = getUsageRepository();
    expect(repo).toBeInstanceOf(InMemoryUsageRepository);
    const periodDate = getCurrentQuotaPeriodDate();
    for (let index = 0; index < 10; index += 1) {
      await repo.recordUsage({
        userId: "anon",
        periodDate,
        jobCountDelta: 1,
        bytesDelta: 0,
      });
    }

    const inspectResponse = await inspectPost(
      buildRequest("/api/documents/inspect", [
        { name: "a.pdf", bytes: await pdfBytes(1) },
      ]),
    );
    expect(inspectResponse.status).toBe(429);
    const inspectError = await errorBody(inspectResponse);
    expect(inspectError.error.code).toBe("QUOTA_EXCEEDED");
    // Client-safe: a static message, no internals.
    expect(inspectError.error.message).toContain("quota");

    const thumbnailsResponse = await thumbnailsPost(
      buildRequest("/api/documents/thumbnails", [
        { name: "a.pdf", bytes: await pdfBytes(1) },
      ]),
    );
    expect(thumbnailsResponse.status).toBe(429);
    expect((await errorBody(thumbnailsResponse)).error.code).toBe("QUOTA_EXCEEDED");
  });

  it("quota is a preflight CHECK only — successful document requests do not consume quota", async () => {
    const repo = getUsageRepository();
    expect(repo).toBeInstanceOf(InMemoryUsageRepository);
    const periodDate = getCurrentQuotaPeriodDate();
    const usageBefore = await repo.getUsage("anon", periodDate);

    const response = await inspectPost(
      buildRequest("/api/documents/inspect", [
        { name: "a.pdf", bytes: await pdfBytes(1) },
      ]),
    );
    expect(response.status).toBe(200);

    const usageAfter = await repo.getUsage("anon", periodDate);
    // No usage recorded by the documents endpoints — the daily job quota is
    // consumed by real tool conversions only, never by previews (and never
    // twice by one request).
    expect(usageAfter?.jobCount ?? 0).toBe(usageBefore?.jobCount ?? 0);
  });

  it("fail-closed when Redis is declared required but unavailable (503, no bypass)", async () => {
    vi.stubEnv("PDFKIT_REDIS_REQUIRED", "true");

    const response = await inspectPost(
      buildRequest("/api/documents/inspect", [
        { name: "a.pdf", bytes: await pdfBytes(1) },
      ]),
    );
    expect(response.status).toBe(503);
    expect((await errorBody(response)).error.code).toBe(
      "USAGE_SERVICE_UNAVAILABLE",
    );
  });

  it("typed failures stay typed and client-safe through the wrapper", async () => {
    const broken = new TextEncoder().encode("%PDF-1.7 definitely not a pdf");
    const thumbnailsResponse = await thumbnailsPost(
      buildRequest("/api/documents/thumbnails", [
        { name: "broken.pdf", bytes: broken },
      ]),
    );
    expect(thumbnailsResponse.status).toBe(422);
    expect((await errorBody(thumbnailsResponse)).error.code).toBe("INVALID_PDF");

    // Existing page limits still enforced (no render of a nonexistent page).
    const outOfRange = await thumbnailsPost(
      buildRequest(
        "/api/documents/thumbnails",
        [{ name: "a.pdf", bytes: await pdfBytes(2) }],
        { pages: "999" },
      ),
    );
    expect(outOfRange.status).toBe(400);
    expect((await errorBody(outOfRange)).error.code).toBe("PAGE_OUT_OF_RANGE");
  });
});
