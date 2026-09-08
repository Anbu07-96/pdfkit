// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/admin/metrics/route";
import { recordTelemetryEvent, resetTelemetry } from "@/lib/monitoring/telemetry";

/**
 * Phase 63 — admin metrics endpoint security. The endpoint must FAIL CLOSED:
 * anonymous access can never reach operational metrics.
 */

const TOKEN = "test-admin-token-0123456789abcdef";

function request(headers: Record<string, string> = {}, ip = "9.8.7.6"): Request {
  return new Request("http://localhost/api/admin/metrics", {
    headers: { "x-forwarded-for": ip, ...headers },
  });
}

describe("GET /api/admin/metrics", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetTelemetry();
  });

  it("is disabled (404) when no admin token is configured", async () => {
    delete process.env.PDFKIT_ADMIN_METRICS_TOKEN;
    const response = await GET(request({ authorization: `Bearer ${TOKEN}` }));
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("NOT_FOUND");
    // The 404 body must not hint that the endpoint exists.
    expect(JSON.stringify(body)).not.toMatch(/metric|admin|token/i);
  });

  it("rejects anonymous access with 401 when configured", async () => {
    process.env.PDFKIT_ADMIN_METRICS_TOKEN = TOKEN;
    const response = await GET(request());
    expect(response.status).toBe(401);
  });

  it("rejects a wrong token with 401 and no snapshot data", async () => {
    process.env.PDFKIT_ADMIN_METRICS_TOKEN = TOKEN;
    const response = await GET(
      request({ authorization: "Bearer wrong-token-entirely" }),
    );
    expect(response.status).toBe(401);
    const text = await response.text();
    expect(text).not.toMatch(/jobs|traffic|snapshot|schemaVersion/);
  });

  it("accepts the correct token via the Authorization header", async () => {
    process.env.PDFKIT_ADMIN_METRICS_TOKEN = TOKEN;
    const response = await GET(request({ authorization: `Bearer ${TOKEN}` }));
    expect(response.status).toBe(200);
    const snapshot = (await response.json()) as Record<string, unknown>;
    expect(snapshot.schemaVersion).toBe(1);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("accepts the correct token via the x-pdfkit-admin-token header", async () => {
    process.env.PDFKIT_ADMIN_METRICS_TOKEN = TOKEN;
    const response = await GET(request({ "x-pdfkit-admin-token": TOKEN }));
    expect(response.status).toBe(200);
  });

  it("serves aggregated metrics that reflect recorded telemetry", async () => {
    process.env.PDFKIT_ADMIN_METRICS_TOKEN = TOKEN;
    recordTelemetryEvent({
      type: "job_completed",
      toolId: "merge-pdf",
      durationMs: 12,
      fileCount: 1,
      inputBytes: 100,
      outputBytes: 90,
    });
    recordTelemetryEvent({
      type: "http_response",
      toolId: "merge-pdf",
      status: 200,
      durationMs: 15,
    });

    const response = await GET(request({ authorization: `Bearer ${TOKEN}` }, "9.8.7.7"));
    expect(response.status).toBe(200);
    const snapshot = (await response.json()) as {
      jobs: { completed: number };
      traffic: { requestsTotal: number };
    };
    expect(snapshot.jobs.completed).toBe(1);
    expect(snapshot.traffic.requestsTotal).toBe(1);
  });

  it("never exposes user identities, IPs, file names or secrets in the snapshot", async () => {
    process.env.PDFKIT_ADMIN_METRICS_TOKEN = TOKEN;
    recordTelemetryEvent({
      type: "job_failed",
      toolId: "merge-pdf",
      durationMs: 5,
      fileCount: 1,
      inputBytes: 10,
      errorCode: "INVALID_PDF",
      errorCategory: "invalid-file",
    });

    const response = await GET(request({ authorization: `Bearer ${TOKEN}` }, "9.8.7.8"));
    const json = JSON.stringify(await response.json());
    for (const forbidden of [
      "9.8.7.8",
      "password",
      "secret",
      "token",
      "DATABASE_URL",
      "userId",
      "email",
      "filename",
      "file name",
    ]) {
      expect(json.includes(forbidden)).toBe(false);
    }
  });

  it("rate-limits token guessing under its own scope", async () => {
    process.env.PDFKIT_ADMIN_METRICS_TOKEN = TOKEN;
    // Exhaust the admin scope's bucket for one IP with wrong guesses.
    let lastStatus = 401;
    for (let i = 0; i < 35; i += 1) {
      const response = await GET(
        request({ authorization: "Bearer guess" }, "9.8.7.9"),
      );
      lastStatus = response.status;
    }
    expect(lastStatus).toBe(429);
    // …and the correct token is throttled too within the same window.
    const blocked = await GET(request({ authorization: `Bearer ${TOKEN}` }, "9.8.7.9"));
    expect(blocked.status).toBe(429);
    // A different IP is unaffected.
    const other = await GET(request({ authorization: `Bearer ${TOKEN}` }, "9.8.7.10"));
    expect(other.status).toBe(200);
  });

  it("does not accept other methods", async () => {
    process.env.PDFKIT_ADMIN_METRICS_TOKEN = TOKEN;
    const { POST } = await import("@/app/api/admin/metrics/route");
    const response = POST();
    expect(response.status).toBe(404);
  });
});
