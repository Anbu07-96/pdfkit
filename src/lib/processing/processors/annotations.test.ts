// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PDFArray, PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { ProcessingError } from "@/lib/processing/errors";
import { annotationsProcessor } from "@/lib/processing/processors/annotations";
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

describe("annotations processor", () => {
  it("adds a comment annotation to PDF pages", async () => {
    const pdfBytes = await makeNumberedPdf(2);
    const result = await annotationsProcessor.process({
      toolId: "annotations",
      files: [await pdfInput("doc.pdf", pdfBytes)],
      options: {
        type: "comment",
        placement: "top-left",
        text: "Important comment note",
        author: "Editor",
        width: "30",
        height: "30",
        pages: "all",
      },
    });

    expect(result.status).toBe("succeeded");
    const artifact = result.artifacts[0];
    expect(artifact.name).toBe("doc-annotated.pdf");

    // Verify PDF annotations exist in reopened document
    const doc = await PDFDocument.load(artifact.bytes);
    expect(doc.getPageCount()).toBe(2);

    const page1 = doc.getPage(0);
    const annots = doc.context.lookup(page1.node.get(PDFName.of("Annots")));
    expect(annots).toBeInstanceOf(PDFArray);
    if (annots instanceof PDFArray) {
      expect(annots.size()).toBeGreaterThanOrEqual(1);
      const firstAnnot = doc.context.lookup(annots.get(0)) as PDFDict;
      expect(firstAnnot.get(PDFName.of("Subtype"))?.toString()).toBe("/Text");
    }
  });

  it("adds a link annotation to selected pages", async () => {
    const pdfBytes = await makeNumberedPdf(2);
    const result = await annotationsProcessor.process({
      toolId: "annotations",
      files: [await pdfInput("doc.pdf", pdfBytes)],
      options: {
        type: "link",
        placement: "center",
        url: "https://pdfkit.app",
        width: "150",
        height: "30",
        pages: "first",
      },
    });

    expect(result.status).toBe("succeeded");
    const doc = await PDFDocument.load(result.artifacts[0].bytes);
    const page1 = doc.getPage(0);
    const annots1 = doc.context.lookup(page1.node.get(PDFName.of("Annots")));
    expect(annots1).toBeInstanceOf(PDFArray);
    if (annots1 instanceof PDFArray) {
      const firstAnnot = doc.context.lookup(annots1.get(0)) as PDFDict;
      expect(firstAnnot.get(PDFName.of("Subtype"))?.toString()).toBe("/Link");
    }
  });

  it("rejects invalid options", async () => {
    const pdfBytes = await makeNumberedPdf(1);
    try {
      await annotationsProcessor.process({
        toolId: "annotations",
        files: [await pdfInput("doc.pdf", pdfBytes)],
        options: { type: "comment", placement: "center", text: "", pages: "all" },
      });
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ProcessingError);
      expect((error as ProcessingError).code).toBe("INVALID_ANNOTATION_CONFIGURATION");
    }
  });
});
