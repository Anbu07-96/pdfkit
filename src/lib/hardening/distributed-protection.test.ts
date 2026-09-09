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

describe("anonymizeClientIp (Phase 65 trust policy)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("produces a 16-character SHA-256 hash token from the trusted header", () => {
    const req1 = postRequest({ "x-forwarded-for": "192.168.1.50" });
    const req2 = postRequest({ "x-forwarded-for": "10.0.0.1" });

    const token1 = anonymizeClientIp(req1);
    const token2 = anonymizeClientIp(req2);

    expect(token1).toHaveLength(16);
    expect(token2).toHaveLength(16);
    expect(token1).not.toBe(token2);
    expect(token1).not.toContain("192.168.1.50");
  });

  it("uses the LAST X-Forwarded-For entry — a proxy-appended real IP beats any client-supplied prefix", () => {
    const spoofed = postRequest({ "x-forwarded-for": "6.6.6.6, 1.2.3.4" });
    const honest = postRequest({ "x-forwarded-for": "1.2.3.4" });
    // Both carry the same proxy-appended tail; the client's prepended decoy
    // must not change the token.
    expect(anonymizeClientIp(spoofed)).toBe(anonymizeClientIp(honest));
    // And a DIFFERENT real tail produces a different token.
    const other = postRequest({ "x-forwarded-for": "6.6.6.6, 5.6.7.8" });
    expect(anonymizeClientIp(spoofed)).not.toBe(anonymizeClientIp(other));
  });

  it("IGNORES client-supplied CF-Connecting-IP / X-Real-IP by default (spoof-resistant)", () => {
    // Pre-Phase-65 behavior trusted CF-Connecting-IP > X-Real-IP blindly; a
    // direct-to-app client could rotate these to bypass the IP limiter.
    const honest = postRequest({ "x-forwarded-for": "1.2.3.4" });
    const cfSpoof = postRequest({ "x-forwarded-for": "1.2.3.4", "cf-connecting-ip": "9.9.9.1" });
    const realSpoof = postRequest({ "x-forwarded-for": "1.2.3.4", "x-real-ip": "9.9.9.2" });
    const bothSpoof = postRequest({
      "x-forwarded-for": "1.2.3.4",
      "cf-connecting-ip": "9.9.9.3",
      "x-real-ip": "9.9.9.4",
    });
    const expected = anonymizeClientIp(honest);
    expect(anonymizeClientIp(cfSpoof)).toBe(expected);
    expect(anonymizeClientIp(realSpoof)).toBe(expected);
    expect(anonymizeClientIp(bothSpoof)).toBe(expected);
  });

  it("honors an explicitly configured trusted-header list (e.g. Cloudflare)", () => {
    vi.stubEnv("PDFKIT_CLIENT_IP_HEADERS", "cf-connecting-ip,x-forwarded-for");
    const behindCf = postRequest({ "cf-connecting-ip": "203.0.113.9" });
    const notBehindCf = postRequest({ "x-forwarded-for": "198.51.100.7" });
    const tokens = [behindCf, notBehindCf].map((r) => anonymizeClientIp(r));
    expect(tokens[0]).not.toBe(tokens[1]);

    // With the header list configured, an unlisted header stays ignored.
    const ignored = postRequest({ "x-real-ip": "203.0.113.9", "cf-connecting-ip": "203.0.113.9" });
    expect(anonymizeClientIp(ignored)).toBe(tokens[0]);
  });

  it("'none' mode collapses all clients into one fallback bucket (fail-closed, no proxy)", () => {
    vi.stubEnv("PDFKIT_CLIENT_IP_HEADERS", "none");
    const a = postRequest({ "x-forwarded-for": "1.1.1.1" });
    const b = postRequest({ "x-forwarded-for": "2.2.2.2", "cf-connecting-ip": "3.3.3.3" });
    expect(anonymizeClientIp(a)).toBe(anonymizeClientIp(b));
  });

  it("falls back to a single bucket when no trusted header is present", () => {
    const a = postRequest({});
    const b = postRequest({});
    expect(anonymizeClientIp(a)).toBe(anonymizeClientIp(b));
    expect(anonymizeClientIp(a)).toHaveLength(16);
  });

  it("rejects malformed header values (injection-shaped) via the IP format check", () => {
    const hostile = postRequest({ "x-forwarded-for": "pdfkit:ratelimit/x; DROP" });
    const fallback = postRequest({});
    expect(anonymizeClientIp(hostile)).toBe(anonymizeClientIp(fallback));
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

describe("checkRateLimit — Retry-After (Phase 62)", () => {
  it("sets an honest Retry-After header from the real limiter window", async () => {
    const req = postRequest({ "x-forwarded-for": "9.9.9.9" });
    for (let i = 0; i < 5; i++) {
      await checkRateLimit(req, 5);
    }
    const blocked = await checkRateLimit(req, 5);
    expect(blocked).not.toBeNull();
    expect(blocked!.status).toBe(429);

    const retryAfter = blocked!.headers.get("retry-after");
    expect(retryAfter).not.toBeNull();
    // A real, honest value: bounded to the limiter window (60 s) and clamped
    // to at least one second.
    const seconds = Number(retryAfter);
    expect(seconds).toBeGreaterThanOrEqual(1);
    expect(seconds).toBeLessThanOrEqual(60);

    const body = (await blocked!.json()) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe("TOO_MANY_REQUESTS");
    // The retry guidance lives in the standard header, not the body.
    expect(JSON.stringify(body)).not.toMatch(/retry/i);
  });

  it("uses distinct buckets per client IP", async () => {
    const reqA = postRequest({ "x-forwarded-for": "11.11.11.11" });
    const reqB = postRequest({ "x-forwarded-for": "22.22.22.22" });
    for (let i = 0; i < 5; i++) {
      await checkRateLimit(reqA, 5);
    }
    expect(await checkRateLimit(reqA, 5)).not.toBeNull();
    // A different client is unaffected.
    expect(await checkRateLimit(reqB, 5)).toBeNull();
  });
});
