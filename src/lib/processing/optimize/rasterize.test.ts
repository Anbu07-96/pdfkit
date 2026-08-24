// @vitest-environment node
import { PDFDocument, PDFName, PDFRawStream, degrees, rgb } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { rasterizePdfForCompression } from "@/lib/processing/optimize/rasterize";
import { makeBrokenPdf, makeScannedPdf, pageWidths } from "@/test/pdf-fixtures";

/** How many image XObjects a document contains. */
async function imageCount(bytes: Uint8Array): Promise<number> {
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  let count = 0;
  for (const [, object] of document.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue;
    if (object.dict.lookup(PDFName.of("Subtype"))?.toString() === "/Image") {
      count += 1;
    }
  }
  return count;
}

describe("rasterizePdfForCompression", () => {
  it("rebuilds every page as a valid JPEG page, in order", async () => {
    // Pages 10 pt apart, so pixel rounding (±1 pt) can never hide the order.
    const sourceDocument = await PDFDocument.create();
    for (let page = 1; page <= 4; page += 1) {
      sourceDocument.addPage([100 + page * 10, 200]);
    }
    const source = await sourceDocument.save();

    const { bytes, pageCount } = await rasterizePdfForCompression(source);

    expect(pageCount).toBe(4);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");

    const document = await PDFDocument.load(bytes);
    expect(document.getPageCount()).toBe(4);
    // Page geometry follows the original display size. pdfium rounds the
    // bitmap to whole pixels, so allow ±1.5 pt of slack — the strictly
    // increasing widths still prove identity and order survived.
    const widths = pageWidths(document);
    expect(widths[0]).toBeGreaterThanOrEqual(108.5);
    expect(widths[0]).toBeLessThanOrEqual(111.5);
    expect(widths[3]).toBeGreaterThanOrEqual(138.5);
    expect(widths[3]).toBeLessThanOrEqual(141.5);
    expect(widths[0]).toBeLessThan(widths[1]);
    expect(widths[1]).toBeLessThan(widths[2]);
    expect(widths[2]).toBeLessThan(widths[3]);
    // One full-page image per page.
    expect(await imageCount(bytes)).toBe(4);
  });

  it("produces smaller output for scanned-style input", async () => {
    // The fixture embeds quality-75 JPEGs at double the raster resolution, so
    // the rasterised rebuild must come out smaller — the case this pass
    // exists for.
    const source = await makeScannedPdf(2, 600, 800);
    const { bytes } = await rasterizePdfForCompression(source);
    expect(bytes.length).toBeLessThan(source.length);
    expect(await imageCount(bytes)).toBe(2);
  });

  it("rejects bytes pdfium cannot open", async () => {
    await expect(rasterizePdfForCompression(makeBrokenPdf())).rejects.toThrow(
      /could not/i,
    );
  });

  it("keeps rotated pages upright (rotation baked into the pixels)", async () => {
    const document = await PDFDocument.create();
    const page = document.addPage([200, 100]);
    // Black rectangle over the left half before rotation.
    page.drawRectangle({ x: 0, y: 0, width: 100, height: 100, color: rgb(0, 0, 0) });
    page.setRotation(degrees(90));
    const source = await document.save();

    const { bytes } = await rasterizePdfForCompression(source);
    const output = await PDFDocument.load(bytes);

    // Display size of a 200x100 page rotated by 90° is 100x200, and the new
    // page carries no /Rotate — the rotation is part of the image now.
    // pdfium rounds bitmap dimensions to whole pixels, so allow a point of
    // rounding slack while asserting the aspect actually swapped.
    const size = output.getPage(0).getSize();
    expect(size.width).toBeGreaterThan(95);
    expect(size.width).toBeLessThan(105);
    expect(size.height).toBeGreaterThan(195);
    expect(size.height).toBeLessThan(205);
    expect(size.height).toBeGreaterThan(size.width);
    expect(output.getPage(0).getRotation().angle).toBe(0);
  });
});
