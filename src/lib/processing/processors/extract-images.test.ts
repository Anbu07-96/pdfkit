// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { ProcessingError } from "@/lib/processing/errors";
import { extractImagesProcessor } from "@/lib/processing/processors/extract-images";
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
});
