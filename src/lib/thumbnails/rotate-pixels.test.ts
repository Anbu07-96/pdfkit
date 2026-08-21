// @vitest-environment node
import { describe, expect, it } from "vitest";
import { rotateRgba, type RotatedPixels } from "@/lib/thumbnails/rotate-pixels";

/**
 * A 2x3 image (width 2, height 3) with a distinct colour per pixel:
 *
 *   A B
 *   C D
 *   E F
 */
const A = [1, 0, 0, 255];
const B = [2, 0, 0, 255];
const C = [3, 0, 0, 255];
const D = [4, 0, 0, 255];
const E = [5, 0, 0, 255];
const F = [6, 0, 0, 255];

const IMAGE = new Uint8Array([...A, ...B, ...C, ...D, ...E, ...F]);

/** Read the image back as a grid of red-channel markers. */
function grid(pixels: Uint8Array, width: number, height: number): number[][] {
  const rows: number[][] = [];
  for (let y = 0; y < height; y += 1) {
    const row: number[] = [];
    for (let x = 0; x < width; x += 1) row.push(pixels[(y * width + x) * 4]);
    rows.push(row);
  }
  return rows;
}

describe("rotateRgba", () => {
  it("returns the original buffer for 0°", () => {
    const result = rotateRgba(IMAGE, 2, 3, 0);
    expect(result.width).toBe(2);
    expect(result.height).toBe(3);
    expect(result.pixels).toBe(IMAGE);
  });

  it("rotates 90° clockwise and swaps the dimensions", () => {
    const result = rotateRgba(IMAGE, 2, 3, 90);

    expect(result.width).toBe(3);
    expect(result.height).toBe(2);
    // A B      E C A
    // C D  →   F D B
    // E F
    expect(grid(result.pixels, 3, 2)).toEqual([
      [5, 3, 1],
      [6, 4, 2],
    ]);
  });

  it("rotates 180° and keeps the dimensions", () => {
    const result = rotateRgba(IMAGE, 2, 3, 180);

    expect(result.width).toBe(2);
    expect(result.height).toBe(3);
    expect(grid(result.pixels, 2, 3)).toEqual([
      [6, 5],
      [4, 3],
      [2, 1],
    ]);
  });

  it("rotates 270° clockwise and swaps the dimensions", () => {
    const result = rotateRgba(IMAGE, 2, 3, 270);

    expect(result.width).toBe(3);
    expect(result.height).toBe(2);
    expect(grid(result.pixels, 3, 2)).toEqual([
      [2, 4, 6],
      [1, 3, 5],
    ]);
  });

  it("preserves every pixel — nothing is stretched or dropped", () => {
    for (const rotation of [90, 180, 270] as const) {
      const result = rotateRgba(IMAGE, 2, 3, rotation);
      expect(result.pixels.length).toBe(IMAGE.length);
      expect(result.width * result.height).toBe(6);

      const markers = [...result.pixels.filter((_, index) => index % 4 === 0)].sort();
      expect(markers).toEqual([1, 2, 3, 4, 5, 6]);
    }
  });

  it("returns to the original after four 90° turns", () => {
    let current: RotatedPixels = { width: 2, height: 3, pixels: IMAGE };
    for (let i = 0; i < 4; i += 1) {
      current = rotateRgba(current.pixels, current.width, current.height, 90);
    }
    expect(current.width).toBe(2);
    expect(current.height).toBe(3);
    expect(Array.from(current.pixels)).toEqual(Array.from(IMAGE));
  });

  it("preserves the alpha channel", () => {
    // A horizontal pair turned clockwise becomes a vertical pair, left on top.
    const translucent = new Uint8Array([9, 9, 9, 128, 8, 8, 8, 64]);
    const result = rotateRgba(translucent, 2, 1, 90);

    expect(result.width).toBe(1);
    expect(result.height).toBe(2);
    expect(result.pixels[3]).toBe(128);
    expect(result.pixels[7]).toBe(64);
  });

  it("rejects a buffer that does not match the dimensions", () => {
    expect(() => rotateRgba(new Uint8Array(8), 2, 3, 90)).toThrowError(/expected 24/);
  });
});
