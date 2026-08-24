// @vitest-environment node
import { EncryptedPDFError, PDFDocument } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import type {
  ProcessingContext,
  ProcessingInputFile,
} from "@/lib/processing/contract";
import { ProcessingError } from "@/lib/processing/errors";
import { DEFAULT_PROCESSING_LIMITS } from "@/lib/processing/limits";
import {
  splitPdfProcessor,
  type SplitPdfOptions,
} from "@/lib/processing/processors/split-pdf";
import {
  expectedWidths,
  makeBrokenPdf,
  makeNumberedPdf,
  pageWidths,
} from "@/test/pdf-fixtures";

const context: ProcessingContext = { limits: DEFAULT_PROCESSING_LIMITS };

async function input(name: string, pages: number): Promise<ProcessingInputFile> {
  const bytes = await makeNumberedPdf(pages);
  return { id: "input-1", name, size: bytes.length, mimeType: "application/pdf", bytes };
}

async function split(
  file: ProcessingInputFile,
  options: SplitPdfOptions,
  ctx: ProcessingContext = context,
) {
  return splitPdfProcessor.process({ toolId: "split-pdf", files: [file], options }, ctx);
}

/** Page widths of an artifact, revealing exactly which source pages it holds. */
async function widthsOf(bytes: Uint8Array): Promise<number[]> {
  return pageWidths(await PDFDocument.load(bytes));
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

describe("SplitPdfProcessor", () => {
  it("declares the tool id and single-file input rules", () => {
    expect(splitPdfProcessor.toolId).toBe("split-pdf");
    expect(splitPdfProcessor.input.minFiles).toBe(1);
    expect(splitPdfProcessor.input.maxFiles).toBe(1);
    expect(splitPdfProcessor.input.extensions).toEqual([".pdf"]);
  });

  // Test 1 — every page
  it("splits a 5-page PDF into 5 single-page PDFs", async () => {
    const result = await split(await input("document.pdf", 5), { mode: "every-page" });

    expect(result.artifacts).toHaveLength(5);
    expect(result.meta).toMatchObject({ pages: 5, outputs: 5, mode: "every-page" });
    expect(result.bundleName).toBe("document-split.zip");

    for (const [index, artifact] of result.artifacts.entries()) {
      expect(artifact.name).toBe(`document-${index + 1}.pdf`);
      expect(artifact.mimeType).toBe("application/pdf");
      expect(artifact.size).toBe(artifact.bytes.length);
      expect(artifact.size).toBeGreaterThan(0);

      const document = await PDFDocument.load(artifact.bytes);
      expect(document.getPageCount()).toBe(1);
      // Output n must contain source page n, not some other page.
      expect(pageWidths(document)).toEqual(expectedWidths([index + 1]));
    }
  });

  // Test 2 — ranges
  it("splits a 10-page PDF into the requested ranges", async () => {
    const result = await split(await input("report.pdf", 10), {
      mode: "ranges",
      ranges: "1-3, 4-7, 8-10",
    });

    expect(result.artifacts).toHaveLength(3);
    expect(result.artifacts.map((artifact) => artifact.name)).toEqual([
      "report-part-1.pdf",
      "report-part-2.pdf",
      "report-part-3.pdf",
    ]);

    const counts = [];
    for (const artifact of result.artifacts) {
      counts.push((await PDFDocument.load(artifact.bytes)).getPageCount());
    }
    expect(counts).toEqual([3, 4, 3]);
    expect(result.meta).toMatchObject({ pages: 10, outputs: 3, selection: "1-3, 4-7, 8-10" });
  });

  // Test 3 — ordering
  it("keeps pages in the requested order, including unsorted ranges", async () => {
    const file = await input("doc.pdf", 10);

    const ordered = await split(file, { mode: "ranges", ranges: "4-6" });
    expect(await widthsOf(ordered.artifacts[0].bytes)).toEqual(expectedWidths([4, 5, 6]));

    const unsorted = await split(file, { mode: "ranges", ranges: "8-9, 1-2" });
    expect(await widthsOf(unsorted.artifacts[0].bytes)).toEqual(expectedWidths([8, 9]));
    expect(await widthsOf(unsorted.artifacts[1].bytes)).toEqual(expectedWidths([1, 2]));
  });

  // Test 4 — single range
  it("produces one document for a single range", async () => {
    const result = await split(await input("doc.pdf", 10), {
      mode: "ranges",
      ranges: "1-5",
    });

    expect(result.artifacts).toHaveLength(1);
    const document = await PDFDocument.load(result.artifacts[0].bytes);
    expect(document.getPageCount()).toBe(5);
    expect(pageWidths(document)).toEqual(expectedWidths([1, 2, 3, 4, 5]));
    expect(document.getCreator()).toBe("PDFKit");
  });

  // Test 5 — invalid range
  it("rejects invalid range syntax", async () => {
    const file = await input("doc.pdf", 10);

    await expectFailure(split(file, { mode: "ranges", ranges: "abc" }), "INVALID_PAGE_RANGE");
    await expectFailure(split(file, { mode: "ranges", ranges: "3-1" }), "INVALID_PAGE_RANGE");
    await expectFailure(split(file, { mode: "ranges", ranges: "0" }), "INVALID_PAGE_RANGE");
    await expectFailure(split(file, { mode: "ranges", ranges: "" }), "INVALID_PAGE_RANGE");
    await expectFailure(split(file, { mode: "ranges" }), "INVALID_PAGE_RANGE");
  });

  // Test 6 — out of range
  it("rejects pages beyond the end of the document", async () => {
    const error = await expectFailure(
      split(await input("doc.pdf", 20), { mode: "ranges", ranges: "1-100" }),
      "PAGE_OUT_OF_RANGE",
    );
    expect(error.message).toContain("20 pages");
  });

  // Test 7 — overlapping ranges
  it("rejects overlapping ranges", async () => {
    const error = await expectFailure(
      split(await input("doc.pdf", 10), { mode: "ranges", ranges: "1-5, 4-8" }),
      "OVERLAPPING_RANGES",
    );
    expect(error.message).toMatch(/overlapping/i);
  });

  // Test 8 — output limit
  it("refuses to exceed the configured output limit, before producing anything", async () => {
    const error = await expectFailure(
      split(
        await input("doc.pdf", 12),
        { mode: "every-page" },
        { limits: { ...DEFAULT_PROCESSING_LIMITS, maxOutputs: 5 } },
      ),
      "TOO_MANY_OUTPUTS",
    );
    expect(error.message).toContain("12");
    expect(error.message).toContain("5");
  });

  it("allows an output count exactly at the limit", async () => {
    const result = await split(
      await input("doc.pdf", 5),
      { mode: "every-page" },
      { limits: { ...DEFAULT_PROCESSING_LIMITS, maxOutputs: 5 } },
    );
    expect(result.artifacts).toHaveLength(5);
  });

  // Test 9 — malformed PDF
  it("fails cleanly on a malformed PDF", async () => {
    const broken = makeBrokenPdf();
    await expectFailure(
      split(
        {
          id: "input-1",
          name: "broken.pdf",
          size: broken.length,
          mimeType: "application/pdf",
          bytes: broken,
        },
        { mode: "every-page" },
      ),
      "INVALID_PDF",
    );
  });

  it("fails cleanly on a document with an unreadable page tree", async () => {
    const structurallyBroken = new TextEncoder().encode(
      "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF",
    );
    await expectFailure(
      split(
        {
          id: "input-1",
          name: "damaged.pdf",
          size: structurallyBroken.length,
          mimeType: "application/pdf",
          bytes: structurallyBroken,
        },
        { mode: "every-page" },
      ),
      "INVALID_PDF",
    );
  });

  // Test 10 — encrypted PDF
  it("reports password-protected documents with a dedicated code", async () => {
    const spy = vi
      .spyOn(PDFDocument, "load")
      .mockRejectedValueOnce(new EncryptedPDFError());

    try {
      const error = await expectFailure(
        split(await input("locked.pdf", 3), { mode: "every-page" }),
        "ENCRYPTED_PDF",
      );
      expect(error.status).toBe(422);
      expect(error.details?.[0]).toContain("locked.pdf");
    } finally {
      spy.mockRestore();
    }
  });

  it("rejects a missing or unknown split mode", async () => {
    const file = await input("doc.pdf", 3);
    await expectFailure(
      split(file, { mode: "sideways" as never }),
      "INVALID_SPLIT_CONFIGURATION",
    );
    await expectFailure(
      splitPdfProcessor.process({ toolId: "split-pdf", files: [file] }, context),
      "INVALID_SPLIT_CONFIGURATION",
    );
  });

  it("sanitises the source name when naming outputs", async () => {
    const result = await split(await input("../../etc/pa ssword.pdf", 2), {
      mode: "every-page",
    });

    for (const artifact of result.artifacts) {
      expect(artifact.name).not.toContain("/");
      expect(artifact.name).not.toContain("..");
    }
    expect(result.artifacts[0].name).toBe("pa ssword-1.pdf");
  });

  it("handles a one-page document", async () => {
    const result = await split(await input("single.pdf", 1), { mode: "every-page" });
    expect(result.artifacts).toHaveLength(1);
    expect((await PDFDocument.load(result.artifacts[0].bytes)).getPageCount()).toBe(1);
  });
});

describe("multi-artifact contract", () => {
  it("returns several artifacts from one input, each complete", async () => {
    const result = await split(await input("doc.pdf", 4), { mode: "every-page" });

    expect(result.status).toBe("succeeded");
    expect(result.artifacts.length).toBeGreaterThan(1);

    for (const artifact of result.artifacts) {
      expect(artifact.name).toMatch(/\.pdf$/);
      expect(artifact.mimeType).toBe("application/pdf");
      expect(artifact.bytes.length).toBeGreaterThan(0);
      expect(artifact.size).toBe(artifact.bytes.length);
      expect(new TextDecoder().decode(artifact.bytes.slice(0, 5))).toBe("%PDF-");
    }
  });
});
