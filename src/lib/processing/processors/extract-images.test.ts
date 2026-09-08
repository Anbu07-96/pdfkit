// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { ProcessingError } from "@/lib/processing/errors";
import { extractImagesProcessor } from "@/lib/processing/processors/extract-images";
import { getProcessingLimits } from "@/lib/processing/limits";
import { makePdf } from "@/test/pdf-fixtures";

const TINY_PNG = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0,
  0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156,
  99, 96, 248, 15, 0, 1, 5, 1, 2, 26, 10, 188, 225, 0, 0, 0, 0, 73, 69, 78, 68,
  174, 66, 96, 130,
]);

async function fileInput(name: string, bytes: Uint8Array) {
  return {
    id: `input-${name}`,
    name,
    mimeType: "application/pdf",
    size: bytes.length,
    bytes,
  };
}

describe("extract-images processor", () => {
  it("extracts embedded images from PDF pages", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([500, 500]);
    const img = await doc.embedPng(TINY_PNG);
    page.drawImage(img, { x: 50, y: 50, width: 100, height: 100 });
    const pdfBytes = await doc.save();

    const result = await extractImagesProcessor.process({
      toolId: "extract-images",
      files: [await fileInput("doc.pdf", pdfBytes)],
      options: { pages: "all" },
    });

    expect(result.status).toBe("succeeded");
    expect(result.artifacts.length).toBeGreaterThanOrEqual(1);
    expect(result.artifacts[0].name).toMatch(/\.(png|jpg)$/i);
  });

  it("throws error if PDF contains no extractable images", async () => {
    const pdfBytes = await makePdf(["Text-only page with no images"]);
    try {
      await extractImagesProcessor.process({
        toolId: "extract-images",
        files: [await fileInput("text.pdf", pdfBytes)],
        options: { pages: "all" },
      });
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ProcessingError);
      expect((error as ProcessingError).message).toMatch(/No images were found/i);
    }
  });

  it("rejects a document whose image count exceeds the limit before extracting anything", async () => {
    vi.stubEnv("PDFKIT_EXTRACT_IMAGES_MAX_IMAGES", "3");
    try {
      // Five pages, one image each → five images, over the cap of 3.
      const doc = await PDFDocument.create();
      for (let i = 0; i < 5; i += 1) {
        const page = doc.addPage([200, 200]);
        const img = await doc.embedPng(TINY_PNG);
        page.drawImage(img, { x: 0, y: 0, width: 50, height: 50 });
      }
      const pdfBytes = await doc.save();

      try {
        await extractImagesProcessor.process(
          {
            toolId: "extract-images",
            files: [await fileInput("many.pdf", pdfBytes)],
            options: { pages: "all" },
          },
          // The service always passes the context; tests of the limit need it too.
          { limits: getProcessingLimits() },
        );
        throw new Error("expected throw");
      } catch (error) {
        expect(error).toBeInstanceOf(ProcessingError);
        const processingError = error as ProcessingError;
        expect(processingError.code).toBe("TOO_MANY_OUTPUTS");
        expect(processingError.message).toMatch(/more than the limit of 3/i);
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("extracts exactly up to the configured limit without rejecting", async () => {
    vi.stubEnv("PDFKIT_EXTRACT_IMAGES_MAX_IMAGES", "5");
    try {
      const doc = await PDFDocument.create();
      for (let i = 0; i < 4; i += 1) {
        const page = doc.addPage([200, 200]);
        const img = await doc.embedPng(TINY_PNG);
        page.drawImage(img, { x: 0, y: 0, width: 50, height: 50 });
      }
      const pdfBytes = await doc.save();

      const result = await extractImagesProcessor.process(
        {
          toolId: "extract-images",
          files: [await fileInput("within.pdf", pdfBytes)],
          options: { pages: "all" },
        },
        { limits: getProcessingLimits() },
      );

      expect(result.status).toBe("succeeded");
      if (result.status === "succeeded") {
        expect(result.artifacts.length).toBe(4);
        expect(result.meta?.extractedImagesCount).toBe(4);
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
