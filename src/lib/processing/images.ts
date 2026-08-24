import "server-only";

/**
 * Image inspection for the Images → PDF conversion.
 *
 * Everything here works on the raw bytes only — no decoding, no allocation
 * proportional to pixel count — so oversized or hostile images can be rejected
 * before pdf-lib tries to embed them. The signature check itself lives with
 * the shared input validation (`validation/pdf-input.ts`); this module answers
 * the follow-up questions: which kind is it really, and how big is it?
 */

export type ImageKind = "jpeg" | "png";

/** `FF D8 FF` — every JPEG starts with these three bytes. */
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff] as const;
/** The eight-byte PNG header. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

/**
 * Hard caps on input image geometry, enforced before any embedding happens.
 * They bound the memory an image can make pdf-lib allocate (an image is
 * decoded into raw pixels while embedding) while staying far above anything a
 * camera or screenshot produces: 24 megapixels and 12 000 px per side.
 */
export const MAX_IMAGE_PIXELS = 24_000_000;
export const MAX_IMAGE_SIDE_PX = 12_000;

/** PDF user space is limited to 14 400 × 14 400 points per page. */
export const MAX_PAGE_POINTS = 14_400;

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  for (let index = 0; index < signature.length; index += 1) {
    if (bytes[index] !== signature[index]) return false;
  }
  return true;
}

/** Which image kind the bytes really are, by signature. `null` if neither. */
export function detectImageKind(bytes: Uint8Array): ImageKind | null {
  if (startsWith(bytes, JPEG_SIGNATURE)) return "jpeg";
  if (startsWith(bytes, PNG_SIGNATURE)) return "png";
  return null;
}

/** Frame headers that carry the image dimensions (SOF0-SOF15 minus DHT/JPG/DAC). */
function isStartOfFrame(marker: number): boolean {
  return (
    marker >= 0xffc0 &&
    marker <= 0xffcf &&
    marker !== 0xffc4 && // DHT
    marker !== 0xffc8 && // JPG
    marker !== 0xffcc // DAC
  );
}

export interface ImageSize {
  width: number;
  height: number;
}

/**
 * Read the pixel dimensions straight out of the headers.
 *
 * PNG keeps them in the fixed-position IHDR chunk; JPEG requires a short
 * marker walk to the first frame header. Returns `null` when the header is
 * truncated or the dimensions cannot be found — the caller rejects the file
 * rather than guessing.
 */
export function readImageSize(bytes: Uint8Array, kind: ImageKind): ImageSize | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  try {
    if (kind === "png") {
      // signature (8) + length (4) + "IHDR" (4) → width at offset 16.
      if (bytes.length < 24) return null;
      const width = view.getUint32(16);
      const height = view.getUint32(20);
      if (width === 0 || height === 0) return null;
      return { width, height };
    }

    // JPEG: walk the marker segments to the first SOF.
    let position = 2;
    while (position + 9 < bytes.length) {
      // Tolerate fill bytes between markers.
      if (view.getUint8(position) !== 0xff) {
        position += 1;
        continue;
      }
      const marker = view.getUint16(position);
      position += 2;

      if (isStartOfFrame(marker)) {
        const height = view.getUint16(position + 3);
        const width = view.getUint16(position + 5);
        if (width === 0 || height === 0) return null;
        return { width, height };
      }

      // Standalone markers without a length payload.
      if (marker === 0xffd8 || (marker >= 0xffd0 && marker <= 0xffd7)) continue;
      if (position + 2 > bytes.length) return null;
      position += view.getUint16(position);
    }
    return null;
  } catch {
    return null;
  }
}

export interface InspectedImage {
  kind: ImageKind;
  width: number;
  height: number;
}

/**
 * Inspect an uploaded image: real kind by signature plus header dimensions,
 * validated against the pixel caps.
 *
 * Returns a rejection reason (for the caller to turn into an `INVALID_IMAGE`
 * error naming the file) or the inspected image.
 */
export function inspectImage(
  name: string,
  bytes: Uint8Array,
): { image: InspectedImage } | { reason: string } {
  const kind = detectImageKind(bytes);
  if (!kind) {
    return { reason: `${name} is not a JPEG or PNG image.` };
  }

  const size = readImageSize(bytes, kind);
  if (!size) {
    return {
      reason: `${name} has no readable image dimensions — the file may be damaged.`,
    };
  }

  const { width, height } = size;
  if (width > MAX_IMAGE_SIDE_PX || height > MAX_IMAGE_SIDE_PX) {
    return {
      reason: `${name} is ${width}×${height} px; each side must stay under ${MAX_IMAGE_SIDE_PX} px.`,
    };
  }
  if (width * height > MAX_IMAGE_PIXELS) {
    return {
      reason: `${name} is ${width}×${height} px (${(width * height / 1_000_000).toFixed(1)} megapixels); the limit is ${MAX_IMAGE_PIXELS / 1_000_000} MP.`,
    };
  }

  return { image: { kind, width, height } };
}

/**
 * Copy bytes into a fresh typed array whose `byteOffset` is 0.
 *
 * pdf-lib's JPEG scanner reads `imageData.buffer` from offset 0, ignoring the
 * view's own offset, so any pooled or subarrayed buffer (jpeg-js returns
 * pooled Node Buffers) must be copied first.
 */
export function freshBytes(data: Uint8Array): Uint8Array {
  const copy = new Uint8Array(data.length);
  copy.set(data);
  return copy;
}
