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
import { watermarkProcessor } from "@/lib/processing/processors/watermark";
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

async function watermark(
  name: string,
  bytes: Uint8Array,
  options: Record<string, unknown> = {
    text: "CONFIDENTIAL",
    opacity: "50",
    rotation: "45",
    placement: "center",
    pages: "all",
  },
) {
  return watermarkProcessor.process({
    toolId: "watermark",
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

/** Decode a page's content streams into readable operator text. */
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

/** pdf-lib writes standard-font text as hex strings; presence is provable. */
function hexOf(text: string): string {
  return (
    text
      .split("")
      .map((ch) => ch.charCodeAt(0).toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase() +
    ">" // keep prefix match safe against longer hex runs
  );
}

const MARK = "CONFIDENTIAL";

describe("WatermarkProcessor", () => {
  it("declares the tool id and single-file input rules", () => {
    expect(watermarkProcessor.toolId).toBe("watermark");
    expect(watermarkProcessor.input.minFiles).toBe(1);
    expect(watermarkProcessor.input.maxFiles).toBe(1);
    expect(watermarkProcessor.input.extensions).toEqual([".pdf"]);
  });

  it("draws a real vector watermark and preserves the document", async () => {
    const result = await watermark("doc.pdf", await makeNumberedPdf(3));

    const artifact = result.artifacts[0];
    expect(artifact.name).toBe("doc-watermarked.pdf");
    expect(artifact.mimeType).toBe("application/pdf");
    expect(new TextDecoder().decode(artifact.bytes.slice(0, 5))).toBe("%PDF-");

    const document = await PDFDocument.load(artifact.bytes);
    expect(document.getPageCount()).toBe(3);

    for (let index = 0; index < 3; index++) {
      const stream = contentTextOf(document, index);
      // The watermark text is genuinely present as drawn text…
      expect(stream).toContain(hexOf(MARK));
      // …and the alpha transparency (ExtGState) is applied.
      expect(stream).toMatch(/gs/);
    }

    // Page geometry and order untouched.
    expect(
      document.getPages().map((page) => Math.round(page.getSize().width)),
    ).toEqual([101, 102, 103]);

    expect(result.meta).toMatchObject({ pages: 3, outputPages: 3, watermarkedPages: 3 });
  });

  it("stamps only the selected pages", async () => {
    const first = await watermark("doc.pdf", await makeNumberedPdf(4), {
      text: MARK, opacity: "50", rotation: "0", placement: "center", pages: "first",
    });
    const last = await watermark("doc.pdf", await makeNumberedPdf(4), {
      text: MARK, opacity: "50", rotation: "0", placement: "center", pages: "last",
    });

    const firstDoc = await PDFDocument.load(first.artifacts[0].bytes);
    expect(contentTextOf(firstDoc, 0)).toContain(hexOf(MARK));
    for (const index of [1, 2, 3]) {
      expect(contentTextOf(firstDoc, index)).not.toContain(hexOf(MARK));
    }
    expect(first.meta).toMatchObject({ watermarkedPages: 1 });

    const lastDoc = await PDFDocument.load(last.artifacts[0].bytes);
    expect(contentTextOf(lastDoc, 3)).toContain(hexOf(MARK));
    for (const index of [0, 1, 2]) {
      expect(contentTextOf(lastDoc, index)).not.toContain(hexOf(MARK));
    }
  });

  it("supports every placement × rotation × opacity combination", async () => {
    for (const placement of ["center", "diagonal-tiled", "corner"]) {
      for (const rotation of ["0", "45", "-45"]) {
        for (const opacity of ["25", "50", "75"]) {
          const result = await watermark("doc.pdf", await makeNumberedPdf(1), {
            text: MARK, opacity, rotation, placement, pages: "all",
          });
          const document = await PDFDocument.load(result.artifacts[0].bytes);
          const stream = contentTextOf(document, 0);
          expect(
            stream,
            `${placement}/${rotation}/${opacity}`,
          ).toContain(hexOf(MARK));
          expect(document.getPageCount()).toBe(1);
        }
      }
    }
  });

  it("preserves existing page rotation and original content", async () => {
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);
    const page = document.addPage([400, 200]);
    page.drawText("original body text", { x: 10, y: 100, size: 12, font });
    page.setRotation(degrees(90));
    const bytes = await document.save();

    const result = await watermark("rot.pdf", bytes);
    const output = await PDFDocument.load(result.artifacts[0].bytes);
    expect(output.getPage(0).getRotation().angle).toBe(90);
    const stream = contentTextOf(output, 0);
    expect(stream).toContain(hexOf("original body text"));
    expect(stream).toContain(hexOf(MARK));
  });

  it("rejects empty text, oversized text and out-of-set options", async () => {
    const bytes = await makeNumberedPdf(1);
    for (const options of [
      { text: "  ", opacity: "50", rotation: "45", placement: "center", pages: "all" },
      { text: "x".repeat(201), opacity: "50", rotation: "45", placement: "center", pages: "all" },
      { text: MARK, opacity: "40", rotation: "45", placement: "center", pages: "all" },
      { text: MARK, opacity: "50", rotation: "30", placement: "center", pages: "all" },
      { text: MARK, opacity: "50", rotation: "45", placement: "middle", pages: "all" },
      { text: MARK, opacity: "50", rotation: "45", placement: "center", pages: "odd" },
    ]) {
      const error = await expectFailure(
        watermark("doc.pdf", bytes, options),
        "INVALID_WATERMARK_CONFIGURATION",
      );
      expect(error.status).toBe(400);
    }
  });

  it("rejects text the standard watermark font cannot display", async () => {
    const error = await expectFailure(
      watermark("doc.pdf", await makeNumberedPdf(1), {
        text: "机密文件", opacity: "50", rotation: "45", placement: "center", pages: "all",
      }),
      "INVALID_WATERMARK_CONFIGURATION",
    );
    expect(error.message).toContain("cannot display");
  });

  it("rejects malformed PDFs", async () => {
    await expectFailure(
      watermark("broken.pdf", makeBrokenPdf()),
      "INVALID_PDF",
    );
  });

  it("rejects encrypted PDFs", async () => {
    const { EncryptedPDFError } = await import("pdf-lib");
    const spy = vi
      .spyOn(PDFDocument, "load")
      .mockRejectedValueOnce(new EncryptedPDFError());
    try {
      await expectFailure(
        watermark("locked.pdf", await makeNumberedPdf(1)),
        "ENCRYPTED_PDF",
      );
    } finally {
      spy.mockRestore();
    }
  });

  it("rejects multiple files at the service layer", async () => {
    const bytes = await makeNumberedPdf(2);
    const result = await runProcessingJob({
      toolId: "watermark",
      files: [await input("a.pdf", bytes), await input("b.pdf", bytes)],
      options: {},
    });
    expect(result.status).toBe("failed");
    expect(result.status === "failed" && result.error.code).toBe("TOO_MANY_FILES");
  });

  it("sanitises hostile filenames out of the artifact name", async () => {
    const result = await watermark("../../Ő report.pdf", await makeNumberedPdf(1));
    expect(result.artifacts[0].name).toBe("_ report-watermarked.pdf");
    expect(result.artifacts[0].name).not.toMatch(/\.\.|[/\\]/);
  });

  it("does not mutate the input bytes", async () => {
    const bytes = await makeNumberedPdf(2);
    const snapshot = new Uint8Array(bytes);
    await watermark("keep.pdf", bytes);
    expect([...bytes]).toEqual([...snapshot]);
  });
});
