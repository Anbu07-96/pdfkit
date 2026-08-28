// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  handleProcessingRequest as handleProcessingRequestCore,
  type HandleProcessingRequestOptions,
} from "@/lib/processing/http";
import { getHardeningConfig, DEFAULT_HARDENING_CONFIG } from "@/lib/hardening/config";
import {
  activeJobCount,
  checkContentLengthHeader,
  releaseJobSlot,
  tryAcquireJobSlot,
} from "@/lib/hardening/guards";
import { handleProcessingRequest } from "@/lib/hardening/route";

vi.mock("@/lib/processing/http", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/processing/http")>();
  return { ...original, handleProcessingRequest: vi.fn() };
});

const mockedCore = vi.mocked(handleProcessingRequestCore);

const TOOL_OPTIONS: HandleProcessingRequestOptions<Record<string, unknown>> = {
  toolId: "merge-pdf",
  fallbackFileName: "merged.pdf",
};

function postRequest(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/tools/merge-pdf", {
    method: "POST",
    headers,
  });
}

async function errorBody(response: Response) {
  return (await response.json()) as { error: { code: string; message: string } };
}

beforeEach(() => {
  mockedCore.mockReset();
  mockedCore.mockResolvedValue(new Response("ok", { status: 200 }));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getHardeningConfig", () => {
  it("falls back to documented defaults", () => {
    expect(getHardeningConfig()).toEqual(DEFAULT_HARDENING_CONFIG);
    expect(getHardeningConfig().requestTimeoutMs).toBe(120_000);
    expect(getHardeningConfig().maxConcurrentJobs).toBe(0);
  });

  it("reads overrides from the environment", () => {
    vi.stubEnv("PDFKIT_REQUEST_TIMEOUT_MS", "5000");
    vi.stubEnv("PDFKIT_MAX_CONCURRENT_JOBS", "4");
    expect(getHardeningConfig()).toEqual({
      requestTimeoutMs: 5_000,
      maxConcurrentJobs: 4,
      rateLimitPerMinute: 60,
    });
  });

  it("ignores invalid values", () => {
    vi.stubEnv("PDFKIT_REQUEST_TIMEOUT_MS", "not-a-number");
    vi.stubEnv("PDFKIT_MAX_CONCURRENT_JOBS", "-3");
    expect(getHardeningConfig()).toEqual(DEFAULT_HARDENING_CONFIG);
  });

  it("caps values at the hard ceilings", () => {
    vi.stubEnv("PDFKIT_REQUEST_TIMEOUT_MS", "99999999");
    vi.stubEnv("PDFKIT_MAX_CONCURRENT_JOBS", "999999");
    const config = getHardeningConfig();
    expect(config.requestTimeoutMs).toBe(600_000);
    expect(config.maxConcurrentJobs).toBe(1024);
  });
});

describe("checkContentLengthHeader", () => {
  it("accepts a missing header and decimal byte counts", () => {
    expect(checkContentLengthHeader(postRequest())).toBeNull();
    expect(
      checkContentLengthHeader(postRequest({ "content-length": "1024" })),
    ).toBeNull();
    expect(
      checkContentLengthHeader(postRequest({ "content-length": "0" })),
    ).toBeNull();
  });

  it("rejects non-numeric and malformed lengths with 400", async () => {
    for (const bad of ["abc", "-1", "12.5", "1e5", "1,024", "9007199254740993"]) {
      const response = checkContentLengthHeader(
        postRequest({ "content-length": bad }),
      );
      expect(response, `content-length: ${bad}`).not.toBeNull();
      expect(response!.status).toBe(400);
      expect((await errorBody(response!)).error.code).toBe("VALIDATION_ERROR");
    }
  });
});

