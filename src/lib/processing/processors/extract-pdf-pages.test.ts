// @vitest-environment node
import { EncryptedPDFError, PDFDocument } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import type { ProcessingInputFile } from "@/lib/processing/contract";
import { ProcessingError } from "@/lib/processing/errors";
import { extractPdfPagesProcessor } from "@/lib/processing/processors/extract-pdf-pages";
import {
  expectedWidths,
  makeBrokenPdf,
  makeNumberedPdf,
  pageWidths,
} from "@/test/pdf-fixtures";

async function input(name: string, pages: number): Promise<ProcessingInputFile> {
  const bytes = await makeNumberedPdf(pages);
  return { id: "input-1", name, size: bytes.length, mimeType: "application/pdf", bytes };
}

async function extract(file: ProcessingInputFile, ranges?: string) {
  return extractPdfPagesProcessor.process({
    toolId: "extract-pdf-pages",
    files: [file],
    options: { ranges },
  });
}

/** Which source pages the produced document actually contains, in order. */
async function sourcePagesOf(bytes: Uint8Array): Promise<number[]> {
  const document = await PDFDocument.load(bytes);
  return pageWidths(document).map((width) => width - 100);
}

async function expectFailure(promise: Promise<unknown>, code: string) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ProcessingError);
    expect((error as ProcessingError).code).toBe(code);
    return error as ProcessingError;
  }
  throw new Error(`Expected a ${code} ProcessingError, but the call succeeded.`);
}

describe("ExtractPdfPagesProcessor", () => {
  it("declares the tool id and single-file input rules", () => {
    expect(extractPdfPagesProcessor.toolId).toBe("extract-pdf-pages");
    expect(extractPdfPagesProcessor.input.minFiles).toBe(1);
    expect(extractPdfPagesProcessor.input.maxFiles).toBe(1);
    expect(extractPdfPagesProcessor.input.extensions).toEqual([".pdf"]);
  });

  // Test 1 — single page
  it("extracts a single page", async () => {
    const result = await extract(await input("document.pdf", 5), "3");

    expect(result.artifacts).toHaveLength(1);
    const artifact = result.artifacts[0];
    expect(artifact.name).toBe("document-extracted.pdf");
    expect(artifact.mimeType).toBe("application/pdf");
    expect(artifact.size).toBe(artifact.bytes.length);
    expect(new TextDecoder().decode(artifact.bytes.slice(0, 5))).toBe("%PDF-");

    const document = await PDFDocument.load(artifact.bytes);
    expect(document.getPageCount()).toBe(1);
    expect(pageWidths(document)).toEqual(expectedWidths([3]));
    expect(result.meta).toMatchObject({ pages: 5, outputPages: 1, selection: "3" });
  });

  // Test 2 — range
  it("extracts a contiguous range", async () => {
    const result = await extract(await input("doc.pdf", 5), "2-4");
    expect(await sourcePagesOf(result.artifacts[0].bytes)).toEqual([2, 3, 4]);
  });

  // Test 3 — multiple ranges
  it("extracts several ranges into one document", async () => {
    const result = await extract(await input("doc.pdf", 5), "1-2, 4-5");
    expect(await sourcePagesOf(result.artifacts[0].bytes)).toEqual([1, 2, 4, 5]);
    expect(result.meta).toMatchObject({ outputPages: 4 });
  });

  // Test 4 — reversed range order
  it("preserves the order the user selected, without sorting", async () => {
    const result = await extract(await input("doc.pdf", 5), "4-5, 1-2");
    expect(await sourcePagesOf(result.artifacts[0].bytes)).toEqual([4, 5, 1, 2]);
  });

  it("preserves order for non-contiguous selections", async () => {
    const result = await extract(await input("doc.pdf", 10), "8-10, 1-2, 5");
    expect(await sourcePagesOf(result.artifacts[0].bytes)).toEqual([8, 9, 10, 1, 2, 5]);
  });

  // Test 5 — all pages
  it("extracts every page and still returns a single PDF", async () => {
    const result = await extract(await input("doc.pdf", 5), "1-5");
    expect(result.artifacts).toHaveLength(1);
    expect(await sourcePagesOf(result.artifacts[0].bytes)).toEqual([1, 2, 3, 4, 5]);
  });

  // Test 6 — out of range
  it("rejects pages beyond the document", async () => {
    const error = await expectFailure(
      extract(await input("doc.pdf", 5), "6"),
      "PAGE_OUT_OF_RANGE",
    );
    expect(error.message).toContain("5 pages");
  });

  // Test 7 — invalid syntax
  it("rejects invalid syntax", async () => {
    const file = await input("doc.pdf", 5);
    await expectFailure(extract(file, "abc"), "INVALID_PAGE_RANGE");
    await expectFailure(extract(file, "3-1"), "INVALID_PAGE_RANGE");
    await expectFailure(extract(file, "0"), "INVALID_PAGE_RANGE");
    await expectFailure(extract(file, ""), "INVALID_PAGE_RANGE");
    await expectFailure(extract(file, undefined), "INVALID_PAGE_RANGE");
  });

  // Test 8 — overlap
  it("rejects overlapping ranges, matching Split PDF", async () => {
    const error = await expectFailure(
      extract(await input("doc.pdf", 5), "1-4, 3-5"),
      "OVERLAPPING_RANGES",
    );
    expect(error.message).toMatch(/overlapping/i);
  });

  // Test 9 — malformed PDF
  it("fails cleanly on a malformed PDF", async () => {
    const broken = makeBrokenPdf();
    await expectFailure(
      extract(
        {
          id: "input-1",
          name: "broken.pdf",
          size: broken.length,
          mimeType: "application/pdf",
          bytes: broken,
        },
        "1",
      ),
      "INVALID_PDF",
    );
  });

  it("fails cleanly on a document with an unreadable page tree", async () => {
    const damaged = new TextEncoder().encode(
      "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF",
    );
    await expectFailure(
      extract(
        {
          id: "input-1",
          name: "damaged.pdf",
          size: damaged.length,
          mimeType: "application/pdf",
          bytes: damaged,
        },
        "1",
      ),
      "INVALID_PDF",
    );
  });

  // Test 10 — encrypted PDF
  it("reports password-protected documents", async () => {
    const spy = vi
      .spyOn(PDFDocument, "load")
      .mockRejectedValueOnce(new EncryptedPDFError());

    try {
      const error = await expectFailure(
        extract(await input("locked.pdf", 3), "1"),
        "ENCRYPTED_PDF",
      );
      expect(error.status).toBe(422);
      expect(error.details?.[0]).toContain("locked.pdf");
    } finally {
      spy.mockRestore();
    }
  });

  it("sanitises the source name when naming the output", async () => {
    const result = await extract(await input("../../etc/pa ssword.pdf", 3), "1");
    expect(result.artifacts[0].name).toBe("pa ssword-extracted.pdf");
    expect(result.artifacts[0].name).not.toContain("/");
  });

  it("rejects a request with no file", async () => {
    await expectFailure(
      extractPdfPagesProcessor.process({
        toolId: "extract-pdf-pages",
        files: [],
        options: { ranges: "1" },
      }),
      "VALIDATION_ERROR",
    );
  });
});
