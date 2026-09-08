import { describe, expect, it } from "vitest";
import {
  cancelledClassification,
  classifyBulkError,
} from "@/lib/bulk/errors";

describe("classifyBulkError", () => {
  it("maps invalid-document codes to invalid-file", () => {
    for (const code of [
      "INVALID_PDF",
      "INVALID_IMAGE",
      "ENCRYPTED_PDF",
      "WRONG_PASSWORD",
      "UNSUPPORTED_ENCRYPTION",
      "SIGNED_PDF",
    ]) {
      const classification = classifyBulkError(code);
      expect(classification.category, code).toBe("invalid-file");
      expect(classification.retryable).toBe(false);
    }
  });

  it("maps format and size codes", () => {
    expect(classifyBulkError("UNSUPPORTED_FILE").category).toBe("unsupported-format");
    expect(classifyBulkError("FILE_TOO_LARGE").category).toBe("file-too-large");
  });

  it("maps batch-limit codes", () => {
    for (const code of [
      "TOO_MANY_FILES",
      "TOTAL_SIZE_EXCEEDED",
      "TOO_MANY_OUTPUTS",
      "OUTPUT_TOO_LARGE",
    ]) {
      expect(classifyBulkError(code).category, code).toBe("batch-limit");
    }
  });

  it("maps quota, rate limit, busy and timeout codes", () => {
    expect(classifyBulkError("QUOTA_EXCEEDED").category).toBe("daily-quota");
    expect(classifyBulkError("TOO_MANY_REQUESTS").category).toBe("rate-limited");
    expect(classifyBulkError("SERVER_BUSY").category).toBe("server-busy");
    expect(classifyBulkError("REQUEST_TIMEOUT").category).toBe("timeout");
  });

  it("marks transient categories as retryable", () => {
    expect(classifyBulkError("TOO_MANY_REQUESTS").retryable).toBe(true);
    expect(classifyBulkError("SERVER_BUSY").retryable).toBe(true);
    expect(classifyBulkError("REQUEST_TIMEOUT").retryable).toBe(true);
    expect(classifyBulkError("NETWORK_ERROR").retryable).toBe(true);
  });

  it("marks permanent validation errors as not retryable", () => {
    expect(classifyBulkError("INVALID_PDF").retryable).toBe(false);
    expect(classifyBulkError("QUOTA_EXCEEDED").retryable).toBe(false);
    expect(classifyBulkError("UNSUPPORTED_FILE").retryable).toBe(false);
  });

  it("maps unexpected codes to unknown without leaking internals", () => {
    const classification = classifyBulkError("SOME_NEW_CODE");
    expect(classification.category).toBe("unknown");
    expect(classification.retryable).toBe(true);
    expect(classification.description).not.toMatch(/stack|path|redis|database|prisma/i);
  });

  it("handles a missing code (client-side failure)", () => {
    const classification = classifyBulkError(undefined);
    expect(classification.category).toBe("unknown");
  });

  it("never includes technical internals in any message", () => {
    const all = [
      ...[
        "INVALID_PDF",
        "UNSUPPORTED_FILE",
        "FILE_TOO_LARGE",
        "TOO_MANY_FILES",
        "QUOTA_EXCEEDED",
        "TOO_MANY_REQUESTS",
        "SERVER_BUSY",
        "REQUEST_TIMEOUT",
        "PROCESSING_ERROR",
        "NETWORK_ERROR",
        undefined,
      ].map((code) => classifyBulkError(code)),
      cancelledClassification(),
    ];
    for (const classification of all) {
      expect(classification.label).not.toMatch(/\/|\.ts|node_modules/i);
      expect(classification.description).not.toMatch(
        /stack|trace|\/home\/|\/usr\/|redis|prisma|postgres|internal server/i,
      );
    }
  });

  it("classifies cancelled separately", () => {
    const classification = cancelledClassification();
    expect(classification.category).toBe("cancelled");
    expect(classification.retryable).toBe(true);
  });
});
