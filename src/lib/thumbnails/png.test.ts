// @vitest-environment node
import { describe, expect, it } from "vitest";
import { encodePng, readPngHeader } from "@/lib/thumbnails/png";
import { decodePng } from "@/test/png-decode";

function solid(width: number, height: number, rgba: [number, number, number, number]) {
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) pixels.set(rgba, i * 4);
  return pixels;
}

describe("encodePng", () => {
  it("writes a valid PNG with the expected chunk order", () => {
    const png = encodePng({ width: 4, height: 3, pixels: solid(4, 3, [10, 20, 30, 255]) });
    const decoded = decodePng(png);

    expect(decoded.chunks).toEqual(["IHDR", "IDAT", "IEND"]);
    expect(decoded.width).toBe(4);
    expect(decoded.height).toBe(3);
    expect(decoded.bitDepth).toBe(8);
    expect(decoded.colorType).toBe(6); // RGBA
  });

  it("round-trips pixels exactly", () => {
    const pixels = new Uint8Array([
      255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 0,
    ]);
    const png = encodePng({ width: 2, height: 2, pixels });
    expect(decodePng(png).pixels).toEqual(pixels);
  });

  it("starts with the PNG signature", () => {
    const png = encodePng({ width: 1, height: 1, pixels: solid(1, 1, [1, 2, 3, 4]) });
    expect(Array.from(png.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });

  it("compresses large flat areas", () => {
    const png = encodePng({
      width: 200,
      height: 200,
      pixels: solid(200, 200, [255, 255, 255, 255]),
    });
    expect(png.length).toBeLessThan(200 * 200 * 4);
    expect(png.length).toBeGreaterThan(0);
  });

  it("rejects a pixel buffer of the wrong size", () => {
    expect(() =>
      encodePng({ width: 2, height: 2, pixels: new Uint8Array(4) }),
    ).toThrowError(/expected 16/);
  });

  it("rejects invalid dimensions", () => {
    expect(() => encodePng({ width: 0, height: 1, pixels: new Uint8Array() })).toThrowError(
      /positive integers/,
    );
    expect(() =>
      encodePng({ width: 1.5, height: 1, pixels: new Uint8Array(6) }),
    ).toThrowError(/positive integers/);
  });
});

describe("readPngHeader", () => {
  it("returns null for data that is not a PNG", () => {
    expect(readPngHeader(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(readPngHeader(new Uint8Array(40))).toBeNull();
  });
});
