import { unzlibSync } from "fflate";
import { readPngHeader } from "@/lib/thumbnails/png";

/**
 * Independent PNG decoder for tests.
 *
 * Deliberately does not reuse the encoder: it walks the chunks and inflates the
 * IDAT stream itself, so a bug in `encodePng` cannot hide behind a matching
 * bug in the decoder.
 */
export interface DecodedPng {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  chunks: string[];
  /** RGBA pixels, row-major. */
  pixels: Uint8Array;
}

export function decodePng(png: Uint8Array): DecodedPng {
  const header = readPngHeader(png);
  if (!header) throw new Error("not a PNG");

  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const idat: Uint8Array[] = [];
  const chunks: string[] = [];

  let offset = 8;
  while (offset < png.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(
      png[offset + 4],
      png[offset + 5],
      png[offset + 6],
      png[offset + 7],
    );
    chunks.push(type);
    if (type === "IDAT") idat.push(png.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }

  const compressed = new Uint8Array(idat.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (const part of idat) {
    compressed.set(part, at);
    at += part.length;
  }

  const raw = unzlibSync(compressed);
  const stride = header.width * 4;
  const pixels = new Uint8Array(header.width * header.height * 4);
  for (let y = 0; y < header.height; y += 1) {
    const filter = raw[y * (stride + 1)];
    if (filter !== 0) throw new Error(`unexpected PNG filter ${filter}`);
    pixels.set(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), y * stride);
  }

  return { ...header, chunks, pixels };
}

/** RGBA of the pixel at the centre of a decoded image. */
export function centerPixel(image: DecodedPng): [number, number, number, number] {
  const x = Math.floor(image.width / 2);
  const y = Math.floor(image.height / 2);
  const at = (y * image.width + x) * 4;
  return [image.pixels[at], image.pixels[at + 1], image.pixels[at + 2], image.pixels[at + 3]];
}
