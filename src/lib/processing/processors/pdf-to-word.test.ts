// @vitest-environment node
import { PDFDocument, StandardFonts } from "pdf-lib";
import { unzipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";
import type { ProcessingInputFile } from "@/lib/processing/contract";
import { ProcessingError } from "@/lib/processing/errors";
import { DEFAULT_PROCESSING_LIMITS } from "@/lib/processing/limits";
import { pdfToWordProcessor } from "@/lib/processing/processors/pdf-to-word";
import { runProcessingJob } from "@/lib/processing/service";
import {
  makeBrokenPdf,
  makeColouredPdf,
  makeNumberedPdf,
} from "@/test/pdf-fixtures";

const CONTEXT = { limits: { ...DEFAULT_PROCESSING_LIMITS } };

async function input(name: string, bytes: Uint8Array): Promise<ProcessingInputFile> {
  return {
    id: "input-1",
    name,
    size: bytes.length,
    mimeType: "application/pdf",
    bytes,
  };
}

async function convert(
  name: string,
  bytes: Uint8Array,
  limits = CONTEXT.limits,
) {
  return pdfToWordProcessor.process(
    { toolId: "pdf-to-word", files: [await input(name, bytes)], options: {} },
    { limits },
  );
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

/** Read the text content of the produced document.xml. */
function documentXml(bytes: Uint8Array): string {
  const entries = unzipSync(bytes);
  const xml = entries["word/document.xml"];
  if (!xml) throw new Error("word/document.xml missing");
  return new TextDecoder().decode(xml);
}

describe("PdfToWordProcessor", () => {
  it("declares the tool id and single-file input rules", () => {
    expect(pdfToWordProcessor.toolId).toBe("pdf-to-word");
    expect(pdfToWordProcessor.input.minFiles).toBe(1);
    expect(pdfToWordProcessor.input.maxFiles).toBe(1);
    expect(pdfToWordProcessor.input.extensions).toEqual([".pdf"]);
  });

  it("produces a valid DOCX with the text in page and line order", async () => {
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);
    document.addPage([595, 842]).drawText("First page opening line", { x: 40, y: 780, size: 12, font });
    document.addPage([595, 842]).drawText("Second page follows", { x: 40, y: 780, size: 12, font });
    const bytes = await document.save();

    const result = await convert("report.pdf", bytes);
    const artifact = result.artifacts[0];

    expect(artifact.name).toBe("report.docx");
    expect(artifact.mimeType).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(artifact.size).toBe(artifact.bytes.length);

    // In-memory ZIP validation: required Office parts exist.
    const entries = Object.keys(unzipSync(artifact.bytes));
    expect(entries).toContain("[Content_Types].xml");
    expect(entries).toContain("word/document.xml");

    const xml = documentXml(artifact.bytes);
    // Page/text order preserved, page break between pages.
    const first = xml.indexOf("First page opening line");
    const second = xml.indexOf("Second page follows");
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first);
    expect(xml).toContain('<w:br w:type="page"/>');

    expect(result.meta).toMatchObject({
      pages: 2,
      outputPages: 2,
      mode: "text-only",
    });
    expect(result.meta?.paragraphs).toBe(2);
    expect(result.meta?.characters).toBeGreaterThan(0);
  });

  it("extracts multi-line pages as one paragraph per line", async () => {
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);
    const page = document.addPage([595, 842]);
    page.drawText("Line one", { x: 40, y: 780, size: 12, font });
    page.drawText("Line two", { x: 40, y: 740, size: 12, font });
    const bytes = await document.save();

    const result = await convert("lines.pdf", bytes);
    expect(result.meta?.paragraphs).toBe(2);
    const xml = documentXml(result.artifacts[0].bytes);
    expect(xml).toContain("Line one");
    expect(xml).toContain("Line two");
  });

  it("round-trips unicode text", async () => {
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);
    // WinAnsi-safe unicode: the standard fonts cannot encode CJK, but the
    // DOCX side carries arbitrary unicode (proven in the Phase 14 probe).
    document.addPage([595, 842]).drawText("Ünïcode café Ñoño", { x: 40, y: 780, size: 12, font });
    const bytes = await document.save();

    const result = await convert("u.pdf", bytes);
    expect(documentXml(result.artifacts[0].bytes)).toContain("Ünïcode café Ñoño");
  });

  it("handles pages without extractable text honestly", async () => {
    // Coloured rectangles carry no text at all.
    const bytes = await makeColouredPdf([[10, 20, 30]]);

    const result = await convert("image.pdf", bytes);
    expect(result.meta).toMatchObject({ pages: 1, characters: 0, paragraphs: 0 });
    // The empty page is marked in the document, not silently dropped.
    expect(documentXml(result.artifacts[0].bytes)).toContain(
      "[Page 1 contains no extractable text]",
    );
  });

  it("rejects documents above the page limit before extracting", async () => {
    const error = await expectFailure(
      convert("long.pdf", await makeNumberedPdf(3), {
        ...CONTEXT.limits,
        maxConversionPages: 2,
      }),
      "TOO_MANY_OUTPUTS",
    );
    expect(error.status).toBe(413);
  });

  it("rejects malformed PDFs", async () => {
    await expectFailure(convert("broken.pdf", makeBrokenPdf()), "INVALID_PDF");
  });

  it("rejects encrypted PDFs", async () => {
    const { EncryptedPDFError } = await import("pdf-lib");
    const spy = vi
      .spyOn(PDFDocument, "load")
      .mockRejectedValueOnce(new EncryptedPDFError());
    try {
      await expectFailure(
        convert("locked.pdf", await makeNumberedPdf(1)),
        "ENCRYPTED_PDF",
      );
    } finally {
      spy.mockRestore();
    }
  });

  it("rejects multiple files at the service layer", async () => {
    const bytes = await makeNumberedPdf(2);
    const result = await runProcessingJob({
      toolId: "pdf-to-word",
      files: [await input("a.pdf", bytes), await input("b.pdf", bytes)],
      options: {},
    });
    expect(result.status).toBe("failed");
    expect(result.status === "failed" && result.error.code).toBe("TOO_MANY_FILES");
  });

  it("sanitises hostile filenames out of the artifact name", async () => {
    const result = await convert("../../Ő report.pdf", await makeNumberedPdf(1));
    expect(result.artifacts[0].name).toBe("_ report.docx");
    expect(result.artifacts[0].name).not.toMatch(/\.\.|[/\\]/);
  });

  it("does not mutate the input bytes", async () => {
    const bytes = await makeNumberedPdf(2);
    const snapshot = new Uint8Array(bytes);
    await convert("keep.pdf", bytes);
    expect([...bytes]).toEqual([...snapshot]);
  });
});
