// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { ProcessingError } from "@/lib/processing/errors";
import { addTextProcessor } from "@/lib/processing/processors/add-text";
import { extractPdfPageTexts } from "@/lib/thumbnails/renderer";
import { makeBrokenPdf, makeNumberedPdf, makePdf } from "@/test/pdf-fixtures";

async function pdfInput(name: string, bytes: Uint8Array) {
  return {
    id: `input-${name}`,
    name,
    mimeType: "application/pdf",
    size: bytes.length,
    bytes,
  };
}

const VALID_OPTIONS = {
  text: "Approved",
  placement: "top-center",
  size: "16",
  pages: "all",
};

async function expectProcessingError(
  promise: Promise<unknown>,
  code: string,
): Promise<ProcessingError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ProcessingError);
    expect((error as ProcessingError).code).toBe(code);
    return error as ProcessingError;
  }
  throw new Error(`expected a ProcessingError (${code})`);
}

describe("add-text processor", () => {
  it("draws the text as real, extractable vector text on every page", async () => {
    const result = await addTextProcessor.process({
      toolId: "add-text",
      files: [await pdfInput("letter.pdf", await makeNumberedPdf(3))],
      options: { ...VALID_OPTIONS, text: "REVIEW COPY" },
    });

    expect(result.status).toBe("succeeded");
    const artifact = result.artifacts[0];
    expect(artifact.name).toBe("letter-text-added.pdf");
    expect(artifact.mimeType).toBe("application/pdf");
    expect(artifact.size).toBe(artifact.bytes.length);
    expect(result.meta).toMatchObject({ pages: 3, outputPages: 3, textPages: 3 });

    // The original content is untouched and the new text is really there,
    // as text — extractable per page, not rasterised into an image.
    const output = await PDFDocument.load(artifact.bytes);
    expect(output.getPageCount()).toBe(3);

    const { texts } = await extractPdfPageTexts(artifact.bytes, { maxPages: 50 });
    expect(texts).toHaveLength(3);
    for (const [index, pageText] of texts.entries()) {
      expect(pageText).toContain("REVIEW COPY");
      // Original page content survives alongside the added text.
      expect(pageText).toContain(`page ${index + 1}`);
    }
  });

  it("stamps only the pages the mode selects", async () => {
    const result = await addTextProcessor.process({
      toolId: "add-text",
      files: [await pdfInput("doc.pdf", await makeNumberedPdf(4))],
      options: { ...VALID_OPTIONS, text: "FINAL", pages: "last" },
    });

    expect(result.meta).toMatchObject({ pages: 4, outputPages: 4, textPages: 1 });
    const { texts } = await extractPdfPageTexts(result.artifacts[0].bytes, {
      maxPages: 50,
    });
    expect(texts[3]).toContain("FINAL");
    expect(texts[0]).not.toContain("FINAL");
    expect(texts[1]).not.toContain("FINAL");
    expect(texts[2]).not.toContain("FINAL");
  });

  it("draws every line of a multi-line text box", async () => {
    const result = await addTextProcessor.process({
      toolId: "add-text",
      files: [await pdfInput("note.pdf", await makePdf(["body"]))],
      options: {
        ...VALID_OPTIONS,
        text: "Received 12 May\nFront desk\nCounter 4",
        placement: "bottom-left",
        size: "12",
      },
    });

    const { texts } = await extractPdfPageTexts(result.artifacts[0].bytes, {
      maxPages: 50,
    });
    expect(texts[0]).toContain("Received 12 May");
    expect(texts[0]).toContain("Front desk");
    expect(texts[0]).toContain("Counter 4");
  });

  it("scales oversized text down to fit the page instead of clipping", async () => {
    // A 36pt single word far wider than the 300pt fixture page (minus margins).
    const result = await addTextProcessor.process({
      toolId: "add-text",
      files: [await pdfInput("wide.pdf", await makePdf(["body"]))],
      options: {
        ...VALID_OPTIONS,
        text: "SUPERCALIFRAGILISTICEXPIALIDOCIOUS",
        placement: "top-left",
        size: "36",
      },
    });

    expect(result.status).toBe("succeeded");
    const { texts } = await extractPdfPageTexts(result.artifacts[0].bytes, {
      maxPages: 50,
    });
    expect(texts[0]).toContain("SUPERCALIFRAGILISTICEXPIALIDOCIOUS");
  });

  it("rejects characters the standard font cannot encode", async () => {
    const error = await expectProcessingError(
      addTextProcessor.process({
        toolId: "add-text",
        files: [await pdfInput("doc.pdf", await makePdf(["A"]))],
        options: { ...VALID_OPTIONS, text: "机密信息" },
      }),
      "INVALID_TEXT_CONFIGURATION",
    );
    expect(error.message).toMatch(/standard Latin characters/i);
  });

  it("rejects an invalid option before touching the document", async () => {
    await expectProcessingError(
      addTextProcessor.process({
        toolId: "add-text",
        files: [await pdfInput("doc.pdf", await makePdf(["A"]))],
        options: { ...VALID_OPTIONS, text: "" },
      }),
      "INVALID_TEXT_CONFIGURATION",
    );
    await expectProcessingError(
      addTextProcessor.process({
        toolId: "add-text",
        files: [await pdfInput("doc.pdf", await makePdf(["A"]))],
        options: { ...VALID_OPTIONS, placement: "somewhere" },
      }),
      "INVALID_TEXT_CONFIGURATION",
    );
    await expectProcessingError(
      addTextProcessor.process({
        toolId: "add-text",
        files: [await pdfInput("doc.pdf", await makePdf(["A"]))],
        options: { ...VALID_OPTIONS, size: "72" },
      }),
      "INVALID_TEXT_CONFIGURATION",
    );
  });

  it("reports an unreadable PDF as INVALID_PDF", async () => {
    await expectProcessingError(
      addTextProcessor.process({
        toolId: "add-text",
        files: [await pdfInput("broken.pdf", makeBrokenPdf())],
        options: VALID_OPTIONS,
      }),
      "INVALID_PDF",
    );
  });

  it("fails cleanly when no file is provided", async () => {
    await expectProcessingError(
      addTextProcessor.process({
        toolId: "add-text",
        files: [],
        options: VALID_OPTIONS,
      }),
      "VALIDATION_ERROR",
    );
  });
});
