import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/** Test fixtures that build genuinely valid PDFs with pdf-lib. */

/** A small, valid PDF with one page per supplied label. */
export async function makePdf(labels: string[]): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);

  for (const label of labels) {
    const page = document.addPage([300, 300]);
    page.drawText(label, { x: 20, y: 150, size: 24, font });
  }

  return document.save();
}

/**
 * A valid PDF whose pages are individually identifiable: page N is
 * `(100 + N) x 200`, so page order can be asserted after copying.
 */
export async function makeNumberedPdf(pageCount: number): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);

  for (let page = 1; page <= pageCount; page += 1) {
    const created = document.addPage([100 + page, 200]);
    created.drawText(`page ${page}`, { x: 10, y: 100, size: 10, font });
  }

  return document.save();
}

/** Page widths of a document, used to assert page identity and order. */
export function pageWidths(document: PDFDocument): number[] {
  return document.getPages().map((page) => Math.round(page.getSize().width));
}

/** Widths expected for 1-based page numbers produced by `makeNumberedPdf`. */
export function expectedWidths(pages: number[]): number[] {
  return pages.map((page) => 100 + page);
}

/**
 * A valid PDF where each page is filled with a distinct solid colour, so a
 * rendered thumbnail can be traced back to the exact source page.
 */
export async function makeColouredPdf(
  colours: [number, number, number][],
): Promise<Uint8Array> {
  const document = await PDFDocument.create();

  for (const [r, g, b] of colours) {
    const page = document.addPage([200, 200]);
    page.drawRectangle({
      x: 0,
      y: 0,
      width: 200,
      height: 200,
      color: rgb(r / 255, g / 255, b / 255),
    });
  }

  return document.save();
}

/** Distinct, easily compared page colours: page 1 red, 2 green, 3 blue, … */
export const PAGE_COLOURS: [number, number, number][] = [
  [255, 0, 0],
  [0, 255, 0],
  [0, 0, 255],
  [255, 255, 0],
  [0, 255, 255],
];

/** Bytes that start with the PDF header but are not parseable. */
export function makeBrokenPdf(): Uint8Array {
  return new TextEncoder().encode("%PDF-1.7 but truncated nonsense");
}

/** Bytes that are not a PDF at all, whatever the file is named. */
export function makeNonPdf(): Uint8Array {
  return new TextEncoder().encode("GIF89a definitely not a pdf");
}

/**
 * A valid PDF whose streams carry no `/Filter` at all — page N is
 * `(100 + N) x 200`, so page identity works like `makeNumberedPdf`.
 *
 * Built byte-by-byte (classic cross-reference table, no compression) to mimic
 * the bloated producers real compression requests come from.
 */
export function makeUncompressedPdf(pageCount: number): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [encoder.encode("%PDF-1.4\n")];
  let length = chunks[0].length;
  const offsets: number[] = [];

  const writeObject = (index: number, dict: string, stream?: Uint8Array) => {
    offsets[index] = length;
    const parts: Uint8Array[] = [encoder.encode(`${index} 0 obj\n${dict}\n`)];
    if (stream) {
      parts.push(encoder.encode("stream\n"), stream, encoder.encode("\nendstream\n"));
    }
    parts.push(encoder.encode("endobj\n"));
    for (const part of parts) {
      chunks.push(part);
      length += part.length;
    }
  };

  const kids: string[] = [];
  // Object layout: 1 catalog, 2 pages, 3 font, then page/content pairs.
  for (let page = 1; page <= pageCount; page += 1) {
    kids.push(`${3 + page * 2 - 1} 0 R`);
  }

  writeObject(1, "<< /Type /Catalog /Pages 2 0 R >>");
  writeObject(
    2,
    `<< /Type /Pages /Count ${pageCount} /Kids [${kids.join(" ")}] >>`,
  );
  writeObject(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  for (let page = 1; page <= pageCount; page += 1) {
    const pageRef = 3 + page * 2 - 1;
    const contentRef = 3 + page * 2;
    // Repetitive drawing operations make the stream big enough that flate
    // compression is a clear win.
    const operations: string[] = [
      `BT /F1 12 Tf 20 ${150} Td (page ${page}) Tj ET`,
      `0 0.${(page % 5) + 1} 0.5 rg`,
    ];
    for (let step = 0; step < 120; step += 1) {
      operations.push(
        `${(step % 40) * 2 + 5} ${(step % 60) * 3 + 10} ${
          ((step + page) % 30) * 4 + 5
        } ${(step % 50) * 2 + 8} re f`,
      );
    }
    const content = encoder.encode(`${operations.join("\n")}\n`);

    writeObject(
      pageRef,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${100 + page} 200] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentRef} 0 R >>`,
    );
    writeObject(contentRef, `<< /Length ${content.length} >>`, content);
  }

  const objectCount = 3 + pageCount * 2 + 1;
  const xrefOffset = length;
  let xref = `xref\n0 ${objectCount}\n0000000000 65535 f \n`;
  for (let index = 1; index < objectCount; index += 1) {
    xref += `${String(offsets[index] ?? 0).padStart(10, "0")} 00000 n \n`;
  }
  chunks.push(
    encoder.encode(xref),
    encoder.encode(
      `trailer\n<< /Size ${objectCount} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
    ),
  );

  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return bytes;
}

