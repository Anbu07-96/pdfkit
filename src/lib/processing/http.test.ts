// @vitest-environment node
import { describe, expect, it } from "vitest";
import { jsonError, readBatchIdHeader } from "./http";

function requestWith(headers: Record<string, string>): Request {
  return new Request("http://localhost/api/tools/merge-pdf", {
    method: "POST",
    headers,
  });
}

describe("readBatchIdHeader", () => {
  it("accepts a well-formed correlation id", () => {
    expect(
      readBatchIdHeader(requestWith({ "x-pdfkit-batch-id": "batch-1234-abcd" })),
    ).toBe("batch-1234-abcd");
  });

  it("accepts a bare alphanumeric id of minimum length", () => {
    expect(readBatchIdHeader(requestWith({ "x-pdfkit-batch-id": "12345678" }))).toBe(
      "12345678",
    );
  });

  it("returns undefined when the header is absent", () => {
    expect(readBatchIdHeader(requestWith({}))).toBeUndefined();
  });

  it("rejects values that are too short or too long", () => {
    expect(
      readBatchIdHeader(requestWith({ "x-pdfkit-batch-id": "short1" })),
    ).toBeUndefined();
    expect(
      readBatchIdHeader(
        requestWith({ "x-pdfkit-batch-id": "a".repeat(65) }),
      ),
    ).toBeUndefined();
  });

  it("rejects hostile payloads embedded in the header", () => {
    // The value is client-controlled; anything outside the strict allowlist
    // (injection attempts, log forging, oversized values) is dropped.
    expect(
      readBatchIdHeader(requestWith({ "x-pdfkit-batch-id": "bad id spaces" })),
    ).toBeUndefined();
    expect(
      readBatchIdHeader(requestWith({ "x-pdfkit-batch-id": "\nINJECTED log line" })),
    ).toBeUndefined();
    expect(
      readBatchIdHeader(requestWith({ "x-pdfkit-batch-id": "-leading-hyphen123" })),
    ).toBeUndefined();
    expect(
      readBatchIdHeader(requestWith({ "x-pdfkit-batch-id": "DROP TABLE--" })),
    ).toBeUndefined();
    expect(
      readBatchIdHeader(requestWith({ "x-pdfkit-batch-id": "../../etc/passwd" })),
    ).toBeUndefined();
  });
});

describe("jsonError", () => {
  it("merges extra headers such as Retry-After into the response", () => {
    const response = jsonError(
      "TOO_MANY_REQUESTS",
      "Too many requests. Please wait a moment and try again.",
      undefined,
      { "retry-after": "30" },
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("30");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("keeps the standard JSON headers when none are added", () => {
    const response = jsonError("QUOTA_EXCEEDED", "Daily quota reached.");
    expect(response.headers.get("retry-after")).toBeNull();
    expect(response.headers.get("content-type")).toContain("application/json");
  });
});
