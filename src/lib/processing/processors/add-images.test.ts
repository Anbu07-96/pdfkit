// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { ProcessingError } from "@/lib/processing/errors";
import { addImagesProcessor } from "@/lib/processing/processors/add-images";
import { makeNumberedPdf, makePdf } from "@/test/pdf-fixtures";

const TINY_PNG = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0,
  0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156,
  99, 96, 248, 15, 0, 1, 5, 1, 2, 26, 10, 188, 225, 0, 0, 0, 0, 73, 69, 78, 68,
  174, 66, 96, 130,
]);

async function fileInput(name: string, bytes: Uint8Array, mimeType: string) {
  return {
    id: `input-${name}`,
    name,
    mimeType,
    size: bytes.length,
    bytes,
  };
}

const VALID_OPTIONS = {
  placement: "center",
  width: "100",
  height: "100",
  preserveAspectRatio: "true",
  pages: "all",
};

describe("add-images processor", () => {
  it("embeds a PNG image on every page of a PDF", async () => {
    const pdfBytes = await makeNumberedPdf(2);
    const result = await addImagesProcessor.process({
      toolId: "add-images",
      files: [
        await fileInput("doc.pdf", pdfBytes, "application/pdf"),
        await fileInput("logo.png", TINY_PNG, "image/png"),
      ],
      options: VALID_OPTIONS,
    });

    expect(result.status).toBe("succeeded");
    const artifact = result.artifacts[0];
    expect(artifact.name).toBe("doc-image-added.pdf");

    const doc = await PDFDocument.load(artifact.bytes);
    expect(doc.getPageCount()).toBe(2);
  });

  it("fails if only 1 file is provided", async () => {
    const pdfBytes = await makePdf(["A"]);
    try {
      await addImagesProcessor.process({
        toolId: "add-images",
        files: [await fileInput("doc.pdf", pdfBytes, "application/pdf")],
        options: VALID_OPTIONS,
      });
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ProcessingError);
      expect((error as ProcessingError).code).toBe("VALIDATION_ERROR");
    }
  });

  it("rejects non-image payload for second file", async () => {
    const pdfBytes = await makePdf(["A"]);
    try {
      await addImagesProcessor.process({
        toolId: "add-images",
        files: [
          await fileInput("doc.pdf", pdfBytes, "application/pdf"),
          await fileInput("fake.png", new Uint8Array([1, 2, 3]), "image/png"),
        ],
        options: VALID_OPTIONS,
      });
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ProcessingError);
      expect((error as ProcessingError).code).toBe("INVALID_IMAGE");
    }
  });
});
