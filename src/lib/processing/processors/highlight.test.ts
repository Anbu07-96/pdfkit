// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { ProcessingError } from "@/lib/processing/errors";
import { highlightProcessor } from "@/lib/processing/processors/highlight";
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

const VALID_OPTIONS = {
  placement: "top-left",
  width: "200",
  height: "30",
  color: "#fef08a",
  opacity: "0.5",
  pages: "all",
};

describe("highlight processor", () => {
  it("draws semi-transparent highlight rectangle on selected pages", async () => {
    const pdfBytes = await makeNumberedPdf(2);
    const result = await highlightProcessor.process({
      toolId: "highlight",
      files: [await pdfInput("doc.pdf", pdfBytes)],
      options: VALID_OPTIONS,
    });

    expect(result.status).toBe("succeeded");
    const artifact = result.artifacts[0];
    expect(artifact.name).toBe("doc-highlighted.pdf");

    const doc = await PDFDocument.load(artifact.bytes);
    expect(doc.getPageCount()).toBe(2);
  });

  it("rejects invalid options", async () => {
    const pdfBytes = await makeNumberedPdf(1);
    try {
      await highlightProcessor.process({
        toolId: "highlight",
        files: [await pdfInput("doc.pdf", pdfBytes)],
        options: { ...VALID_OPTIONS, placement: "invalid" },
      });
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ProcessingError);
      expect((error as ProcessingError).code).toBe("INVALID_HIGHLIGHT_CONFIGURATION");
    }
  });
});
