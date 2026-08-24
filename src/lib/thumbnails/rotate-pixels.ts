import type { PageRotation } from "@/lib/processing/pages";

/**
 * Pixel rotation for rendered pages.
 *
 * Rotating the rasterised bitmap — rather than re-saving the PDF with a new
 * `/Rotate` entry and rendering again — keeps preview rotation cheap and exact:
 * no resampling, no interpolation, and no chance of the stretching bug that
 * `render({ width })` caused in Phase 5. 90° and 270° swap width and height, so
 * the aspect ratio always stays correct.
 *
 * Pure and isomorphic, so it is trivially testable.
 */

export interface RotatedPixels {
  width: number;
  height: number;
  /** RGBA pixels, row-major. */
  pixels: Uint8Array;
}

export function rotateRgba(
  pixels: Uint8Array,
  width: number,
  height: number,
  rotation: PageRotation,
): RotatedPixels {
  if (rotation === 0) return { width, height, pixels };

  const expected = width * height * 4;
  if (pixels.length !== expected) {
    throw new Error(
      `Pixel buffer has ${pixels.length} bytes, expected ${expected}.`,
    );
  }

  // 90° and 270° turn the image on its side.
  const swapped = rotation === 90 || rotation === 270;
  const outWidth = swapped ? height : width;
  const outHeight = swapped ? width : height;
  const out = new Uint8Array(expected);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const from = (y * width + x) * 4;

      // Destination coordinates for a clockwise turn.
      let dx: number;
      let dy: number;
      if (rotation === 90) {
        dx = height - 1 - y;
        dy = x;
      } else if (rotation === 180) {
        dx = width - 1 - x;
        dy = height - 1 - y;
      } else {
        dx = y;
        dy = width - 1 - x;
      }

      const to = (dy * outWidth + dx) * 4;
      out[to] = pixels[from];
      out[to + 1] = pixels[from + 1];
      out[to + 2] = pixels[from + 2];
      out[to + 3] = pixels[from + 3];
    }
  }

  return { width: outWidth, height: outHeight, pixels: out };
}
