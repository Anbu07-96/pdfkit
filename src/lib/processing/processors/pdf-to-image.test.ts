// @vitest-environment node
import jpeg from "jpeg-js";
import { unzipSync } from "fflate";
import { EncryptedPDFError, PDFDocument, degrees } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import type { ProcessingInputFile } from "@/lib/processing/contract";
import { ProcessingError } from "@/lib/processing/errors";
import { DEFAULT_PROCESSING_LIMITS } from "@/lib/processing/limits";
import {
  pdfToJpgProcessor,
  pdfToPngProcessor,
} from "@/lib/processing/processors/pdf-to-image";
import { runProcessingJob } from "@/lib/processing/service";
import {
  makeBrokenPdf,
  makeColouredPdf,
  makeNumberedPdf,
} from "@/test/pdf-fixtures";
import { decodePng } from "@/test/png-decode";

const CONTEXT = { limits: { ...DEFAULT_PROCESSING_LIMITS } };

async function input(name: string, bytes: Uint8Array): Promise<ProcessingInputFile> {
  return {
    id: "input-1",
    name,
    size: bytes.length,
    mimeType: "application/pdf",
    bytes,
  };
}

async function convert(
  processor: typeof pdfToJpgProcessor,
  name: string,
  bytes: Uint8Array,
  limits = CONTEXT.limits,
) {
  return processor.process(
    { toolId: processor.toolId, files: [await input(name, bytes)], options: {} },
    { limits },
  );
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

/** Decode the ZIP an artifact list represents and return its entries. */
function unzip(archive: Uint8Array): { name: string; bytes: Uint8Array }[] {
  const entries = unzipSync(archive);
  return Object.entries(entries).map(([name, bytes]) => ({ name, bytes }));
}

/** Which source pages a produced PDF holds, in order (fixture geometry). */
async function makeIdentityPdf(pages: number[]): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (const page of pages) document.addPage([100 + page, 200]);
  return document.save();
}

async function jpegSize(bytes: Uint8Array): Promise<{ width: number; height: number }> {
  const decoded = jpeg.decode(bytes, { useTArray: true });
  return { width: decoded.width, height: decoded.height };
}

