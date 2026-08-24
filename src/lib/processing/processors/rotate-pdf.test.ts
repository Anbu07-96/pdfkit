// @vitest-environment node
import { EncryptedPDFError, PDFDocument, degrees } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import type { ProcessingInputFile } from "@/lib/processing/contract";
import { ProcessingError } from "@/lib/processing/errors";
import { rotatePdfProcessor } from "@/lib/processing/processors/rotate-pdf";
import { makeBrokenPdf, makeNumberedPdf, pageWidths } from "@/test/pdf-fixtures";

async function input(name: string, pages: number): Promise<ProcessingInputFile> {
  const bytes = await makeNumberedPdf(pages);
  return { id: "input-1", name, size: bytes.length, mimeType: "application/pdf", bytes };
}

/** A document whose pages already declare a rotation. */
async function preRotatedInput(rotation: number): Promise<ProcessingInputFile> {
  const document = await PDFDocument.create();
  for (let i = 1; i <= 3; i += 1) {
    const page = document.addPage([100 + i, 200]);
    page.setRotation(degrees(rotation));
  }
  const bytes = await document.save();
  return {
    id: "input-1",
    name: "pre-rotated.pdf",
    size: bytes.length,
    mimeType: "application/pdf",
    bytes,
  };
}

async function rotate(file: ProcessingInputFile, rotations?: string) {
  return rotatePdfProcessor.process({
    toolId: "rotate-pdf",
    files: [file],
    options: { rotations },
  });
}

/** Rotation of every page of a produced document, in order. */
async function rotationsOf(bytes: Uint8Array): Promise<number[]> {
  const document = await PDFDocument.load(bytes);
  return document.getPages().map((page) => page.getRotation().angle);
}

