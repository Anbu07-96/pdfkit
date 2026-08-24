// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { ProcessingInputFile } from "@/lib/processing/contract";
import { ProcessingError } from "@/lib/processing/errors";
import { DEFAULT_PROCESSING_LIMITS } from "@/lib/processing/limits";
import { MERGE_PDF_INPUT_RULES } from "@/lib/processing/rules";
import {
  hasPdfSignature,
  validateProcessingInput,
} from "@/lib/processing/validation/pdf-input";

const encoder = new TextEncoder();

function input(
  overrides: Partial<ProcessingInputFile> & { content?: string } = {},
): ProcessingInputFile {
  const { content = "%PDF-1.7\n...", ...rest } = overrides;
  const bytes = rest.bytes ?? encoder.encode(content);
  return {
    id: "input-1",
    name: "document.pdf",
    mimeType: "application/pdf",
    size: bytes.length,
    bytes,
    ...rest,
  };
}

function validate(files: ProcessingInputFile[], limits = DEFAULT_PROCESSING_LIMITS) {
  validateProcessingInput({ files, rules: MERGE_PDF_INPUT_RULES, limits });
}

function expectError(fn: () => void, code: string) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ProcessingError);
    expect((error as ProcessingError).code).toBe(code);
    return error as ProcessingError;
  }
  throw new Error(`Expected a ${code} ProcessingError, but nothing was thrown.`);
}

describe("hasPdfSignature", () => {
  it("accepts a document starting with %PDF-", () => {
    expect(hasPdfSignature(encoder.encode("%PDF-1.4\n"))).toBe(true);
  });

  it("accepts a signature preceded by a little junk", () => {
    expect(hasPdfSignature(encoder.encode("\n\n   %PDF-1.7"))).toBe(true);
  });

  it("rejects other content, whatever it is called", () => {
    expect(hasPdfSignature(encoder.encode("<html><body>hi</body></html>"))).toBe(false);
    expect(hasPdfSignature(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
    expect(hasPdfSignature(new Uint8Array())).toBe(false);
  });

  it("does not scan beyond the first kilobyte", () => {
    const padded = encoder.encode(" ".repeat(2000) + "%PDF-1.7");
    expect(hasPdfSignature(padded)).toBe(false);
  });
});

describe("validateProcessingInput", () => {
  it("accepts a valid pair of PDFs", () => {
    expect(() => validate([input(), input({ id: "input-2", name: "b.pdf" })])).not.toThrow();
  });

  it("rejects an empty request", () => {
    expectError(() => validate([]), "VALIDATION_ERROR");
  });

  it("enforces the minimum number of files for the tool", () => {
    const error = expectError(() => validate([input()]), "VALIDATION_ERROR");
    expect(error.message).toMatch(/at least 2 files/i);
  });

  it("enforces the maximum number of files", () => {
    const files = Array.from({ length: 4 }, (_, index) =>
      input({ id: `input-${index}`, name: `file-${index}.pdf` }),
    );
    expectError(
      () => validate(files, { ...DEFAULT_PROCESSING_LIMITS, maxFiles: 3 }),
      "TOO_MANY_FILES",
    );
  });

  it("rejects unsupported extensions even when the MIME type looks right", () => {
    const error = expectError(
      () => validate([input(), input({ id: "2", name: "sneaky.exe" })]),
      "UNSUPPORTED_FILE",
    );
    expect(error.details?.[0]).toContain("sneaky.exe");
  });

  it("rejects a browser MIME type that is not allowed", () => {
    expectError(
      () => validate([input(), input({ id: "2", name: "b.pdf", mimeType: "image/png" })]),
      "UNSUPPORTED_FILE",
    );
  });

  it("rejects empty files", () => {
    expectError(
      () => validate([input(), input({ id: "2", name: "b.pdf", bytes: new Uint8Array(), size: 0 })]),
      "VALIDATION_ERROR",
    );
  });

  it("rejects files above the per-file limit", () => {
    const big = input({
      id: "2",
      name: "big.pdf",
      bytes: encoder.encode("%PDF-1.7" + "x".repeat(500)),
    });
    expectError(
      () => validate([input(), big], { ...DEFAULT_PROCESSING_LIMITS, maxFileSize: 100 }),
      "FILE_TOO_LARGE",
    );
  });

  it("rejects content that is not a PDF, whatever the name says", () => {
    const disguised = input({
      id: "2",
      name: "invoice.pdf",
      mimeType: "application/pdf",
      content: "GIF89a this is not a pdf",
    });
    const error = expectError(() => validate([input(), disguised]), "INVALID_PDF");
    expect(error.details?.[0]).toContain("invoice.pdf");
  });

  it("rejects a request above the total size limit", () => {
    const files = [input(), input({ id: "2", name: "b.pdf" })];
    expectError(
      () =>
        validate(files, {
          ...DEFAULT_PROCESSING_LIMITS,
          maxFileSize: 1000,
          maxTotalSize: 10,
        }),
      "TOTAL_SIZE_EXCEEDED",
    );
  });
});