describe.each([
  { name: "pdf-to-jpg", processor: pdfToJpgProcessor, ext: "jpg", mime: "image/jpeg" },
  { name: "pdf-to-png", processor: pdfToPngProcessor, ext: "png", mime: "image/png" },
])("$name processor", ({ processor, ext, mime }) => {
  it("declares the tool id and single-PDF input rules", () => {
    expect(processor.toolId).toBe(`pdf-to-${ext}`);
    expect(processor.input.minFiles).toBe(1);
    expect(processor.input.maxFiles).toBe(1);
    expect(processor.input.extensions).toEqual([".pdf"]);
  });

  it("returns one image directly for a one-page PDF", async () => {
    const result = await convert(processor, "document.pdf", await makeIdentityPdf([1]));

    expect(result.artifacts).toHaveLength(1);
    const artifact = result.artifacts[0];
    expect(artifact.name).toBe(`document-page-1.${ext}`);
    expect(artifact.mimeType).toBe(mime);
    expect(artifact.size).toBe(artifact.bytes.length);
    expect(result.bundleName).toBeUndefined();
    expect(result.meta).toMatchObject({ pages: 1, outputPages: 1, images: 1 });
  });

  it("renders every page of a multi-page PDF in order, as a bundle", async () => {
    const result = await convert(processor, "doc.pdf", await makeIdentityPdf([1, 2, 3, 4, 5]));

    expect(result.artifacts).toHaveLength(5);
    expect(result.artifacts.map((artifact) => artifact.name)).toEqual([
      `doc-page-1.${ext}`,
      `doc-page-2.${ext}`,
      `doc-page-3.${ext}`,
      `doc-page-4.${ext}`,
      `doc-page-5.${ext}`,
    ]);
    expect(result.bundleName).toBe(`doc-${ext}.zip`);
    expect(result.meta).toMatchObject({ pages: 5, outputPages: 5, images: 5 });
  });

  it("keeps page aspect ratios exact (no stretching)", async () => {
    const document = await PDFDocument.create();
    document.addPage([400, 200]); // wide
    document.addPage([200, 400]); // tall
    const bytes = await document.save();

    const result = await convert(processor, "ratio.pdf", bytes);
    const first = await imageSize(result.artifacts[0].bytes, ext);
    const second = await imageSize(result.artifacts[1].bytes, ext);

    expect(first.width / first.height).toBeCloseTo(2, 1);
    expect(second.width / second.height).toBeCloseTo(0.5, 1);
    // 150 DPI default: 400 pt ≈ 833 px.
    expect(first.width).toBeGreaterThan(700);
    expect(first.width).toBeLessThan(900);
  });

  it("renders rotated pages in display orientation", async () => {
    const document = await PDFDocument.create();
    document.addPage([400, 200]).setRotation(degrees(90));
    const bytes = await document.save();

    const result = await convert(processor, "rot.pdf", bytes);
    const size = await imageSize(result.artifacts[0].bytes, ext);
    expect(size.width / size.height).toBeCloseTo(0.5, 1); // display is tall
  });

  it("preserves rendered colours", async () => {
    const bytes = await makeColouredPdf([[255, 0, 0]]);

    const result = await convert(processor, "colour.pdf", bytes);
    const pixel = await firstPixel(result.artifacts[0].bytes, ext);
    expect(pixel[0]).toBeGreaterThan(200); // strongly red
    expect(pixel[1]).toBeLessThan(80);
    expect(pixel[2]).toBeLessThan(80);
  });

  it("rejects a malformed PDF", async () => {
    await expectFailure(
      convert(processor, "broken.pdf", makeBrokenPdf()),
      "INVALID_PDF",
    );
  });

  it("rejects an encrypted PDF", async () => {
    const spy = vi
      .spyOn(PDFDocument, "load")
      .mockRejectedValueOnce(new EncryptedPDFError());
    try {
      await expectFailure(
        convert(processor, "locked.pdf", await makeIdentityPdf([1])),
        "ENCRYPTED_PDF",
      );
    } finally {
      spy.mockRestore();
    }
  });

  it("rejects documents above the page limit before rendering", async () => {
    const bytes = await makeNumberedPdf(3);
    const error = await expectFailure(
      convert(processor, "long.pdf", bytes, {
        ...CONTEXT.limits,
        maxConversionPages: 2,
      }),
      "TOO_MANY_OUTPUTS",
    );
    expect(error.status).toBe(413);
  });

  it("rejects a rendered page above the output byte limit", async () => {
    const bytes = await makeNumberedPdf(1);
    await expectFailure(
      convert(processor, "big.pdf", bytes, {
        ...CONTEXT.limits,
        conversionMaxImageBytes: 10,
      }),
      "OUTPUT_TOO_LARGE",
    );
  });

  it("honours a lower DPI from the limits", async () => {
    const bytes = await makeIdentityPdf([1]);
    const result = await convert(processor, "dpi.pdf", bytes, {
      ...CONTEXT.limits,
      conversionDpi: 72,
    });
    const size = await imageSize(result.artifacts[0].bytes, ext);
    // 72 DPI = 1 px per point: a 101 pt wide page renders ~101 px.
    expect(size.width).toBeGreaterThanOrEqual(100);
    expect(size.width).toBeLessThanOrEqual(103);
  });

  it("sanitises hostile filenames out of the artifact names", async () => {
    const result = await convert(
      processor,
      "../../etc/passwd.pdf",
      await makeIdentityPdf([1]),
    );
    expect(result.artifacts[0].name).toBe(`passwd-page-1.${ext}`);
    expect(result.bundleName ?? result.artifacts[0].name).not.toContain("..");
    expect(result.bundleName ?? "").not.toMatch(/[/\\\\]/);
  });

  it("requires exactly one file (service level)", async () => {
    const bytes = await makeIdentityPdf([1]);
    const result = await runProcessingJob({
      toolId: processor.toolId as "pdf-to-jpg",
      files: [await input("a.pdf", bytes), await input("b.pdf", bytes)],
      options: {},
    });
    expect(result.status === "failed" && result.error.code).toBe("TOO_MANY_FILES");
  });

  it("does not mutate the input bytes", async () => {
    const bytes = await makeIdentityPdf([1, 2]);
    const snapshot = new Uint8Array(bytes);
    await convert(processor, "keep.pdf", bytes);
    expect([...bytes]).toEqual([...snapshot]);
  });
});

