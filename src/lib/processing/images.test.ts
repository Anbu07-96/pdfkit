// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  detectImageKind,
  inspectImage,
  MAX_IMAGE_PIXELS,
  MAX_IMAGE_SIDE_PX,
  readImageSize,
} from "@/lib/processing/images";
import { makeJpeg, makeNonImage, makePng } from "@/test/pdf-fixtures";

describe("detectImageKind", () => {
  it("recognises real JPEG bytes", async () => {
    expect(detectImageKind(await makeJpeg(20, 10))).toBe("jpeg");
  });

  it("recognises real PNG bytes", async () => {
    expect(detectImageKind(await makePng(20, 10))).toBe("png");
  });

  it("rejects everything else", () => {
    expect(detectImageKind(makeNonImage())).toBeNull();
    expect(detectImageKind(new Uint8Array(0))).toBeNull();
    expect(detectImageKind(new TextEncoder().encode("%PDF-1.7 fake"))).toBeNull();
    // Near misses: right families, wrong bytes.
    expect(detectImageKind(new Uint8Array([0xff, 0xd8, 0x00, 1, 2, 3]))).toBeNull();
    expect(
      detectImageKind(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x00])),
    ).toBeNull();
  });
});

describe("readImageSize", () => {
  it("reads PNG dimensions from the IHDR chunk", async () => {
    expect(readImageSize(await makePng(123, 45), "png")).toEqual({
      width: 123,
      height: 45,
    });
  });

  it("reads JPEG dimensions from the frame header", async () => {
    expect(readImageSize(await makeJpeg(320, 200), "jpeg")).toEqual({
      width: 320,
      height: 200,
    });
  });

  it("reads a tall JPEG correctly", async () => {
    expect(readImageSize(await makeJpeg(40, 400), "jpeg")).toEqual({
      width: 40,
      height: 400,
    });
  });

  it("returns null for truncated headers", () => {
    expect(readImageSize(new Uint8Array([0xff, 0xd8, 0xff]), "jpeg")).toBeNull();
    expect(readImageSize(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), "png")).toBeNull();
  });
});

describe("inspectImage", () => {
  it("inspects a normal image without allocation", async () => {
    const result = inspectImage("photo.jpg", await makeJpeg(800, 600));
    expect(result).toEqual({ image: { kind: "jpeg", width: 800, height: 600 } });
  });

  it("rejects bytes that are neither JPEG nor PNG", () => {
    expect(inspectImage("x.jpg", makeNonImage())).toEqual({
      reason: expect.stringMatching(/not a JPEG or PNG/) as unknown,
    });
  });

  it("rejects unreadable dimensions", () => {
    const truncated = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    const result = inspectImage("cut.jpg", truncated);
    expect("reason" in result && result.reason).toMatch(/dimensions/i);
  });

  it("rejects images beyond the per-side cap", async () => {
    // Wider than the cap but under the megapixel cap: a genuine panorama.
    const wide = await makeJpeg(64, 8);
    const bytes = await replacePngLikeDimensions(wide, "jpeg", MAX_IMAGE_SIDE_PX + 1, 8);
    const result = inspectImage("wide.jpg", bytes);
    expect("reason" in result && result.reason).toMatch(/side must stay under/);
  });

  it("rejects images beyond the megapixel cap", async () => {
    const small = await makeJpeg(64, 64);
    const bytes = await replacePngLikeDimensions(
      small,
      "jpeg",
      6000,
      Math.ceil(MAX_IMAGE_PIXELS / 6000) + 1,
    );
    const result = inspectImage("huge.jpg", bytes);
    expect("reason" in result && result.reason).toMatch(/megapixels/);
  });
});

/**
 * Patch the dimension fields of a fixture without re-encoding: JPEG frame
 * headers carry width/height at fixed offsets from the SOF marker, so this
 * walks to the SOF (identical layout for every jpeg-js file) and rewrites
 * them. This keeps the header self-consistent while lying about the size.
 */
async function replacePngLikeDimensions(
  bytes: Uint8Array,
  kind: "jpeg" | "png",
  width: number,
  height: number,
): Promise<Uint8Array> {
  const copy = new Uint8Array(bytes);
  const view = new DataView(copy.buffer);

  if (kind === "png") {
    view.setUint32(16, width);
    view.setUint32(20, height);
    return copy;
  }

  let position = 2;
  while (position + 9 < copy.length) {
    if (view.getUint8(position) !== 0xff) {
      position += 1;
      continue;
    }
    const marker = view.getUint16(position);
    position += 2;
    const isSof =
      marker >= 0xffc0 && marker <= 0xffcf && marker !== 0xffc4 && marker !== 0xffc8 && marker !== 0xffcc;
    if (isSof) {
      view.setUint16(position + 3, height);
      view.setUint16(position + 5, width);
      return copy;
    }
    position += view.getUint16(position);
  }
  throw new Error("no SOF found in fixture");
}
