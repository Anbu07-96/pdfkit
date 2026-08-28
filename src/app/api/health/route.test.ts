// @vitest-environment node
import { describe, expect, it } from "vitest";
import { GET, POST } from "@/app/api/health/route";

describe("GET /api/health", () => {
  it("returns HTTP 200 with structured JSON health payload", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");

    const body = (await response.json()) as {
      status: string;
      timestamp: string;
      uptimeSeconds: number;
      version: string;
    };

    expect(body.status).toBe("ok");
    expect(typeof body.timestamp).toBe("string");
    expect(typeof body.uptimeSeconds).toBe("number");
    expect(body.version).toBe("0.1.0");

    // Ensure no secret or internal leakage
    const rawJson = JSON.stringify(body);
    expect(rawJson).not.toContain("process.env");
    expect(rawJson).not.toContain("node_modules");
  });
});

describe("POST /api/health", () => {
  it("returns 405 Method Not Allowed", () => {
    const response = POST();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
  });
});