describe("job slot counter", () => {
  it("admits every request when the cap is disabled", () => {
    const before = activeJobCount();
    expect(tryAcquireJobSlot(0)).toBe(true);
    expect(tryAcquireJobSlot(0)).toBe(true);
    expect(activeJobCount()).toBe(before + 2);
    releaseJobSlot();
    releaseJobSlot();
    expect(activeJobCount()).toBe(before);
  });

  it("refuses extra jobs once the cap is reached", () => {
    try {
      expect(tryAcquireJobSlot(2)).toBe(true);
      expect(tryAcquireJobSlot(2)).toBe(true);
      expect(tryAcquireJobSlot(2)).toBe(false);
    } finally {
      releaseJobSlot();
      releaseJobSlot();
    }
    expect(activeJobCount()).toBe(0);
  });
});

describe("hardened handleProcessingRequest", () => {
  it("rejects a malformed Content-Length without running the job", async () => {
    const response = await handleProcessingRequest(
      postRequest({ "content-length": "not-a-number" }),
      TOOL_OPTIONS,
    );
    expect(response.status).toBe(400);
    expect((await errorBody(response)).error.code).toBe("VALIDATION_ERROR");
    expect(mockedCore).not.toHaveBeenCalled();
  });

  it("passes successful jobs through and releases the slot", async () => {
    const before = activeJobCount();
    const response = await handleProcessingRequest(postRequest(), TOOL_OPTIONS);
    expect(response.status).toBe(200);
    expect(mockedCore).toHaveBeenCalledTimes(1);
    expect(activeJobCount()).toBe(before);
  });

  it("fails fast with 503 when the concurrency cap is reached", async () => {
    vi.stubEnv("PDFKIT_MAX_CONCURRENT_JOBS", "1");

    let finishFirst: ((response: Response) => void) | undefined;
    mockedCore.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          finishFirst = resolve;
        }),
    );

    // The first request takes the only slot and keeps running.
    const first = handleProcessingRequest(postRequest(), TOOL_OPTIONS);
    await vi.waitFor(() => expect(activeJobCount()).toBe(1));

    // The second request is refused immediately — no silent queue.
    const second = await handleProcessingRequest(postRequest(), TOOL_OPTIONS);
    expect(second.status).toBe(503);
    expect((await errorBody(second)).error.code).toBe("SERVER_BUSY");

    // Once the first job genuinely ends, capacity returns.
    finishFirst?.(new Response("ok"));
    const firstResponse = await first;
    expect(firstResponse.status).toBe(200);
    await vi.waitFor(() => expect(activeJobCount()).toBe(0));
  });

  it("answers 504 on timeout without dropping the running job's slot", async () => {
    vi.stubEnv("PDFKIT_REQUEST_TIMEOUT_MS", "25");

    let finishJob: ((response: Response) => void) | undefined;
    mockedCore.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          finishJob = resolve;
        }),
    );

    const response = await handleProcessingRequest(postRequest(), TOOL_OPTIONS);
    expect(response.status).toBe(504);
    expect((await errorBody(response)).error.code).toBe("REQUEST_TIMEOUT");

    // The job is NOT aborted: its slot stays taken while it runs privately…
    expect(activeJobCount()).toBe(1);

    // …and is released only when the job actually finishes.
    finishJob?.(new Response("ok"));
    await vi.waitFor(() => expect(activeJobCount()).toBe(0));
  });

  it("returns a safe 500 when the adapter throws unexpectedly", async () => {
    mockedCore.mockRejectedValue(new Error("boom"));
    const response = await handleProcessingRequest(postRequest(), TOOL_OPTIONS);
    expect(response.status).toBe(500);
    expect((await errorBody(response)).error.code).toBe("INTERNAL_ERROR");
    expect(activeJobCount()).toBe(0);
  });
});

describe("tool route wiring", () => {
  it("routes use the hardened handler with the Phase 28 flags", async () => {
    // A real route module: 405 via the re-exported helper, Node runtime,
    // dynamic rendering — the flags every processing route must keep.
    const route = await import("@/app/api/tools/merge-pdf/route");
    expect(route.runtime).toBe("nodejs");
    expect(route.dynamic).toBe("force-dynamic");
    const response = route.GET();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });
});
