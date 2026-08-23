// @vitest-environment node
import { PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef } from "pdf-lib";
import { describe, expect, it } from "vitest";
import type { ProcessingInputFile } from "@/lib/processing/contract";
import { ProcessingError } from "@/lib/processing/errors";
import {
  imagesToPdfProcessor,
  pngToPdfProcessor,
} from "@/lib/processing/processors/images-to-pdf";
import { DEFAULT_PROCESSING_LIMITS } from "@/lib/processing/limits";
import { runProcessingJob } from "@/lib/processing/service";
import {
  makeJpeg,
  makeNonImage,
  makeNumberedPdf,
  makePng,
} from "@/test/pdf-fixtures";

async function imageFile(
  name: string,
  bytes: Uint8Array,
  mimeType = "image/jpeg",
): Promise<ProcessingInputFile> {
  return { id: `input-${name}`, name, size: bytes.length, mimeType, bytes };
}

async function convert(files: ProcessingInputFile[]) {
  return imagesToPdfProcessor.process({
    toolId: "images-to-pdf",
    files,
    options: {},
  });
}

/** Run through the real service, exactly as the API route does. */
async function runJob(files: ProcessingInputFile[]) {
  return runProcessingJob({
    toolId: "images-to-pdf",
    files: [...files],
    options: {},
  });
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

interface EmbeddedImage {
  width: number;
  height: number;
  kind: "jpeg" | "png";
  pageWidth: number;
  pageHeight: number;
}

/**
 * Inspect the produced PDF: page count, page sizes, and which image format
 * each page's XObject uses (JPEG = DCTDecode, PNG = FlateDecode/SMask).
 */
async function structureOf(bytes: Uint8Array): Promise<EmbeddedImage[]> {
  const document = await PDFDocument.load(bytes);
  const images: EmbeddedImage[] = [];

  for (const page of document.getPages()) {
    const size = page.getSize();
    const resources = page.node.Resources();
    const xobjects = resources?.lookup(PDFName.of("XObject"), PDFDict);

    let kind: EmbeddedImage["kind"] = "png";
    let width = 0;
    let height = 0;

    if (xobjects) {
      for (const [, value] of xobjects.entries()) {
        if (!(value instanceof PDFRef)) continue;
        const stream = document.context.lookup(value);
        if (!(stream instanceof PDFRawStream)) continue;
        if (
          stream.dict.lookup(PDFName.of("Filter"))?.toString().includes("DCTDecode")
        ) {
          kind = "jpeg";
        }
        width = Number(stream.dict.lookup(PDFName.of("Width"))?.toString() ?? 0);
        height = Number(stream.dict.lookup(PDFName.of("Height"))?.toString() ?? 0);
      }
    }

    images.push({
      kind,
      width,
      height,
      pageWidth: Math.round(size.width * 100) / 100,
      pageHeight: Math.round(size.height * 100) / 100,
    });
  }

  return images;
}

describe("ImagesToPdfProcessor", () => {
  it("declares the tool id and image input rules", () => {
    expect(imagesToPdfProcessor.toolId).toBe("images-to-pdf");
    expect(imagesToPdfProcessor.input.minFiles).toBe(1);
    expect(imagesToPdfProcessor.input.extensions).toEqual([".jpg", ".jpeg", ".png"]);
    expect(imagesToPdfProcessor.input.mimeTypes).toEqual([
      "image/jpeg",
      "image/png",
    ]);
    expect(imagesToPdfProcessor.input.contentKind).toBe("image");
  });

  it("converts a single JPEG into a one-page PDF", async () => {
    const result = await convert([
      await imageFile("photo.jpg", await makeJpeg(320, 200)),
    ]);

    const artifact = result.artifacts[0];
    expect(artifact.name).toBe("images-to-pdf.pdf");
    expect(artifact.mimeType).toBe("application/pdf");
    expect(new TextDecoder().decode(artifact.bytes.slice(0, 5))).toBe("%PDF-");

    const structure = await structureOf(artifact.bytes);
    expect(structure).toHaveLength(1);
    // JPEG data passes through untouched (DCTDecode), page at 96 DPI.
    expect(structure[0].kind).toBe("jpeg");
    expect(structure[0].width).toBe(320);
    expect(structure[0].height).toBe(200);
    expect(structure[0].pageWidth).toBe(240); // 320 px × 0.75
    expect(structure[0].pageHeight).toBe(150);
    expect(result.meta).toMatchObject({ pages: 1, outputPages: 1, images: 1 });
  });

  it("converts a single PNG, preserving transparency as a soft mask", async () => {
    const png = await makePng(200, 100, 5, 0);
    const result = await convert([await imageFile("logo.png", png, "image/png")]);

    const structure = await structureOf(result.artifacts[0].bytes);
    expect(structure).toHaveLength(1);
    expect(structure[0].kind).toBe("png");
    expect(structure[0].pageWidth).toBe(150);
    expect(structure[0].pageHeight).toBe(75);

    // The soft mask (SMask) is what carries the alpha channel.
    const document = await PDFDocument.load(result.artifacts[0].bytes);
    let hasSoftMask = false;
    for (const [, object] of document.context.enumerateIndirectObjects()) {
      if (!(object instanceof PDFRawStream)) continue;
      if (object.dict.lookup(PDFName.of("SMask"))) hasSoftMask = true;
    }
    expect(hasSoftMask).toBe(true);
  });

  it("converts mixed JPEG + PNG and preserves the exact input order", async () => {
    const result = await convert([
      await imageFile("one.jpg", await makeJpeg(100, 50, 1)),
      await imageFile("two.png", await makePng(80, 40, 2), "image/png"),
      await imageFile("three.jpeg", await makeJpeg(60, 30, 3)),
    ]);

    const structure = await structureOf(result.artifacts[0].bytes);
    expect(structure.map((image) => image.kind)).toEqual(["jpeg", "png", "jpeg"]);
    expect(structure.map((image) => image.pageWidth)).toEqual([75, 60, 45]);
    expect(result.meta).toMatchObject({ pages: 3, outputPages: 3, images: 3 });
  });

  it("keeps aspect ratios exact and never stretches", async () => {
    const result = await convert([
      await imageFile("wide.jpg", await makeJpeg(400, 100)),
      await imageFile("tall.jpg", await makeJpeg(100, 400)),
    ]);

    const structure = await structureOf(result.artifacts[0].bytes);
    expect(structure[0].pageWidth / structure[0].pageHeight).toBeCloseTo(4, 5);
    expect(structure[1].pageWidth / structure[1].pageHeight).toBeCloseTo(0.25, 5);
  });

  it("accepts images right at the pixel cap and sizes them at 96 DPI", async () => {
    // Patch a tiny fixture's header to a legal panorama: 12 000 px wide (the
    // exact per-side cap, far below the megapixel cap).
    const base = await makeJpeg(64, 32);
    const bytes = new Uint8Array(base);
    const view = new DataView(bytes.buffer);
    let position = 2;
    while (position + 9 < bytes.length) {
      if (view.getUint8(position) !== 0xff) {
        position += 1;
        continue;
      }
      const marker = view.getUint16(position);
      position += 2;
      if (marker === 0xffc0) {
        view.setUint16(position + 3, 3);
        view.setUint16(position + 5, 12000);
        break;
      }
      position += view.getUint16(position);
    }

    const result = await convert([await imageFile("panorama.jpg", bytes)]);
    const structure = await structureOf(result.artifacts[0].bytes);
    expect(structure[0].pageWidth).toBe(9000); // 12 000 px × 0.75
    expect(structure[0].pageHeight).toBe(2.25);
    expect(result.meta).toMatchObject({ pages: 1 });
  });

  it("rejects a disguised non-image with the right extension and MIME", async () => {
    const result = await runJob([
      await imageFile("document.jpg", makeNonImage()),
    ]);
    expect(result.status).toBe("failed");
    expect(result.status === "failed" && result.error.code).toBe("INVALID_IMAGE");
  });

  it("rejects a PDF renamed to .jpg", async () => {
    const result = await runJob([
      await imageFile("document.jpg", await makeNumberedPdf(2)),
    ]);
    expect(result.status === "failed" && result.error.code).toBe("INVALID_IMAGE");
  });

  it("rejects a wrong extension through the shared validation", async () => {
    const result = await runJob([
      await imageFile("photo.gif", await makeJpeg(20, 20), "image/gif"),
    ]);
    expect(result.status === "failed" && result.error.code).toBe("UNSUPPORTED_FILE");
  });

  it("rejects an unsupported MIME type", async () => {
    const result = await runJob([
      await imageFile("photo.jpg", await makeJpeg(20, 20), "image/webp"),
    ]);
    expect(result.status === "failed" && result.error.code).toBe("UNSUPPORTED_FILE");
  });

  it("rejects an empty file", async () => {
    const result = await runJob([await imageFile("empty.jpg", new Uint8Array(0))]);
    expect(result.status === "failed" && result.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects zero files", async () => {
    const result = await runJob([]);
    expect(result.status === "failed" && result.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects too many files via the global limit", async () => {
    const files: ProcessingInputFile[] = [];
    for (let index = 0; index < 21; index += 1) {
      files.push(
        await imageFile(`photo-${index}.jpg`, await makeJpeg(10, 10, index)),
      );
    }
    const result = await runJob(files);
    expect(result.status === "failed" && result.error.code).toBe("TOO_MANY_FILES");
  });

  it("rejects an oversized single image", async () => {
    const result = await runProcessingJob(
      {
        toolId: "images-to-pdf",
        files: [await imageFile("photo.jpg", await makeJpeg(20, 20))],
        options: {},
      },
      { limits: { ...DEFAULT_PROCESSING_LIMITS, maxFileSize: 100, maxTotalSize: 400 } },
    );
    expect(result.status === "failed" && result.error.code).toBe("FILE_TOO_LARGE");
  });

  it("rejects an oversized total request", async () => {
    const files = [
      await imageFile("a.jpg", await makeJpeg(20, 20, 1)),
      await imageFile("b.jpg", await makeJpeg(20, 20, 2)),
    ];
    const result = await runProcessingJob(
      { toolId: "images-to-pdf", files, options: {} },
      {
        limits: {
          ...DEFAULT_PROCESSING_LIMITS,
          maxTotalSize: files[0].bytes.length + 10,
        },
      },
    );
    expect(result.status === "failed" && result.error.code).toBe("TOTAL_SIZE_EXCEEDED");
  });

  it("reports pixel-cap violations per file", async () => {
    const small = await makeJpeg(64, 64);
    const bytes = new Uint8Array(small);
    const view = new DataView(bytes.buffer);
    let position = 2;
    while (position + 9 < bytes.length) {
      if (view.getUint8(position) !== 0xff) {
        position += 1;
        continue;
      }
      const marker = view.getUint16(position);
      position += 2;
      if (marker === 0xffc0) {
        view.setUint16(position + 3, 6000);
        view.setUint16(position + 5, 5000);
        break;
      }
      position += view.getUint16(position);
    }

    const error = await expectFailure(
      convert([await imageFile("huge.jpg", bytes)]),
      "INVALID_IMAGE",
    );
    expect(error.details?.[0]).toMatch(/megapixels/);
  });

  it("keeps hostile filenames out of the artifact", async () => {
    const result = await convert([
      await imageFile("../../etc/passwd.jpg", await makeJpeg(20, 20)),
    ]);
    // The output name is fixed; hostile input names cannot travel into it.
    expect(result.artifacts[0].name).toBe("images-to-pdf.pdf");
    expect(JSON.stringify(result.meta)).not.toContain("passwd");
  });

  it("does not mutate the input bytes", async () => {
    const bytes = await makeJpeg(30, 20);
    const snapshot = new Uint8Array(bytes);
    await convert([await imageFile("a.jpg", bytes)]);
    expect([...bytes]).toEqual([...snapshot]);
  });

});

describe("PngToPdfProcessor (png-to-pdf)", () => {
  it("declares the tool id and PNG-only input rules", () => {
    expect(pngToPdfProcessor.toolId).toBe("png-to-pdf");
    expect(pngToPdfProcessor.input.minFiles).toBe(1);
    expect(pngToPdfProcessor.input.extensions).toEqual([".png"]);
    expect(pngToPdfProcessor.input.mimeTypes).toEqual(["image/png"]);
    expect(pngToPdfProcessor.input.contentKind).toBe("image");
  });

  it("converts PNGs, preserves order, transparency and 96-DPI sizing", async () => {
    const result = await pngToPdfProcessor.process({
      toolId: "png-to-pdf",
      files: [
        await imageFile("one.png", await makePng(400, 200, 1), "image/png"),
        await imageFile("two.png", await makePng(200, 400, 2), "image/png"),
      ],
      options: {},
    });

    const artifact = result.artifacts[0];
    expect(artifact.name).toBe("png-to-pdf.pdf");
    expect(new TextDecoder().decode(artifact.bytes.slice(0, 5))).toBe("%PDF-");

    const document = await PDFDocument.load(artifact.bytes);
    expect(document.getPageCount()).toBe(2);
    const sizes = document.getPages().map((page) => page.getSize());
    // 96 DPI: 400×200 → 300×150; 200×400 → 150×300. Aspect exact.
    expect(sizes[0].width).toBe(300);
    expect(sizes[0].height).toBe(150);
    expect(sizes[1].width).toBe(150);
    expect(sizes[1].height).toBe(300);
    expect(result.meta).toMatchObject({ pages: 2, images: 2 });
  });

  it("keeps transparency as a soft mask over the white background", async () => {
    const result = await pngToPdfProcessor.process({
      toolId: "png-to-pdf",
      files: [await imageFile("logo.png", await makePng(100, 50, 3, 0), "image/png")],
      options: {},
    });

    const document = await PDFDocument.load(result.artifacts[0].bytes);
    let hasSoftMask = false;
    for (const [, object] of document.context.enumerateIndirectObjects()) {
      if (!(object instanceof PDFRawStream)) continue;
      if (object.dict.lookup(PDFName.of("SMask"))) hasSoftMask = true;
    }
    expect(hasSoftMask).toBe(true);
  });

  it("rejects a JPEG renamed to .png by its real signature", async () => {
    const result = await runProcessingJob({
      toolId: "png-to-pdf",
      files: [await imageFile("sneaky.png", await makeJpeg(50, 50), "image/png")],
      options: {},
    });
    // The shared validator accepts any image signature, but the processor's
    // exact-kind check must reject the JPEG payload.
    expect(result.status === "failed" && result.error.code).toBe("INVALID_IMAGE");
  });

  it("rejects a non-image with a .png name via the shared validation", async () => {
    const result = await runProcessingJob({
      toolId: "png-to-pdf",
      files: [await imageFile("fake.png", makeNonImage(), "image/png")],
      options: {},
    });
    expect(result.status === "failed" && result.error.code).toBe("INVALID_IMAGE");
  });

  it("rejects wrong extensions and unsupported MIME types", async () => {
    const jpg = await runProcessingJob({
      toolId: "png-to-pdf",
      files: [await imageFile("photo.jpg", await makeJpeg(20, 20), "image/jpeg")],
      options: {},
    });
    expect(jpg.status === "failed" && jpg.error.code).toBe("UNSUPPORTED_FILE");

    const webp = await runProcessingJob({
      toolId: "png-to-pdf",
      files: [await imageFile("photo.png", await makePng(20, 20), "image/webp")],
      options: {},
    });
    expect(webp.status === "failed" && webp.error.code).toBe("UNSUPPORTED_FILE");
  });

  it("rejects oversized pixel dimensions before embedding", async () => {
    const base = await makePng(64, 64);
    const bytes = new Uint8Array(base);
    const view = new DataView(bytes.buffer);
    view.setUint32(16, 12001); // IHDR width above the per-side cap
    view.setUint32(20, 8);

    // The header caps are enforced before any embedding happens.
    await expectFailure(
      pngToPdfProcessor.process({
        toolId: "png-to-pdf",
        files: [await imageFile("huge.png", bytes, "image/png")],
        options: {},
      }),
      "INVALID_IMAGE",
    );
  });

  it("rejects too many files via the global limit", async () => {
    const files: ProcessingInputFile[] = [];
    for (let index = 0; index < 21; index += 1) {
      files.push(await imageFile(`p${index}.png`, await makePng(10, 10, index), "image/png"));
    }
    const result = await runProcessingJob({ toolId: "png-to-pdf", files, options: {} });
    expect(result.status === "failed" && result.error.code).toBe("TOO_MANY_FILES");
  });

  it("keeps hostile names out of the fixed artifact name", async () => {
    const result = await pngToPdfProcessor.process({
      toolId: "png-to-pdf",
      files: [await imageFile("../../etc/passwd.png", await makePng(10, 10), "image/png")],
      options: {},
    });
    expect(result.artifacts[0].name).toBe("png-to-pdf.pdf");
    expect(JSON.stringify(result.meta)).not.toContain("passwd");
  });

  it("does not mutate the input bytes", async () => {
    const bytes = await makePng(30, 20);
    const snapshot = new Uint8Array(bytes);
    await pngToPdfProcessor.process({
      toolId: "png-to-pdf",
      files: [await imageFile("a.png", bytes, "image/png")],
      options: {},
    });
    expect([...bytes]).toEqual([...snapshot]);
  });
});
