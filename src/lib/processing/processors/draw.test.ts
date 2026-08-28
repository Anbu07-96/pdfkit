// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { ProcessingError } from "@/lib/processing/errors";
import { drawProcessor } from "@/lib/processing/processors/draw";
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
  preset: "checkmark",
  placement: "bottom-right",
  width: "100",
  height: "60",
  strokeWidth: "3",
  strokeColor: "#000000",
  pages: "all",
};

describe("draw processor", () => {
  it("draws vector paths on selected pages", async () => {
    const pdfBytes = await makeNumberedPdf(2);
    const result = await drawProcessor.process({
      toolId: "draw",
      files: [await pdfInput("doc.pdf", pdfBytes)],
      options: VALID_OPTIONS,
    });

    expect(result.status).toBe("succeeded");
    const artifact = result.artifacts[0];
    expect(artifact.name).toBe("doc-drawn.pdf");

    const doc = await PDFDocument.load(artifact.bytes);
    expect(doc.getPageCount()).toBe(2);
  });

  it("rejects invalid options", async () => {
    const pdfBytes = await makeNumberedPdf(1);
    try {
      await drawProcessor.process({
        toolId: "draw",
        files: [await pdfInput("doc.pdf", pdfBytes)],
        options: { ...VALID_OPTIONS, preset: "invalid" },
      });
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ProcessingError);
      expect((error as ProcessingError).code).toBe("INVALID_DRAW_CONFIGURATION");
    }
  });
});
