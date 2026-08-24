/**
 * Minimal PNG encoder.
 *
 * The rasterizer hands back raw RGBA pixels; browsers need an image. Rather
 * than adding an imaging dependency (sharp, canvas, jimp) just to write a
 * bitmap, this encodes the PNG directly — the format is a handful of chunks and
 * a zlib stream, and PDFKit already depends on fflate for zlib.
 *
 * Pure and isomorphic: no filesystem, no native code, easy to test.
 */

import { zlibSync } from "fflate";

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Colour type 6 = truecolour with alpha (RGBA), 8 bits per channel. */
const COLOR_TYPE_RGBA = 6;
const BIT_DEPTH = 8;
const CHANNELS = 4;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);

  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);

  const crc = crc32(out.subarray(4, 8 + data.length));
  view.setUint32(8 + data.length, crc);

  return out;
}

export interface EncodePngOptions {
  width: number;
  height: number;
  /** RGBA pixels, row-major, `width * height * 4` bytes. */
  pixels: Uint8Array;
  /** zlib level 0-9. 6 is a good size/speed trade-off for page previews. */
  level?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
}

/** Encode RGBA pixels as a PNG. */
export function encodePng({
  width,
  height,
  pixels,
  level = 6,
}: EncodePngOptions): Uint8Array {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error("PNG dimensions must be positive integers.");
  }

  const expected = width * height * CHANNELS;
  if (pixels.length !== expected) {
    throw new Error(
      `PNG pixel buffer has ${pixels.length} bytes, expected ${expected}.`,
    );
  }

  // Each scanline is prefixed with its filter type; 0 = None, which keeps the
  // encoder simple and still compresses well for flat page renders.
  const stride = width * CHANNELS;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    raw.set(pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width);
  ihdrView.setUint32(4, height);
  ihdr[8] = BIT_DEPTH;
  ihdr[9] = COLOR_TYPE_RGBA;
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter method: adaptive
  ihdr[12] = 0; // interlace: none

  const parts = [
    PNG_SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlibSync(raw, { level })),
    chunk("IEND", new Uint8Array(0)),
  ];

  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const png = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    png.set(part, offset);
    offset += part.length;
  }

  return png;
}

export interface PngHeader {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
}

/**
 * Read a PNG's IHDR. Used by tests (and callers that want to sanity-check a
 * produced image) without pulling in a decoder.
 */
export function readPngHeader(png: Uint8Array): PngHeader | null {
  if (png.length < 33) return null;
  for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
    if (png[i] !== PNG_SIGNATURE[i]) return null;
  }

  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const type = String.fromCharCode(png[12], png[13], png[14], png[15]);
  if (type !== "IHDR") return null;

  return {
    width: view.getUint32(16),
    height: view.getUint32(20),
    bitDepth: png[24],
    colorType: png[25],
  };
}
