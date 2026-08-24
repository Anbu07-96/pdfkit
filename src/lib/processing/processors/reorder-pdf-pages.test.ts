// @vitest-environment node
import { EncryptedPDFError, PDFDocument } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import type { ProcessingInputFile } from "@/lib/processing/contract";
import { ProcessingError } from "@/lib/processing/errors";
import { reorderPdfPagesProcessor } from "@/lib/processing/processors/reorder-pdf-pages";
import { makeBrokenPdf, makeNumberedPdf, pageWidths } from "@/test/pdf-fixtures";

async function input(name: string, pages: number): Promise<ProcessingInputFile> {
  const bytes = await makeNumberedPdf(pages);
  return { id: "input-1", name, size: bytes.length, mimeType: "application/pdf", bytes };
}

async function reorder(file: ProcessingInputFile, order?: string) {
  return reorderPdfPagesProcessor.process({
    toolId: "reorder-pdf-pages",
    files: [file],
    options: { order },
  });
}

/** Which source pages the produced document contains, in order. */
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

describe("ReorderPdfPagesProcessor", () => {
  it("declares the tool id and single-file input rules", () => {
    expect(reorderPdfPagesProcessor.toolId).toBe("reorder-pdf-pages");
    expect(reorderPdfPagesProcessor.input.minFiles).toBe(1);
    expect(reorderPdfPagesProcessor.input.maxFiles).toBe(1);
    expect(reorderPdfPagesProcessor.input.extensions).toEqual([".pdf"]);
  });

  it("reorders a single-page document", async () => {
    const result = await reorder(await input("one.pdf", 1), "1");
    expect(await sourcePagesOf(result.artifacts[0].bytes)).toEqual([1]);
  });

  it("swaps the pages of a two-page document", async () => {
    const result = await reorder(await input("two.pdf", 2), "2,1");
    expect(await sourcePagesOf(result.artifacts[0].bytes)).toEqual([2, 1]);
  });

  it("reverses a five-page document", async () => {
    const result = await reorder(await input("document.pdf", 5), "5,4,3,2,1");

    const artifact = result.artifacts[0];
    expect(artifact.name).toBe("document-reordered.pdf");
    expect(artifact.mimeType).toBe("application/pdf");
    expect(artifact.size).toBe(artifact.bytes.length);
    expect(new TextDecoder().decode(artifact.bytes.slice(0, 5))).toBe("%PDF-");

    const document = await PDFDocument.load(artifact.bytes);
    expect(document.getPageCount()).toBe(5);
    expect(pageWidths(document).map((w) => w - 100)).toEqual([5, 4, 3, 2, 1]);
    expect(result.meta).toMatchObject({ pages: 5, outputPages: 5, changed: "yes" });
  });

  // The required page-identity proof: geometry ties each output page to a source page.
  it("applies an arbitrary permutation exactly", async () => {
    const result = await reorder(await input("doc.pdf", 5), "5,2,4,1,3");
    expect(await sourcePagesOf(result.artifacts[0].bytes)).toEqual([5, 2, 4, 1, 3]);
  });

  it("handles a ten-page permutation", async () => {
    const result = await reorder(
      await input("doc.pdf", 10),
      "10,1,9,2,8,3,7,4,6,5",
    );
    expect(await sourcePagesOf(result.artifacts[0].bytes)).toEqual([
      10, 1, 9, 2, 8, 3, 7, 4, 6, 5,
    ]);
  });

  it("accepts the identity order and reports that nothing moved", async () => {
    const result = await reorder(await input("doc.pdf", 5), "1,2,3,4,5");
    expect(await sourcePagesOf(result.artifacts[0].bytes)).toEqual([1, 2, 3, 4, 5]);
    expect(result.meta).toMatchObject({ changed: "no" });
  });

  it("rejects a duplicated page", async () => {
    const error = await expectFailure(
      reorder(await input("doc.pdf", 5), "1,2,3,3,5"),
      "INVALID_PAGE_ORDER",
    );
    expect(error.message).toMatch(/more than once/i);
  });

  it("rejects a missing page", async () => {
    const error = await expectFailure(
      reorder(await input("doc.pdf", 5), "1,2,3,5"),
      "INVALID_PAGE_ORDER",
    );
    expect(error.message).toMatch(/missing/i);
  });

  it("rejects an out-of-range page", async () => {
    const error = await expectFailure(
      reorder(await input("doc.pdf", 5), "1,2,3,4,6"),
      "PAGE_OUT_OF_RANGE",
    );
    expect(error.message).toContain("5 pages");
  });

  it("rejects a short order, an empty order and a missing order", async () => {
    const file = await input("doc.pdf", 5);
    await expectFailure(reorder(file, "1,2,3"), "INVALID_PAGE_ORDER");
    await expectFailure(reorder(file, ""), "INVALID_PAGE_ORDER");
    await expectFailure(reorder(file, "   "), "INVALID_PAGE_ORDER");
    await expectFailure(reorder(file, undefined), "INVALID_PAGE_ORDER");
  });

  it("rejects non-numeric and malformed orders", async () => {
    const file = await input("doc.pdf", 5);
    await expectFailure(reorder(file, "abc"), "INVALID_PAGE_ORDER");
    await expectFailure(reorder(file, "1,2,3,4,x"), "INVALID_PAGE_ORDER");
    await expectFailure(reorder(file, "1-5"), "INVALID_PAGE_ORDER");
    await expectFailure(reorder(file, "0,1,2,3,4"), "INVALID_PAGE_ORDER");
  });

  it("fails cleanly on a malformed PDF", async () => {
    const broken = makeBrokenPdf();
    await expectFailure(
      reorder(
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
      reorder(
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

  it("reports password-protected documents", async () => {
    const spy = vi
      .spyOn(PDFDocument, "load")
      .mockRejectedValueOnce(new EncryptedPDFError());

    try {
      const error = await expectFailure(
        reorder(await input("locked.pdf", 3), "1,2,3"),
        "ENCRYPTED_PDF",
      );
      expect(error.status).toBe(422);
    } finally {
      spy.mockRestore();
    }
  });

  it("validates the order before creating any output", async () => {
    // Build the fixture first: creating it would otherwise trip the spy.
    const file = await input("doc.pdf", 5);

    const createSpy = vi.spyOn(PDFDocument, "create");
    try {
      await expectFailure(reorder(file, "1,2,3,3,5"), "INVALID_PAGE_ORDER");
      // No output document was started, so no partial result can exist.
      expect(createSpy).not.toHaveBeenCalled();
    } finally {
      createSpy.mockRestore();
    }
  });

  it("sanitises the source name when naming the output", async () => {
    const result = await reorder(await input("../../secret.pdf", 2), "2,1");
    expect(result.artifacts[0].name).toBe("secret-reordered.pdf");
    expect(result.artifacts[0].name).not.toContain("/");
  });

  it("rejects a request with no file", async () => {
    await expectFailure(
      reorderPdfPagesProcessor.process({
        toolId: "reorder-pdf-pages",
        files: [],
        options: { order: "1" },
      }),
      "VALIDATION_ERROR",
    );
  });
});