describe("pdf-to-jpg output", () => {
  it("produces real decodable JPEGs with correct dimensions", async () => {
    const result = await convert(
      pdfToJpgProcessor,
      "a.pdf",
      await makeIdentityPdf([1, 2]),
    );

    for (const artifact of result.artifacts) {
      expect(artifact.bytes[0]).toBe(0xff); // SOI
      expect(artifact.bytes[1]).toBe(0xd8);
      const size = await jpegSize(artifact.bytes);
      expect(size.width).toBeGreaterThan(0);
      expect(size.height).toBeGreaterThan(0);
    }
  });

  it("builds a ZIP whose entries decode and match the artifact list", async () => {
    const result = await convert(
      pdfToJpgProcessor,
      "doc.pdf",
      await makeIdentityPdf([1, 2, 3]),
    );
    const archive = await import("@/lib/processing/zip").then((zip) =>
      zip.createZipArchive(result.artifacts),
    );
    const entries = unzip(archive);

    expect(entries.map((entry) => entry.name).sort()).toEqual(
      [`doc-page-1.jpg`, `doc-page-2.jpg`, `doc-page-3.jpg`].sort(),
    );
    for (const entry of entries) {
      expect(entry.bytes[0]).toBe(0xff);
      expect(entry.bytes[1]).toBe(0xd8);
      expect((await jpegSize(entry.bytes)).width).toBeGreaterThan(0);
    }
  });
});

describe("pdf-to-png output", () => {
  it("produces real PNGs that decode with valid pixel data", async () => {
    const result = await convert(
      pdfToPngProcessor,
      "a.pdf",
      await makeIdentityPdf([2]),
    );

    const artifact = result.artifacts[0];
    expect(artifact.bytes[0]).toBe(0x89);
    expect(new TextDecoder().decode(artifact.bytes.slice(1, 4))).toBe("PNG");

    const decoded = decodePng(artifact.bytes);
    expect(decoded.width).toBeGreaterThan(0);
    expect(decoded.height).toBeGreaterThan(0);
    expect(decoded.pixels.length).toBe(decoded.width * decoded.height * 4);
    // Page background renders opaque white.
    const corner = [
      decoded.pixels[0],
      decoded.pixels[1],
      decoded.pixels[2],
      decoded.pixels[3],
    ];
    expect(corner[0]).toBeGreaterThan(240);
    expect(corner[3]).toBe(255);
  });

  it("builds a ZIP whose PNG entries decode", async () => {
    const result = await convert(
      pdfToPngProcessor,
      "doc.pdf",
      await makeIdentityPdf([1, 2]),
    );
    const archive = await import("@/lib/processing/zip").then((zip) =>
      zip.createZipArchive(result.artifacts),
    );
    const entries = unzip(archive);
    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      expect(entry.bytes[0]).toBe(0x89);
      expect(decodePng(entry.bytes).width).toBeGreaterThan(0);
    }
  });
});

/** Format-agnostic size probe for produced images. */
async function imageSize(
  bytes: Uint8Array,
  ext: string,
): Promise<{ width: number; height: number }> {
  if (ext === "jpg") return jpegSize(bytes);
  const decoded = decodePng(bytes);
  return { width: decoded.width, height: decoded.height };
}

/** Format-agnostic first-pixel probe (approximate for JPEG). */
async function firstPixel(
  bytes: Uint8Array,
  ext: string,
): Promise<number[]> {
  if (ext === "jpg") {
    const decoded = jpeg.decode(bytes, { useTArray: true });
    return [
      decoded.data[0],
      decoded.data[1],
      decoded.data[2],
      decoded.data[3],
    ];
  }
  const decoded = decodePng(bytes);
  return [
    decoded.pixels[0],
    decoded.pixels[1],
    decoded.pixels[2],
    decoded.pixels[3],
  ];
}
