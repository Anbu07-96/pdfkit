// @vitest-environment node
import {
  PDFArray,
  PDFDocument,
  PDFRawStream,
  StandardFonts,
  decodePDFRawStream,
  degrees,
} from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import type { ProcessingInputFile } from "@/lib/processing/contract";
import { ProcessingError } from "@/lib/processing/errors";
import { pageNumbersProcessor } from "@/lib/processing/processors/page-numbers";
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

async function number(
  name: string,
  bytes: Uint8Array,
  options: Record<string, unknown> = {
    position: "bottom-center",
    start: "1",
    size: "11",
    format: "page-of",
    pages: "all",
  },
) {
  return pageNumbersProcessor.process({
    toolId: "page-numbers",
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

function contentTextOf(document: PDFDocument, pageIndex: number): string {
  const contents = document.getPage(pageIndex).node.Contents();
  let raw = "";
  const decode = (stream: unknown) => {
    if (stream instanceof PDFRawStream) {
      raw += new TextDecoder("latin1").decode(decodePDFRawStream(stream).decode());
    }
  };
  if (contents instanceof PDFArray) {
    for (let i = 0; i < contents.size(); i++) {
      decode(document.context.lookup(contents.lookup(i)));
    }
  } else {
    decode(document.context.lookup(contents));
  }
  return raw;
}

function hexOf(text: string): string {
  return (
    text
      .split("")
      .map((ch) => ch.charCodeAt(0).toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase() + ">"
  );
}

describe("PageNumbersProcessor", () => {
  it("declares the tool id and single-file input rules", () => {
    expect(pageNumbersProcessor.toolId).toBe("page-numbers");
    expect(pageNumbersProcessor.input.minFiles).toBe(1);
    expect(pageNumbersProcessor.input.maxFiles).toBe(1);
    expect(pageNumbersProcessor.input.extensions).toEqual([".pdf"]);
  });

  it("numbers every page sequentially with the real total, preserving content", async () => {
    const result = await number("doc.pdf", await makeNumberedPdf(3));

    const artifact = result.artifacts[0];
    expect(artifact.name).toBe("doc-numbered.pdf");
    expect(artifact.mimeType).toBe("application/pdf");
    expect(new TextDecoder().decode(artifact.bytes.slice(0, 5))).toBe("%PDF-");

    const document = await PDFDocument.load(artifact.bytes);
    expect(document.getPageCount()).toBe(3);
    expect(
      document.getPages().map((page) => Math.round(page.getSize().width)),
    ).toEqual([101, 102, 103]);

    // Each page carries its own sequential label; original text survives.
    expect(contentTextOf(document, 0)).toContain(hexOf("Page 1 of 3"));
    expect(contentTextOf(document, 1)).toContain(hexOf("Page 2 of 3"));
    expect(contentTextOf(document, 2)).toContain(hexOf("Page 3 of 3"));
    expect(contentTextOf(document, 0)).toContain(hexOf("page 1"));

    expect(result.meta).toMatchObject({ pages: 3, outputPages: 3, numberedPages: 3 });
  });

  it("applies the starting-number offset without touching the real total", async () => {
    const result = await number("doc.pdf", await makeNumberedPdf(2), {
      position: "bottom-right", start: "5", size: "10", format: "page-of", pages: "all",
    });
    const document = await PDFDocument.load(result.artifacts[0].bytes);
    expect(contentTextOf(document, 0)).toContain(hexOf("Page 5 of 2"));
    expect(contentTextOf(document, 1)).toContain(hexOf("Page 6 of 2"));
  });

  it("numbers only the selected pages, with their sequential numbers", async () => {
    const first = await number("doc.pdf", await makeNumberedPdf(4), {
      position: "bottom-left", start: "1", size: "9", format: "page", pages: "first",
    });
    const firstDoc = await PDFDocument.load(first.artifacts[0].bytes);
    expect(contentTextOf(firstDoc, 0)).toContain(hexOf("Page 1"));
    for (const index of [1, 2, 3]) {
      expect(contentTextOf(firstDoc, index)).not.toContain(hexOf("Page"));
    }
    expect(first.meta).toMatchObject({ numberedPages: 1 });

    const last = await number("doc.pdf", await makeNumberedPdf(4), {
      position: "bottom-left", start: "1", size: "9", format: "page", pages: "last",
    });
    const lastDoc = await PDFDocument.load(last.artifacts[0].bytes);
    expect(contentTextOf(lastDoc, 3)).toContain(hexOf("Page 4"));
    for (const index of [0, 1, 2]) {
      expect(contentTextOf(lastDoc, index)).not.toContain(hexOf("Page"));
    }
  });

  it("supports every position and format", async () => {
    for (const position of ["bottom-left", "bottom-center", "bottom-right"]) {
      for (const format of ["number", "page", "page-of"]) {
        const result = await number("doc.pdf", await makeNumberedPdf(1), {
          position, start: "1", size: "12", format, pages: "all",
        });
        const document = await PDFDocument.load(result.artifacts[0].bytes);
        const stream = contentTextOf(document, 0);
        const expected =
          format === "number" ? "1" : format === "page" ? "Page 1" : "Page 1 of 1";
        expect(stream, `${position}/${format}`).toContain(hexOf(expected));
        expect(document.getPageCount()).toBe(1);
      }
    }
  });

  it("respects the font size in the drawn operators", async () => {
    const result = await number("doc.pdf", await makeNumberedPdf(1), {
      position: "bottom-center", start: "1", size: "24", format: "number", pages: "all",
    });
    const document = await PDFDocument.load(result.artifacts[0].bytes);
    // `24 Tf` — the requested size is genuinely the drawing font size.
    expect(contentTextOf(document, 0)).toMatch(/24 Tf/);
  });

  it("preserves existing page rotation", async () => {
    const document = await PDFDocument.create();
    document.addPage([400, 200]).setRotation(degrees(270));
    const result = await number("rot.pdf", await document.save());
    expect(
      (await PDFDocument.load(result.artifacts[0].bytes)).getPage(0).getRotation().angle,
    ).toBe(270);
  });

  it("rejects out-of-range and malformed options", async () => {
    const bytes = await makeNumberedPdf(1);
    for (const options of [
      { position: "top", start: "1", size: "11", format: "page", pages: "all" },
      { position: "bottom-left", start: "0", size: "11", format: "page", pages: "all" },
      { position: "bottom-left", start: "10000", size: "11", format: "page", pages: "all" },
      { position: "bottom-left", start: "x", size: "11", format: "page", pages: "all" },
      { position: "bottom-left", start: "1", size: "7", format: "page", pages: "all" },
      { position: "bottom-left", start: "1", size: "25", format: "page", pages: "all" },
      { position: "bottom-left", start: "1", size: "11", format: "roman", pages: "all" },
      { position: "bottom-left", start: "1", size: "11", format: "page", pages: "some" },
    ]) {
      const error = await expectFailure(
        number("doc.pdf", bytes, options),
        "INVALID_PAGE_NUMBER_CONFIGURATION",
      );
      expect(error.status).toBe(400);
    }
  });

  it("rejects malformed PDFs", async () => {
    await expectFailure(number("broken.pdf", makeBrokenPdf()), "INVALID_PDF");
  });

  it("rejects encrypted PDFs", async () => {
    const { EncryptedPDFError } = await import("pdf-lib");
    const spy = vi
      .spyOn(PDFDocument, "load")
      .mockRejectedValueOnce(new EncryptedPDFError());
    try {
      await expectFailure(
        number("locked.pdf", await makeNumberedPdf(1)),
        "ENCRYPTED_PDF",
      );
    } finally {
      spy.mockRestore();
    }
  });

  it("rejects multiple files at the service layer", async () => {
    const bytes = await makeNumberedPdf(2);
    const result = await runProcessingJob({
      toolId: "page-numbers",
      files: [await input("a.pdf", bytes), await input("b.pdf", bytes)],
      options: {},
    });
    expect(result.status).toBe("failed");
    expect(result.status === "failed" && result.error.code).toBe("TOO_MANY_FILES");
  });

  it("sanitises hostile filenames out of the artifact name", async () => {
    const result = await number("../../Ő report.pdf", await makeNumberedPdf(1));
    expect(result.artifacts[0].name).toBe("_ report-numbered.pdf");
    expect(result.artifacts[0].name).not.toMatch(/\.\.|[/\\]/);
  });

  it("does not mutate the input bytes", async () => {
    const bytes = await makeNumberedPdf(2);
    const snapshot = new Uint8Array(bytes);
    await number("keep.pdf", bytes);
    expect([...bytes]).toEqual([...snapshot]);
  });
});
