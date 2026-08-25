// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  anonymizeClientIp,
  checkRateLimit,
  releaseDistributedSlot,
  tryAcquireDistributedSlot,
} from "@/lib/hardening/distributed-protection";
import { activeJobCount } from "@/lib/hardening/guards";
import { handleProcessingRequest } from "@/lib/hardening/route";
import type { HandleProcessingRequestOptions } from "@/lib/processing/http";

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

describe("anonymizeClientIp", () => {
  it("produces a 16-character SHA-256 hash token from client IP headers", () => {
    const req1 = postRequest({ "x-forwarded-for": "192.168.1.50" });
    const req2 = postRequest({ "x-real-ip": "10.0.0.1" });

    const token1 = anonymizeClientIp(req1);
    const token2 = anonymizeClientIp(req2);

    expect(token1).toHaveLength(16);
    expect(token2).toHaveLength(16);
    expect(token1).not.toBe(token2);
    expect(token1).not.toContain("192.168.1.50");
  });
});

describe("distributed slot counter with local fallback", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("admits requests when cap is disabled (0)", async () => {
    const before = activeJobCount();
    expect(await tryAcquireDistributedSlot(0)).toBe(true);
    expect(await tryAcquireDistributedSlot(0)).toBe(true);
    expect(activeJobCount()).toBe(before + 2);
    await releaseDistributedSlot();
    await releaseDistributedSlot();
    expect(activeJobCount()).toBe(before);
  });

  it("refuses extra jobs when cap is reached", async () => {
    try {
      expect(await tryAcquireDistributedSlot(2)).toBe(true);
      expect(await tryAcquireDistributedSlot(2)).toBe(true);
      expect(await tryAcquireDistributedSlot(2)).toBe(false);
    } finally {
      await releaseDistributedSlot();
      await releaseDistributedSlot();
    }
  });
});

describe("checkRateLimit", () => {
  it("allows requests under the rate limit", async () => {
    const req = postRequest({ "x-forwarded-for": "1.2.3.4" });
    expect(await checkRateLimit(req, 10)).toBeNull();
  });

  it("returns 429 TOO_MANY_REQUESTS when limit is exceeded", async () => {
    const req = postRequest({ "x-forwarded-for": "5.6.7.8" });
    for (let i = 0; i < 5; i++) {
      await checkRateLimit(req, 5);
    }
    const blocked = await checkRateLimit(req, 5);
    expect(blocked).not.toBeNull();
    expect(blocked!.status).toBe(429);

    const body = (await blocked!.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("TOO_MANY_REQUESTS");
  });
});

describe("hardened route with Phase 41 protection", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 429 when rate limit is exceeded on tool route", async () => {
    vi.stubEnv("PDFKIT_RATE_LIMIT_PER_MINUTE", "2");

    const req = postRequest({ "x-forwarded-for": "9.9.9.9" });
    await checkRateLimit(req, 2);
    await checkRateLimit(req, 2);

    const response = await handleProcessingRequest(req, TOOL_OPTIONS);
    expect(response.status).toBe(429);
  });
});
