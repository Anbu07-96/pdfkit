// @vitest-environment node
import { PDFDocument, StandardFonts, degrees } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import type { ProcessingInputFile } from "@/lib/processing/contract";
import { ProcessingError } from "@/lib/processing/errors";
import { cropProcessor } from "@/lib/processing/processors/crop";
import { runProcessingJob } from "@/lib/processing/service";
import { makeBrokenPdf, makeNumberedPdf } from "@/test/pdf-fixtures";

async function input(name: string, bytes: Uint8Array): Promise<ProcessingInputFile> {
  return {
    id: "input-1",
    name,
    size: bytes.length,
    mimeType: "application/pdf",
    bytes,
  };
}

async function crop(
  name: string,
  bytes: Uint8Array,
  options: Record<string, unknown>,
) {
  return cropProcessor.process({
    toolId: "crop",
    files: [await input(name, bytes)],
    options,
  });
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

const RECT = { mode: "rectangle", x: "10", y: "10", width: "200", height: "150" };
const MARGINS = { mode: "margins", top: "20", right: "10", bottom: "5", left: "15" };

/** A page whose text sits both inside and outside a crop area. */
async function seededPdf(pages = 1): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (let index = 0; index < pages; index += 1) {
    const page = document.addPage([612, 792]);
    page.drawText(`INSIDE-Keep-${index + 1}`, { x: 30, y: 40, size: 12, font });
    page.drawText(`OUTSIDE-Secret-${index + 1}`, { x: 30, y: 700, size: 12, font });
  }
  return document.save();
}

