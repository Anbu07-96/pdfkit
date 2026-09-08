// @vitest-environment node
import { describe, expect, it } from "vitest";
import { batchCsvFileName, buildBatchCsv } from "@/lib/bulk/csv";
import type { BulkFileResult } from "@/lib/bulk/runner";

function result(overrides: Partial<BulkFileResult> = {}): BulkFileResult {
  return {
    id: "f1",
    name: "doc.pdf",
    size: 1024,
    status: "succeeded",
    ...overrides,
  };
}

describe("buildBatchCsv", () => {
  it("writes a header row and one row per file", () => {
    const csv = buildBatchCsv({
      operation: "pdf-to-word",
      results: [
        result({ id: "a", name: "a.pdf", fileName: "a.docx", blob: { size: 10 } as Blob }),
        result({ id: "b", name: "b.pdf", status: "failed", error: { code: "INVALID_PDF", message: "Not a readable PDF." } }),
      ],

    });

    const lines = csv.trimEnd().split("\r\n");
    expect(lines[0]).toBe(
      "filename,operation,status,output_filename,input_bytes,output_bytes,duration_ms,error_code,error_message",
    );
    expect(lines[1]).toBe("a.pdf,pdf-to-word,succeeded,a.docx,1024,10,,,");
    expect(lines[2]).toBe(
      "b.pdf,pdf-to-word,failed,,1024,,,INVALID_PDF,Not a readable PDF.",
    );
  });

  it("escapes commas in fields", () => {
    const csv = buildBatchCsv({
      operation: "pdf-to-word",
      results: [result({ name: "report, final.pdf" })],

    });
    expect(csv).toContain('"report, final.pdf"');
  });

  it("escapes quotes by doubling them", () => {
    const csv = buildBatchCsv({
      operation: "pdf-to-text",
      results: [
        result({
          status: "failed",
          error: { code: "PROCESSING_ERROR", message: 'Bad "quote" inside' },
        }),
      ],

    });
    expect(csv).toContain('"Bad ""quote"" inside"');
  });

  it("escapes newlines inside a field without breaking the row structure", () => {
    const csv = buildBatchCsv({
      operation: "pdf-to-text",
      results: [
        result({
          status: "failed",
          error: { code: "PROCESSING_ERROR", message: "line one\nline two" },
        }),
      ],

    });

    // The quoted field keeps the embedded newline; parsing it back yields the
    // original message.
    const rows = csv.trimEnd().split("\r\n");
    expect(rows).toHaveLength(2); // header + one row
    expect(rows[1]).toContain('"line one\nline two"');
  });

  it("keeps Unicode filenames intact", () => {
    const csv = buildBatchCsv({
      operation: "extract-images",
      results: [result({ name: "文档.pdf", fileName: "文档-p1-img1.png" })],

    });
    expect(csv).toContain("文档.pdf");
    expect(csv).toContain("文档-p1-img1.png");
  });

  it("neutralises spreadsheet formula injection in filenames and messages", () => {
    const csv = buildBatchCsv({
      operation: "pdf-to-word",
      results: [
        result({ name: "=HYPERLINK(\"http://evil\",\"click\").pdf" }),
        result({ id: "b", name: "+cmd.pdf" }),
        result({ id: "c", name: "-2+3.pdf" }),
        result({ id: "d", name: "@sum(a1:a2).pdf" }),
      ],

    });

    // Every dangerous cell starts with an apostrophe so spreadsheet engines
    // render it as text instead of evaluating a formula.
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("'+cmd.pdf");
    expect(csv).toContain("'-2+3.pdf");
    expect(csv).toContain("'@sum(a1:a2).pdf");
    expect(csv).not.toMatch(/(^|[\r\n,])=[A-Z]/);
  });

  it("leaves ordinary numeric fields untouched (no false formula positives)", () => {
    const csv = buildBatchCsv({
      operation: "pdf-to-word",
      results: [result({ size: 1024, durationMs: 250 })],

    });
    expect(csv).toContain(",1024,");
    expect(csv).toContain(",250,");
  });

  it("ends with a CRLF per RFC 4180", () => {
    const csv = buildBatchCsv({
      operation: "pdf-to-word",
      results: [result()],

    });
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("suggests a stable download filename", () => {
    expect(batchCsvFileName("pdf-to-word")).toBe("pdf-to-word-batch-results.csv");
  });
});
