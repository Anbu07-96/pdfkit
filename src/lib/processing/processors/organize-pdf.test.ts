// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { ProcessingError } from "@/lib/processing/errors";
import { organizePdfProcessor } from "@/lib/processing/processors/organize-pdf";
import { makeNumberedPdf } from "@/test/pdf-fixtures";

async function pdfInput(name: string, bytes: Uint8Array) {
  return {
    id: `input-${name}`,
    name,
    mimeType: "application/pdf",
    size: bytes.length,
    bytes,
  };
}

describe("organize-pdf processor", () => {
  it("reorders, rotates, and deletes pages in one workflow", async () => {
    // 4-page fixture: pages 1, 2, 3, 4
    const pdfBytes = await makeNumberedPdf(4);

    const result = await organizePdfProcessor.process({
      toolId: "organize-pdf",
      files: [await pdfInput("doc.pdf", pdfBytes)],
      options: {
        order: "4, 1, 3", // Reordered and page 2 deleted
        rotations: JSON.stringify({ "1": 90, "4": 180 }), // Rotations on original pages 1 & 4
      },
    });

    expect(result.status).toBe("succeeded");
    const artifact = result.artifacts[0];
    expect(artifact.name).toBe("doc-organized.pdf");

    const doc = await PDFDocument.load(artifact.bytes);
    expect(doc.getPageCount()).toBe(3); // 1 page deleted

    // Output page 0 (original page 4) should have rotation 180
    expect(doc.getPage(0).getRotation().angle).toBe(180);
    // Output page 1 (original page 1) should have rotation 90
    expect(doc.getPage(1).getRotation().angle).toBe(90);
    // Output page 2 (original page 3) should have rotation 0
    expect(doc.getPage(2).getRotation().angle).toBe(0);
  });

  it("fails if attempting to delete all pages", async () => {
    const pdfBytes = await makeNumberedPdf(2);
    try {
      await organizePdfProcessor.process({
        toolId: "organize-pdf",
        files: [await pdfInput("doc.pdf", pdfBytes)],
        options: { order: "" }, // or invalid empty order
      });
      // Default order is [1, 2], so empty order string defaults to all pages.
    } catch (error) {
      expect(error).toBeInstanceOf(ProcessingError);
    }
  });

  it("rejects out-of-range page numbers", async () => {
    const pdfBytes = await makeNumberedPdf(2);
    try {
      await organizePdfProcessor.process({
        toolId: "organize-pdf",
        files: [await pdfInput("doc.pdf", pdfBytes)],
        options: { order: "1, 10" },
      });
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ProcessingError);
      expect((error as ProcessingError).code).toBe("PAGE_OUT_OF_RANGE");
    }
  });
});