describe("CropProcessor", () => {
  it("declares the tool id and single-file input rules", () => {
    expect(cropProcessor.toolId).toBe("crop");
    expect(cropProcessor.input.minFiles).toBe(1);
    expect(cropProcessor.input.maxFiles).toBe(1);
    expect(cropProcessor.input.extensions).toEqual([".pdf"]);
  });

  it("sets the CropBox on every page by default and touches nothing else", async () => {
    const result = await crop("doc.pdf", await seededPdf(3), RECT);

    const artifact = result.artifacts[0];
    expect(artifact.name).toBe("crop.pdf"); // fixed name, no source filename
    expect(artifact.mimeType).toBe("application/pdf");
    expect(new TextDecoder().decode(artifact.bytes.slice(0, 5))).toBe("%PDF-");

    const document = await PDFDocument.load(artifact.bytes);
    expect(document.getPageCount()).toBe(3);
    for (let index = 0; index < 3; index += 1) {
      const page = document.getPage(index);
      expect(page.getCropBox()).toEqual({ x: 10, y: 10, width: 200, height: 150 });
      // MediaBox unchanged; page identity via MediaBox widths still works.
      expect(page.getMediaBox()).toEqual({ x: 0, y: 0, width: 612, height: 792 });
    }
    expect(result.meta).toMatchObject({
      pages: 3,
      outputPages: 3,
      croppedPages: 3,
    });
  });

  it("crops only the selected pages and leaves the rest untouched", async () => {
    const result = await crop("doc.pdf", await seededPdf(4), {
      ...RECT,
      ranges: "1, 3-4",
    });
    const document = await PDFDocument.load(result.artifacts[0].bytes);

    const cropped = { x: 10, y: 10, width: 200, height: 150 };
    const original = { x: 0, y: 0, width: 612, height: 792 };
    expect(document.getPage(0).getCropBox()).toEqual(cropped);
    expect(document.getPage(1).getCropBox()).toEqual(original); // page 2 skipped
    expect(document.getPage(2).getCropBox()).toEqual(cropped);
    expect(document.getPage(3).getCropBox()).toEqual(cropped);
    expect(result.meta).toMatchObject({ croppedPages: 3, pages: 4 });
  });

  it("computes margins per page across heterogeneous page sizes", async () => {
    const document = await PDFDocument.create();
    document.addPage([612, 792]); // Letter
    document.addPage([300, 200]); // small
    const bytes = await document.save();

    const result = await crop("mixed.pdf", bytes, MARGINS);
    const output = await PDFDocument.load(result.artifacts[0].bytes);
    // Letter: x=15, y=5, w=587, h=767. Small: x=15, y=5, w=275, h=175.
    expect(output.getPage(0).getCropBox()).toEqual({ x: 15, y: 5, width: 587, height: 767 });
    expect(output.getPage(1).getCropBox()).toEqual({ x: 15, y: 5, width: 275, height: 175 });
    expect(result.meta).toMatchObject({ croppedPages: 2 });
  });

  it("rejects a rectangle that fits no page of a mixed document entirely", async () => {
    const document = await PDFDocument.create();
    document.addPage([612, 792]);
    document.addPage([300, 200]);
    const bytes = await document.save();

    const error = await expectFailure(
      crop("mixed.pdf", bytes, { mode: "rectangle", x: "10", y: "10", width: "500", height: "700" }),
      "INVALID_CROP_CONFIGURATION",
    );
    expect(error.details?.[0]).toContain("page 2");
    expect(error.status).toBe(400);
  });

  it("preserves rotation, content and page order", async () => {
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);
    const page = document.addPage([400, 200]);
    page.drawText("ROT-CONTENT", { x: 40, y: 100, size: 12, font });
    page.setRotation(degrees(90));
    const bytes = await document.save();

    const result = await crop("rot.pdf", bytes, { mode: "margins", top: "10", right: "10", bottom: "10", left: "10" });
    const output = await PDFDocument.load(result.artifacts[0].bytes);
    const outPage = output.getPage(0);
    expect(outPage.getRotation().angle).toBe(90);
    expect(outPage.getMediaBox()).toEqual({ x: 0, y: 0, width: 400, height: 200 });
    expect(outPage.getCropBox()).toEqual({ x: 10, y: 10, width: 380, height: 180 });
    // Original content is untouched: extract the text to prove it.
    const { PDFiumLibrary } = await import("@hyzyla/pdfium");
    const library = await PDFiumLibrary.init();
    const pdf = await library.loadDocument(result.artifacts[0].bytes);
    expect(pdf.getPage(0).getText()).toContain("ROT-CONTENT");
    pdf.destroy();
  });

  it("PRIVACY PROOF: cropped-out text remains recoverable in the output", async () => {
    // The honesty contract of this tool: cropping is NOT redaction.
    const result = await crop("doc.pdf", await seededPdf(1), RECT);
    const outputBytes = result.artifacts[0].bytes;

    // 1. Text extraction still sees the "cropped-out" content.
    const { PDFiumLibrary } = await import("@hyzyla/pdfium");
    const library = await PDFiumLibrary.init();
    const pdf = await library.loadDocument(outputBytes);
    const text = pdf.getPage(0).getText();
    pdf.destroy();
    expect(text).toContain("INSIDE-Keep-1");
    expect(text).toContain("OUTSIDE-Secret-1"); // still there — by design

    // 2. pdf-lib can still read the content stream that carries it.
    const document = await PDFDocument.load(outputBytes);
    expect(document.getPageCount()).toBe(1);
    expect(document.getPage(0).getMediaBox()).toEqual({ x: 0, y: 0, width: 612, height: 792 });
  });

  it("keeps unicode content intact through a crop", async () => {
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);
    document.addPage([300, 300]).drawText("café ünïcode", { x: 20, y: 150, size: 12, font });
    const result = await crop("u.pdf", await document.save(), {
      mode: "margins", top: "10", right: "10", bottom: "10", left: "10",
    });
    const { PDFiumLibrary } = await import("@hyzyla/pdfium");
    const library = await PDFiumLibrary.init();
    const pdf = await library.loadDocument(result.artifacts[0].bytes);
    expect(pdf.getPage(0).getText()).toContain("café ünïcode");
    pdf.destroy();
  });

  it("rejects invalid geometry with INVALID_CROP_CONFIGURATION", async () => {
    const bytes = await seededPdf(1);
    for (const options of [
      { mode: "rectangle", x: "NaN", y: "0", width: "100", height: "100" },
      { mode: "rectangle", x: "0", y: "0", width: "Infinity", height: "100" },
      { mode: "rectangle", x: "0", y: "0", width: "5", height: "100" },
      { mode: "rectangle", x: "-10", y: "0", width: "100", height: "100" },
      { mode: "rectangle", x: "0", y: "0", width: "700", height: "100" }, // overflow
      { mode: "margins", top: "-5", right: "0", bottom: "0", left: "0" },
      { mode: "margins", top: "400", right: "0", bottom: "385", left: "0" }, // < 10pt left
      { mode: "diagonal" },
    ]) {
      const error = await expectFailure(
        crop("doc.pdf", bytes, options),
        "INVALID_CROP_CONFIGURATION",
      );
      expect(error.status).toBe(400);
    }
  });

  it("rejects malformed ranges through the shared page-selection model", async () => {
    const bytes = await seededPdf(3);
    await expectFailure(
      crop("doc.pdf", bytes, { ...RECT, ranges: "abc" }),
      "INVALID_PAGE_RANGE",
    );
    await expectFailure(
      crop("doc.pdf", bytes, { ...RECT, ranges: "9" }),
      "PAGE_OUT_OF_RANGE",
    );
    await expectFailure(
      crop("doc.pdf", bytes, { ...RECT, ranges: "1-2, 2-3" }),
      "OVERLAPPING_RANGES",
    );
  });

  it("rejects malformed and encrypted PDFs", async () => {
    await expectFailure(crop("broken.pdf", makeBrokenPdf(), RECT), "INVALID_PDF");
    const { EncryptedPDFError } = await import("pdf-lib");
    const spy = vi.spyOn(PDFDocument, "load").mockRejectedValueOnce(new EncryptedPDFError());
    try {
      await expectFailure(
        crop("locked.pdf", await makeNumberedPdf(1), RECT),
        "ENCRYPTED_PDF",
      );
    } finally {
      spy.mockRestore();
    }
  });

  it("rejects multiple files at the service layer", async () => {
    const bytes = await seededPdf(1);
    const result = await runProcessingJob({
      toolId: "crop",
      files: [await input("a.pdf", bytes), await input("b.pdf", bytes)],
      options: RECT,
    });
    expect(result.status).toBe("failed");
    expect(result.status === "failed" && result.error.code).toBe("TOO_MANY_FILES");
  });

  it("uses the fixed output name for hostile filenames", async () => {
    const result = await crop("../../Ő secret.pdf", await seededPdf(1), RECT);
    expect(result.artifacts[0].name).toBe("crop.pdf");
    expect(JSON.stringify(result.meta)).not.toContain("secret.pdf");
  });

  it("does not mutate the input bytes", async () => {
    const bytes = await seededPdf(2);
    const snapshot = new Uint8Array(bytes);
    await crop("keep.pdf", bytes, RECT);
    expect([...bytes]).toEqual([...snapshot]);
  });
});
