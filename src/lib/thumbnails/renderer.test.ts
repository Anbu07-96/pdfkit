// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ProcessingError } from "@/lib/processing/errors";
import { DEFAULT_PROCESSING_LIMITS } from "@/lib/processing/limits";
import { DEFAULT_THUMBNAIL_LIMITS } from "@/lib/thumbnails/limits";
import { renderPdfPageThumbnails } from "@/lib/thumbnails/renderer";
import { createPageThumbnails, parseRequestedPages } from "@/lib/thumbnails/service";
import type { ProcessingInputFile } from "@/lib/processing/contract";
import {
  makeBrokenPdf,
  makeColouredPdf,
  makeNonPdf,
  makeNumberedPdf,
  PAGE_COLOURS,
} from "@/test/pdf-fixtures";
import { centerPixel, decodePng } from "@/test/png-decode";

const render = (bytes: Uint8Array, pages: number[], overrides = {}) =>
  renderPdfPageThumbnails(bytes, {
    pages,
    width: DEFAULT_THUMBNAIL_LIMITS.width,
    maxImageBytes: DEFAULT_THUMBNAIL_LIMITS.maxImageBytes,
    ...overrides,
  });

function inputFile(bytes: Uint8Array, name = "document.pdf"): ProcessingInputFile {
  return { id: "input-1", name, size: bytes.length, mimeType: "application/pdf", bytes };
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

describe("renderPdfPageThumbnails", () => {
  it("renders a single page as a real PNG", async () => {
    const { pageCount, thumbnails } = await render(await makeNumberedPdf(3), [1]);

    expect(pageCount).toBe(3);
    expect(thumbnails).toHaveLength(1);

    const [thumbnail] = thumbnails;
    expect(thumbnail.pageNumber).toBe(1);
    expect(thumbnail.mimeType).toBe("image/png");
    expect(thumbnail.bytes.length).toBeGreaterThan(0);

    const image = decodePng(thumbnail.bytes);
    expect(image.width).toBe(DEFAULT_THUMBNAIL_LIMITS.width);
    expect(image.height).toBeGreaterThan(0);
    expect(image.colorType).toBe(6);
    expect(thumbnail.width).toBe(image.width);
    expect(thumbnail.height).toBe(image.height);
  });

  it("renders several pages in the requested order", async () => {
    const { thumbnails } = await render(await makeNumberedPdf(5), [3, 1, 5]);
    expect(thumbnails.map((t) => t.pageNumber)).toEqual([3, 1, 5]);
  });

  // Page identity: each source page is a different solid colour, so the
  // rendered pixels prove which page was rasterised — not just how many.
  it("renders the pages that were actually requested", async () => {
    const pdf = await makeColouredPdf(PAGE_COLOURS);
    const { thumbnails } = await render(pdf, [1, 3, 5]);

    const colours = thumbnails.map((thumbnail) => {
      const [r, g, b] = centerPixel(decodePng(thumbnail.bytes));
      return [r, g, b];
    });

    expect(colours[0]).toEqual(PAGE_COLOURS[0]); // page 1 → red
    expect(colours[1]).toEqual(PAGE_COLOURS[2]); // page 3 → blue
    expect(colours[2]).toEqual(PAGE_COLOURS[4]); // page 5 → cyan
  });

  it("keeps page identity when pages are requested out of order", async () => {
    const pdf = await makeColouredPdf(PAGE_COLOURS);
    const { thumbnails } = await render(pdf, [4, 2]);

    expect(centerPixel(decodePng(thumbnails[0].bytes)).slice(0, 3)).toEqual(
      PAGE_COLOURS[3],
    );
    expect(centerPixel(decodePng(thumbnails[1].bytes)).slice(0, 3)).toEqual(
      PAGE_COLOURS[1],
    );
  });

  it("respects the configured width and keeps the page aspect ratio", async () => {
    // Page N of this fixture is (100 + N) x 200 points.
    const { thumbnails } = await render(await makeNumberedPdf(3), [1, 3], {
      width: 150,
    });

    for (const thumbnail of thumbnails) {
      expect(thumbnail.width).toBe(150);
    }
    // Wider source page ⇒ shorter render at a fixed width.
    expect(thumbnails[1].height).toBeLessThan(thumbnails[0].height);
  });

  it("rejects page 0 and pages beyond the document", async () => {
    const pdf = await makeNumberedPdf(3);
    await expectFailure(render(pdf, [0]), "PAGE_OUT_OF_RANGE");
    await expectFailure(render(pdf, [4]), "PAGE_OUT_OF_RANGE");
    await expectFailure(render(pdf, [1, 99]), "PAGE_OUT_OF_RANGE");
  });

  it("rejects a malformed PDF", async () => {
    await expectFailure(render(makeBrokenPdf(), [1]), "INVALID_PDF");
  });

  it("rejects data that is not a PDF at all", async () => {
    await expectFailure(render(makeNonPdf(), [1]), "INVALID_PDF");
  });

  it("rejects an empty buffer", async () => {
    await expectFailure(render(new Uint8Array(), [1]), "INVALID_PDF");
  });

  it("enforces the maximum image size", async () => {
    await expectFailure(
      render(await makeNumberedPdf(2), [1], { maxImageBytes: 10 }),
      "PROCESSING_ERROR",
    );
  });

  it("reports the page count without rendering anything", async () => {
    const { pageCount, thumbnails } = await render(await makeNumberedPdf(7), []);
    expect(pageCount).toBe(7);
    expect(thumbnails).toEqual([]);
  });

  it("handles repeated requests without accumulating state", async () => {
    const pdf = await makeNumberedPdf(3);
    for (let i = 0; i < 5; i += 1) {
      const { thumbnails } = await render(pdf, [1, 2, 3]);
      expect(thumbnails).toHaveLength(3);
    }
  });

  it("handles concurrent requests safely", async () => {
    const pdf = await makeColouredPdf(PAGE_COLOURS);
    const results = await Promise.all([
      render(pdf, [1]),
      render(pdf, [3]),
      render(pdf, [5]),
    ]);

    expect(results.map((r) => r.thumbnails[0].pageNumber)).toEqual([1, 3, 5]);
    expect(centerPixel(decodePng(results[1].thumbnails[0].bytes)).slice(0, 3)).toEqual(
      PAGE_COLOURS[2],
    );
  });
});

describe("parseRequestedPages", () => {
  it("parses a page list", () => {
    expect(parseRequestedPages("1,3,5")).toEqual([1, 3, 5]);
    expect(parseRequestedPages(" 2 , 1 ")).toEqual([2, 1]);
  });

  it("removes duplicates", () => {
    expect(parseRequestedPages("1,1,2")).toEqual([1, 2]);
  });

  it("treats missing or empty input as 'no explicit pages'", () => {
    expect(parseRequestedPages(null)).toEqual([]);
    expect(parseRequestedPages("")).toEqual([]);
    expect(parseRequestedPages("   ")).toEqual([]);
  });

  it("rejects invalid values", () => {
    expect(() => parseRequestedPages("abc")).toThrowError(ProcessingError);
    expect(() => parseRequestedPages("1,x")).toThrowError(ProcessingError);
    expect(() => parseRequestedPages("0")).toThrowError(/start at 1/);
    expect(() => parseRequestedPages("-1")).toThrowError(ProcessingError);
  });
});

describe("createPageThumbnails", () => {
  it("renders every page when none are requested", async () => {
    const body = await createPageThumbnails(inputFile(await makeNumberedPdf(4)));

    expect(body.pageCount).toBe(4);
    expect(body.thumbnails.map((t) => t.pageNumber)).toEqual([1, 2, 3, 4]);
    for (const thumbnail of body.thumbnails) {
      expect(thumbnail.dataUrl.startsWith("data:image/png;base64,")).toBe(true);
      expect(thumbnail.dataUrl.length).toBeGreaterThan(100);
    }
  });

  it("renders only the requested pages", async () => {
    const body = await createPageThumbnails(inputFile(await makeNumberedPdf(6)), {
      pages: [2, 4],
    });
    expect(body.thumbnails.map((t) => t.pageNumber)).toEqual([2, 4]);
    expect(body.pageCount).toBe(6);
  });

  it("caps how many pages are rendered when none are requested", async () => {
    const body = await createPageThumbnails(inputFile(await makeNumberedPdf(8)), {
      thumbnailLimits: { ...DEFAULT_THUMBNAIL_LIMITS, maxPages: 3 },
    });
    expect(body.thumbnails).toHaveLength(3);
    expect(body.pageCount).toBe(8);
  });

  it("rejects asking for more pages than the limit allows", async () => {
    await expectFailure(
      createPageThumbnails(inputFile(await makeNumberedPdf(10)), {
        pages: [1, 2, 3, 4],
        thumbnailLimits: { ...DEFAULT_THUMBNAIL_LIMITS, maxPages: 3 },
      }),
      "TOO_MANY_OUTPUTS",
    );
  });

  it("applies the shared document validation", async () => {
    // Not a PDF, whatever the name says.
    await expectFailure(
      createPageThumbnails(inputFile(makeNonPdf(), "invoice.pdf")),
      "INVALID_PDF",
    );

    // Wrong extension.
    await expectFailure(
      createPageThumbnails(inputFile(await makeNumberedPdf(2), "photo.png")),
      "UNSUPPORTED_FILE",
    );

    // Too large for the processing limits.
    await expectFailure(
      createPageThumbnails(inputFile(await makeNumberedPdf(2)), {
        processingLimits: { ...DEFAULT_PROCESSING_LIMITS, maxFileSize: 50 },
      }),
      "FILE_TOO_LARGE",
    );
  });

  it("rejects requested pages beyond the document", async () => {
    await expectFailure(
      createPageThumbnails(inputFile(await makeNumberedPdf(3)), { pages: [9] }),
      "PAGE_OUT_OF_RANGE",
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Rotated previews (Phase 6)                                                 */
/* -------------------------------------------------------------------------- */

describe("renderPdfPageThumbnails — rotation", () => {
  /** Page 1 is 100x200 (portrait), so orientation changes are obvious. */
  async function portraitPdf() {
    const { PDFDocument, rgb } = await import("pdf-lib");
    const document = await PDFDocument.create();
    const page = document.addPage([100, 200]);
    // Mark the top-left corner so orientation can be checked by pixel.
    page.drawRectangle({ x: 0, y: 150, width: 50, height: 50, color: rgb(1, 0, 0) });
    return document.save();
  }

  it("renders an unrotated page as the baseline", async () => {
    const { thumbnails } = await render(await portraitPdf(), [1], { width: 100 });
    const image = decodePng(thumbnails[0].bytes);

    expect(thumbnails[0].rotation).toBe(0);
    expect(image.width).toBe(100);
    expect(image.height).toBe(200);
  });

  it("swaps width and height for 90° and 270°", async () => {
    for (const rotation of [90, 270] as const) {
      const { thumbnails } = await render(await portraitPdf(), [1], {
        width: 100,
        rotations: { 1: rotation },
      });

      const image = decodePng(thumbnails[0].bytes);
      expect(thumbnails[0].rotation).toBe(rotation);
      expect(thumbnails[0].width).toBe(image.width);
      expect(thumbnails[0].height).toBe(image.height);
      // Portrait becomes landscape.
      expect(image.width).toBe(200);
      expect(image.height).toBe(100);
    }
  });

  it("keeps the dimensions for 180°", async () => {
    const { thumbnails } = await render(await portraitPdf(), [1], {
      width: 100,
      rotations: { 1: 180 },
    });

    const image = decodePng(thumbnails[0].bytes);
    expect(image.width).toBe(100);
    expect(image.height).toBe(200);
  });

  it("never stretches: the rotated area equals the original area", async () => {
    const base = decodePng((await render(await portraitPdf(), [1], { width: 100 })).thumbnails[0].bytes);

    for (const rotation of [90, 180, 270] as const) {
      const { thumbnails } = await render(await portraitPdf(), [1], {
        width: 100,
        rotations: { 1: rotation },
      });
      const image = decodePng(thumbnails[0].bytes);
      expect(image.width * image.height).toBe(base.width * base.height);
    }
  });

  // Pixel proof: the red corner marker moves exactly as a clockwise turn implies.
  it("actually turns the image", async () => {
    const pdf = await portraitPdf();

    function cornerColours(image: ReturnType<typeof decodePng>) {
      const at = (x: number, y: number) => {
        const index = (y * image.width + x) * 4;
        return [image.pixels[index], image.pixels[index + 1], image.pixels[index + 2]];
      };
      return {
        topLeft: at(2, 2),
        topRight: at(image.width - 3, 2),
        bottomRight: at(image.width - 3, image.height - 3),
        bottomLeft: at(2, image.height - 3),
      };
    }

    const RED = [255, 0, 0];

    const upright = cornerColours(
      decodePng((await render(pdf, [1], { width: 100 })).thumbnails[0].bytes),
    );
    expect(upright.topLeft).toEqual(RED);

    const turned90 = cornerColours(
      decodePng(
        (await render(pdf, [1], { width: 100, rotations: { 1: 90 } })).thumbnails[0]
          .bytes,
      ),
    );
    expect(turned90.topRight).toEqual(RED);
    expect(turned90.topLeft).not.toEqual(RED);

    const turned180 = cornerColours(
      decodePng(
        (await render(pdf, [1], { width: 100, rotations: { 1: 180 } })).thumbnails[0]
          .bytes,
      ),
    );
    expect(turned180.bottomRight).toEqual(RED);

    const turned270 = cornerColours(
      decodePng(
        (await render(pdf, [1], { width: 100, rotations: { 1: 270 } })).thumbnails[0]
          .bytes,
      ),
    );
    expect(turned270.bottomLeft).toEqual(RED);
  });

  it("rotates only the pages that were asked for", async () => {
    const pdf = await makeColouredPdf(PAGE_COLOURS);
    const { thumbnails } = await render(pdf, [1, 2], { rotations: { 2: 90 } });

    expect(thumbnails[0].rotation).toBe(0);
    expect(thumbnails[1].rotation).toBe(90);
    // Page identity survives rotation.
    expect(centerPixel(decodePng(thumbnails[1].bytes)).slice(0, 3)).toEqual(
      PAGE_COLOURS[1],
    );
  });

  it("still enforces the image byte limit for rotated previews", async () => {
    await expectFailure(
      render(await makeNumberedPdf(2), [1], {
        maxImageBytes: 10,
        rotations: { 1: 90 },
      }),
      "PROCESSING_ERROR",
    );
  });
});

describe("createPageThumbnails — rotation", () => {
  it("passes rotations through and reports them", async () => {
    const body = await createPageThumbnails(inputFile(await makeNumberedPdf(3)), {
      pages: [1, 2],
      rotations: { 1: 270 },
    });

    expect(body.thumbnails.map((t) => [t.pageNumber, t.rotation])).toEqual([
      [1, 270],
      [2, 0],
    ]);
  });

  it("rejects an unsupported rotation before rendering", async () => {
    await expectFailure(
      createPageThumbnails(inputFile(await makeNumberedPdf(3)), {
        pages: [1],
        rotations: { 1: 45 as never },
      }),
      "INVALID_PAGE_ROTATION",
    );
  });
});

describe("parseRequestedRotations", () => {
  it("parses the wire format", async () => {
    const { parseRequestedRotations } = await import("@/lib/thumbnails/service");
    expect(parseRequestedRotations('{"1":90,"4":180}')).toEqual({ 1: 90, 4: 180 });
    expect(parseRequestedRotations(null)).toEqual({});
    expect(parseRequestedRotations("")).toEqual({});
  });

  it("rejects invalid input", async () => {
    const { parseRequestedRotations } = await import("@/lib/thumbnails/service");
    expect(() => parseRequestedRotations('{"1":45}')).toThrowError(ProcessingError);
    expect(() => parseRequestedRotations("[1]")).toThrowError(ProcessingError);
    expect(() => parseRequestedRotations("{")).toThrowError(ProcessingError);
  });
});
