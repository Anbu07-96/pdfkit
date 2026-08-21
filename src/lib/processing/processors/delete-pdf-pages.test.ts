// @vitest-environment node
import { EncryptedPDFError, PDFDocument } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import type { ProcessingInputFile } from "@/lib/processing/contract";
import { ProcessingError } from "@/lib/processing/errors";
import { deletePdfPagesProcessor } from "@/lib/processing/processors/delete-pdf-pages";
import { makeBrokenPdf, makeNumberedPdf, pageWidths } from "@/test/pdf-fixtures";

async function input(name: string, pages: number): Promise<ProcessingInputFile> {
  const bytes = await makeNumberedPdf(pages);
  return { id: "input-1", name, size: bytes.length, mimeType: "application/pdf", bytes };
}

async function remove(file: ProcessingInputFile, ranges?: string) {
  return deletePdfPagesProcessor.process({
    toolId: "delete-pdf-pages",
    files: [file],
    options: { ranges },
  });
}

/** Which source pages survived, in order. */
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

describe("DeletePdfPagesProcessor", () => {
  it("declares the tool id and single-file input rules", () => {
    expect(deletePdfPagesProcessor.toolId).toBe("delete-pdf-pages");
    expect(deletePdfPagesProcessor.input.minFiles).toBe(1);
    expect(deletePdfPagesProcessor.input.maxFiles).toBe(1);
  });

  // Test 1 — single middle page
  it("removes a single page and keeps the rest in order", async () => {
    const result = await remove(await input("document.pdf", 5), "3");

    expect(result.artifacts).toHaveLength(1);
    const artifact = result.artifacts[0];
    expect(artifact.name).toBe("document-pages-removed.pdf");
    expect(artifact.mimeType).toBe("application/pdf");
    expect(new TextDecoder().decode(artifact.bytes.slice(0, 5))).toBe("%PDF-");

    // The selection is what is REMOVED, not what is kept.
    expect(await sourcePagesOf(artifact.bytes)).toEqual([1, 2, 4, 5]);
    expect(result.meta).toMatchObject({
      pages: 5,
      outputPages: 4,
      removed: 1,
      selection: "3",
    });
  });

  // Test 2 — first page
  it("removes the first page", async () => {
    const result = await remove(await input("doc.pdf", 5), "1");
    expect(await sourcePagesOf(result.artifacts[0].bytes)).toEqual([2, 3, 4, 5]);
  });

  // Test 3 — last page
  it("removes the last page", async () => {
    const result = await remove(await input("doc.pdf", 5), "5");
    expect(await sourcePagesOf(result.artifacts[0].bytes)).toEqual([1, 2, 3, 4]);
  });

  // Test 4 — middle range
  it("removes a middle range", async () => {
    const result = await remove(await input("doc.pdf", 10), "3-7");
    expect(await sourcePagesOf(result.artifacts[0].bytes)).toEqual([1, 2, 8, 9, 10]);
    expect(result.meta).toMatchObject({ removed: 5, outputPages: 5 });
  });

  // Test 5 — non-contiguous pages
  it("removes non-contiguous pages", async () => {
    const result = await remove(await input("doc.pdf", 7), "2, 4, 6");
    expect(await sourcePagesOf(result.artifacts[0].bytes)).toEqual([1, 3, 5, 7]);
  });

  it("keeps the original order even when the selection is unsorted", async () => {
    const result = await remove(await input("doc.pdf", 7), "6, 2, 4");
    expect(await sourcePagesOf(result.artifacts[0].bytes)).toEqual([1, 3, 5, 7]);
  });

  // Test 6 — all but first
  it("can leave only the first page", async () => {
    const result = await remove(await input("doc.pdf", 5), "2-5");
    expect(await sourcePagesOf(result.artifacts[0].bytes)).toEqual([1]);
    expect(result.meta).toMatchObject({ outputPages: 1, removed: 4 });
  });

  // Test 7 — all but last
  it("can leave only the last page", async () => {
    const result = await remove(await input("doc.pdf", 5), "1-4");
    expect(await sourcePagesOf(result.artifacts[0].bytes)).toEqual([5]);
  });

  // Test 8 — delete every page
  it("refuses to delete every page and produces nothing", async () => {
    const error = await expectFailure(
      remove(await input("doc.pdf", 5), "1-5"),
      "NO_PAGES_REMAIN",
    );
    expect(error.status).toBe(400);
    expect(error.message).toMatch(/at least one page/i);
  });

  it("refuses to delete every page listed individually", async () => {
    await expectFailure(remove(await input("doc.pdf", 3), "1,2,3"), "NO_PAGES_REMAIN");
  });

  it("refuses to delete the only page of a one-page document", async () => {
    await expectFailure(remove(await input("doc.pdf", 1), "1"), "NO_PAGES_REMAIN");
  });

  // Test 9 — invalid range
  it("rejects invalid syntax", async () => {
    const file = await input("doc.pdf", 5);
    await expectFailure(remove(file, "abc"), "INVALID_PAGE_RANGE");
    await expectFailure(remove(file, "4-2"), "INVALID_PAGE_RANGE");
    await expectFailure(remove(file, "0"), "INVALID_PAGE_RANGE");
    await expectFailure(remove(file, ""), "INVALID_PAGE_RANGE");
    await expectFailure(remove(file, undefined), "INVALID_PAGE_RANGE");
  });

  // Test 10 — out of range
  it("rejects pages beyond the document", async () => {
    const error = await expectFailure(
      remove(await input("doc.pdf", 5), "9"),
      "PAGE_OUT_OF_RANGE",
    );
    expect(error.message).toContain("5 pages");
  });

  // Test 11 — overlap
  it("rejects overlapping ranges", async () => {
    await expectFailure(
      remove(await input("doc.pdf", 10), "1-5, 4-8"),
      "OVERLAPPING_RANGES",
    );
  });

  // Test 12 — malformed PDF
  it("fails cleanly on a malformed PDF", async () => {
    const broken = makeBrokenPdf();
    await expectFailure(
      remove(
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

  // Test 13 — encrypted PDF
  it("reports password-protected documents", async () => {
    const spy = vi
      .spyOn(PDFDocument, "load")
      .mockRejectedValueOnce(new EncryptedPDFError());

    try {
      const error = await expectFailure(
        remove(await input("locked.pdf", 3), "1"),
        "ENCRYPTED_PDF",
      );
      expect(error.status).toBe(422);
    } finally {
      spy.mockRestore();
    }
  });

  it("sanitises the source name when naming the output", async () => {
    const result = await remove(await input("../../etc/pa ssword.pdf", 3), "1");
    expect(result.artifacts[0].name).toBe("pa ssword-pages-removed.pdf");
    expect(result.artifacts[0].name).not.toContain("/");
  });

  it("rejects a request with no file", async () => {
    await expectFailure(
      deletePdfPagesProcessor.process({
        toolId: "delete-pdf-pages",
        files: [],
        options: { ranges: "1" },
      }),
      "VALIDATION_ERROR",
    );
  });
});

describe("Extract and Delete are complements, not duplicates", () => {
  it("produce opposite page sets from the same selection", async () => {
    const { extractPdfPagesProcessor } = await import(
      "@/lib/processing/processors/extract-pdf-pages"
    );

    const kept = await extractPdfPagesProcessor.process({
      toolId: "extract-pdf-pages",
      files: [await input("doc.pdf", 5)],
      options: { ranges: "2, 4" },
    });
    const removed = await remove(await input("doc.pdf", 5), "2, 4");

    expect(await sourcePagesOf(kept.artifacts[0].bytes)).toEqual([2, 4]);
    expect(await sourcePagesOf(removed.artifacts[0].bytes)).toEqual([1, 3, 5]);
  });
});