/** Which source pages the document holds, in order (fixture geometry). */
async function sourcePagesOf(bytes: Uint8Array): Promise<number[]> {
  const document = await PDFDocument.load(bytes);
  return pageWidths(document).map((width) => width - 100);
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

describe("RotatePdfProcessor", () => {
  it("declares the tool id and single-file input rules", () => {
    expect(rotatePdfProcessor.toolId).toBe("rotate-pdf");
    expect(rotatePdfProcessor.input.minFiles).toBe(1);
    expect(rotatePdfProcessor.input.maxFiles).toBe(1);
    expect(rotatePdfProcessor.input.extensions).toEqual([".pdf"]);
  });

  it("rotates a single page to 90°", async () => {
    const result = await rotate(await input("document.pdf", 5), '{"1":90}');

    const artifact = result.artifacts[0];
    expect(artifact.name).toBe("document-rotated.pdf");
    expect(artifact.mimeType).toBe("application/pdf");
    expect(new TextDecoder().decode(artifact.bytes.slice(0, 5))).toBe("%PDF-");

    expect(await rotationsOf(artifact.bytes)).toEqual([90, 0, 0, 0, 0]);
    expect(result.meta).toMatchObject({ pages: 5, outputPages: 5, rotatedPages: 1 });
  });

  it("rotates page 3 to 180° and page 5 to 270°", async () => {
    const middle = await rotate(await input("doc.pdf", 5), '{"3":180}');
    expect(await rotationsOf(middle.artifacts[0].bytes)).toEqual([0, 0, 180, 0, 0]);

    const last = await rotate(await input("doc.pdf", 5), '{"5":270}');
    expect(await rotationsOf(last.artifacts[0].bytes)).toEqual([0, 0, 0, 0, 270]);
  });

  it("rotates several pages at once and leaves the others alone", async () => {
    const result = await rotate(
      await input("doc.pdf", 5),
      '{"1":90,"3":180,"5":270}',
    );
    expect(await rotationsOf(result.artifacts[0].bytes)).toEqual([90, 0, 180, 0, 270]);
  });

  it("rotates every page", async () => {
    for (const angle of [90, 180, 270]) {
      const rotations = JSON.stringify(
        Object.fromEntries([1, 2, 3].map((page) => [page, angle])),
      );
      const result = await rotate(await input("doc.pdf", 3), rotations);
      expect(await rotationsOf(result.artifacts[0].bytes)).toEqual([
        angle,
        angle,
        angle,
      ]);
    }
  });

  it("accepts no rotations and still returns a valid PDF", async () => {
    for (const rotations of [undefined, "", "{}", '{"2":0}']) {
      const result = await rotate(await input("doc.pdf", 3), rotations);
      expect(await rotationsOf(result.artifacts[0].bytes)).toEqual([0, 0, 0]);
      expect(result.meta).toMatchObject({ changed: "no", rotatedPages: 0 });
    }
  });

  it("preserves page count and page order", async () => {
    const result = await rotate(await input("doc.pdf", 5), '{"2":90,"4":180}');
    const document = await PDFDocument.load(result.artifacts[0].bytes);

    expect(document.getPageCount()).toBe(5);
    expect(await sourcePagesOf(result.artifacts[0].bytes)).toEqual([1, 2, 3, 4, 5]);
  });

  // Rotation is additive: it adds to whatever the page already declares.
  it("adds to an existing page rotation", async () => {
    const result = await rotate(await preRotatedInput(90), '{"1":90,"2":180}');
    expect(await rotationsOf(result.artifacts[0].bytes)).toEqual([180, 270, 90]);
  });

  it("wraps past a full turn when composing rotations", async () => {
    const result = await rotate(await preRotatedInput(270), '{"1":90}');
    expect((await rotationsOf(result.artifacts[0].bytes))[0]).toBe(0);
  });

  it("rejects an unsupported angle", async () => {
    const file = await input("doc.pdf", 3);
    for (const bad of ['{"1":45}', '{"1":-90}', '{"1":360}', '{"1":"90"}']) {
      const error = await expectFailure(rotate(file, bad), "INVALID_PAGE_ROTATION");
      expect(error.message).toMatch(/0, 90, 180 or 270/);
    }
  });

  it("rejects malformed rotation input", async () => {
    const file = await input("doc.pdf", 3);
    await expectFailure(rotate(file, "{"), "INVALID_PAGE_ROTATION");
    await expectFailure(rotate(file, "[90]"), "INVALID_PAGE_ROTATION");
    await expectFailure(rotate(file, '{"a":90}'), "INVALID_PAGE_ROTATION");
  });

  it("rejects page 0 and pages beyond the document", async () => {
    const file = await input("doc.pdf", 3);
    await expectFailure(rotate(file, '{"0":90}'), "PAGE_OUT_OF_RANGE");

    const error = await expectFailure(rotate(file, '{"9":90}'), "PAGE_OUT_OF_RANGE");
    expect(error.message).toContain("3 pages");
  });

  it("fails cleanly on a malformed PDF", async () => {
    const broken = makeBrokenPdf();
    await expectFailure(
      rotate(
        {
          id: "input-1",
          name: "broken.pdf",
          size: broken.length,
          mimeType: "application/pdf",
          bytes: broken,
        },
        '{"1":90}',
      ),
      "INVALID_PDF",
    );
  });

  it("reports password-protected documents", async () => {
    const spy = vi
      .spyOn(PDFDocument, "load")
      .mockRejectedValueOnce(new EncryptedPDFError());

    try {
      const error = await expectFailure(
        rotate(await input("locked.pdf", 3), '{"1":90}'),
        "ENCRYPTED_PDF",
      );
      expect(error.status).toBe(422);
    } finally {
      spy.mockRestore();
    }
  });

  it("validates before touching the document", async () => {
    const file = await input("doc.pdf", 3);
    const loaded = await PDFDocument.load(file.bytes);
    const saveSpy = vi.spyOn(loaded, "save");

    const loadSpy = vi.spyOn(PDFDocument, "load").mockResolvedValueOnce(loaded);
    try {
      await expectFailure(rotate(file, '{"1":45}'), "INVALID_PAGE_ROTATION");
      // No output was produced for the invalid request.
      expect(saveSpy).not.toHaveBeenCalled();
    } finally {
      loadSpy.mockRestore();
      saveSpy.mockRestore();
    }
  });

  it("sanitises the source name when naming the output", async () => {
    const result = await rotate(await input("../../secret.pdf", 2), '{"1":90}');
    expect(result.artifacts[0].name).toBe("secret-rotated.pdf");
    expect(result.artifacts[0].name).not.toContain("/");
  });

  it("rejects a request with no file", async () => {
    await expectFailure(
      rotatePdfProcessor.process({
        toolId: "rotate-pdf",
        files: [],
        options: { rotations: '{"1":90}' },
      }),
      "VALIDATION_ERROR",
    );
  });

  it("produces a document that reopens cleanly", async () => {
    const result = await rotate(await input("doc.pdf", 4), '{"2":90}');
    const reopened = await PDFDocument.load(result.artifacts[0].bytes);
    expect(reopened.getPageCount()).toBe(4);
    expect(reopened.getCreator()).toBe("PDFKit");
  });
});