/**
 * A scanned-document-like PDF: every page is one large photographic JPEG
 * (deterministic smooth noise, ~150 DPI, quality 75) drawn full-bleed.
 * This is the class of document where aggressive compression matters most.
 */
export async function makeScannedPdf(
  pageCount: number,
  width = 600,
  height = 800,
): Promise<Uint8Array> {
  const jpeg = (await import("jpeg-js")).default;
  const document = await PDFDocument.create();

  for (let page = 1; page <= pageCount; page += 1) {
    const pixels = new Uint8Array(width * height * 4);
    let state = (0x9e3779b9 ^ (page * 2654435761)) >>> 0;
    const next = () => {
      state ^= state << 13;
      state >>>= 0;
      state ^= state >>> 17;
      state ^= state << 5;
      state >>>= 0;
      return state / 0x100000000;
    };
    let level = 128;
    for (let index = 0; index < width * height; index += 1) {
      level = Math.max(0, Math.min(255, level + (next() - 0.5) * 90));
      const value = level | 0;
      pixels[index * 4] = value;
      pixels[index * 4 + 1] = (value * 0.8 + next() * 30) | 0;
      pixels[index * 4 + 2] = (value * 0.6 + next() * 50) | 0;
      pixels[index * 4 + 3] = 255;
    }

    const encoded = jpeg.encode(
      { data: pixels, width, height },
      75,
    );
    // Copy into an offset-0 array: jpeg-js returns pooled Node Buffers, which
    // pdf-lib's JPEG scanner (it reads `.buffer` from offset 0) misreads.
    const jpg = new Uint8Array(encoded.data.length);
    jpg.set(encoded.data);
    const image = await document.embedJpg(jpg);
    const page0 = document.addPage([300, 400]);
    page0.drawImage(image, { x: 0, y: 0, width: 300, height: 400 });
  }

  return document.save();
}


/** A `File` suitable for `FormData`, backed by real PDF bytes. */
export async function makePdfFile(
  name: string,
  labels: string[] = ["page"],
): Promise<File> {
  const bytes = await makePdf(labels);
  return new File([bytes as BlobPart], name, { type: "application/pdf" });
}

/** Deterministic photo-like RGBA pixels (random-walk noise, opaque). */
export async function makeNoisePixels(
  width: number,
  height: number,
  seed: number,
  alpha = 255,
): Promise<Uint8Array> {
  const pixels = new Uint8Array(width * height * 4);
  let state = (seed >>> 0) || 1;
  const next = () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
  let level = 128;
  for (let index = 0; index < width * height; index += 1) {
    level = Math.max(0, Math.min(255, level + (next() - 0.5) * 90));
    const value = level | 0;
    pixels[index * 4] = value;
    pixels[index * 4 + 1] = (value * 0.8 + next() * 30) | 0;
    pixels[index * 4 + 2] = (value * 0.6 + next() * 50) | 0;
    pixels[index * 4 + 3] = alpha;
  }
  return pixels;
}

/** Copy into a fresh offset-0 typed array (jpeg-js returns pooled Buffers). */
function freshBytes(data: Uint8Array): Uint8Array {
  const copy = new Uint8Array(data.length);
  copy.set(data);
  return copy;
}

/**
 * A real JPEG fixture: deterministic smooth noise, so images with different
 * seeds are genuinely different files.
 */
export async function makeJpeg(
  width: number,
  height: number,
  seed = 7,
  quality = 80,
): Promise<Uint8Array> {
  const jpeg = (await import("jpeg-js")).default;
  const pixels = await makeNoisePixels(width, height, seed);
  const encoded = jpeg.encode({ data: pixels, width, height }, quality);
  return freshBytes(encoded.data);
}

/**
 * A real PNG fixture built with the production encoder (RGBA, filter 0).
 * `alpha` < 255 produces genuinely transparent pixels.
 */
export async function makePng(
  width: number,
  height: number,
  seed = 7,
  alpha = 255,
): Promise<Uint8Array> {
  const { encodePng } = await import("@/lib/thumbnails/png");
  const pixels = await makeNoisePixels(width, height, seed, alpha);
  return encodePng({ width, height, pixels });
}

/** Bytes that are neither a PDF nor an image, whatever the name claims. */
export function makeNonImage(): Uint8Array {
  return new TextEncoder().encode("GIF89a definitely not an image");
}
