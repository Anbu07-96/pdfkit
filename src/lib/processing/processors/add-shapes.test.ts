// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { ProcessingError } from "@/lib/processing/errors";
import { addShapesProcessor } from "@/lib/processing/processors/add-shapes";
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

const VALID_RECT_OPTIONS = {
  shape: "rectangle",
  placement: "center",
  width: "100",
  height: "60",
  strokeWidth: "2",
  strokeColor: "#000000",
  fillColor: "#ff0000",
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

describe("add-shapes processor", () => {
  it("draws a rectangle shape on every page", async () => {
    const result = await addShapesProcessor.process({
      toolId: "add-shapes",
      files: [await pdfInput("doc.pdf", await makeNumberedPdf(3))],
      options: VALID_RECT_OPTIONS,
    });

    expect(result.status).toBe("succeeded");
    const artifact = result.artifacts[0];
    expect(artifact.name).toBe("doc-shapes-added.pdf");
    expect(artifact.mimeType).toBe("application/pdf");
    expect(result.meta).toMatchObject({ pages: 3, outputPages: 3, shapePages: 3 });

    const output = await PDFDocument.load(artifact.bytes);
    expect(output.getPageCount()).toBe(3);
  });

  it("draws circle, ellipse, and line shapes", async () => {
    for (const shape of ["circle", "ellipse", "line"]) {
      const result = await addShapesProcessor.process({
        toolId: "add-shapes",
        files: [await pdfInput(`${shape}.pdf`, await makePdf(["A"]))],
        options: {
          ...VALID_RECT_OPTIONS,
          shape,
          fillColor: shape === "line" ? "none" : "#2563eb",
        },
      });
      expect(result.status).toBe("succeeded");
    }
  });

  it("stamps only selected page mode (first / last)", async () => {
    const result = await addShapesProcessor.process({
      toolId: "add-shapes",
      files: [await pdfInput("doc.pdf", await makeNumberedPdf(4))],
      options: { ...VALID_RECT_OPTIONS, pages: "first" },
    });
    expect(result.meta).toMatchObject({ pages: 4, outputPages: 4, shapePages: 1 });
  });

  it("clamps oversized shapes to fit page bounds", async () => {
    // 900pt shape on a 300pt page
    const result = await addShapesProcessor.process({
      toolId: "add-shapes",
      files: [await pdfInput("doc.pdf", await makePdf(["A"]))],
      options: { ...VALID_RECT_OPTIONS, width: "900", height: "900" },
    });

    expect(result.status).toBe("succeeded");
    const output = await PDFDocument.load(result.artifacts[0].bytes);
    expect(output.getPageCount()).toBe(1);
  });

  it("rejects invalid shape configuration", async () => {
    await expectProcessingError(
      addShapesProcessor.process({
        toolId: "add-shapes",
        files: [await pdfInput("doc.pdf", await makePdf(["A"]))],
        options: { ...VALID_RECT_OPTIONS, shape: "star" },
      }),
      "INVALID_SHAPE_CONFIGURATION",
    );
  });

  it("reports unreadable PDF as INVALID_PDF", async () => {
    await expectProcessingError(
      addShapesProcessor.process({
        toolId: "add-shapes",
        files: [await pdfInput("broken.pdf", makeBrokenPdf())],
        options: VALID_RECT_OPTIONS,
      }),
      "INVALID_PDF",
    );
  });

  it("fails cleanly when no file is provided", async () => {
    await expectProcessingError(
      addShapesProcessor.process({
        toolId: "add-shapes",
        files: [],
        options: VALID_RECT_OPTIONS,
      }),
      "VALIDATION_ERROR",
    );
  });
});
