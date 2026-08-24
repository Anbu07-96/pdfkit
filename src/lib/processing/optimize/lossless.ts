import "server-only";

import { PDFArray, PDFDict, PDFName, PDFRawStream, PDFDocument } from "pdf-lib";
import { zlibSync, unzlibSync } from "fflate";

/**
 * Lossless PDF optimisation with pdf-lib + fflate.
 *
 * Two things happen here, and both are provably lossless:
 *
 * 1. **Structure** — the document is re-saved with PDF 1.5 object streams and a
 *    cross-reference *stream* (`useObjectStreams`), which packs the many small
 *    dictionary objects a classic PDF writes one-per-line into compressed
 *    containers. Documents saved the classic way often shrink dramatically.
 *    Document metadata (the XMP stream and the Info entries such as Title and
 *    Author) is dropped: it is information, not quality, and compressors
 *    conventionally remove it.
 *
 * 2. **Streams** (levels `medium` and `high`) — every indirect stream that is
 *    either uncompressed (`/Filter` absent) or compressed with a single
 *    `/FlateDecode` is re-deflated at maximum effort. A stream is only
 *    replaced when the re-encoded bytes are strictly smaller, and the
 *    deflated representation is swapped for another deflated representation of
 *    the *same* decompressed bytes, so readers decode exactly what they
 *    decoded before. Streams are deliberately **not** touched when:
 *    - they use image codecs (`/DCTDecode`, `/JPXDecode`, `/CCITTFaxDecode`,
 *      `/JBIG2Decode`) — re-encoding images is a lossy, separate concern,
 *    - they carry predictor parameters (`/DecodeParms` with `/Predictor > 1`),
 *      where a mistake could corrupt image samples,
 *    - they are cross-reference or object streams, which pdf-lib regenerates
 *      while saving anyway,
 *    - they use any other filter chain (LZW, ASCII, …) or cannot be decoded —
 *      they are left byte-for-byte intact rather than risk damage.
 *
 * No filesystem, no external services: bytes in, bytes out.
 */

/** Deflate effort used when re-compressing streams (fflate maximum). */
export const DEFLATE_LEVEL = 9;

/** Strip the XMP metadata stream and every optional Info entry. */
export function stripDocumentMetadata(document: PDFDocument): void {
  // XMP metadata lives as a stream referenced from the catalog.
  document.catalog.delete(PDFName.of("Metadata"));

  // The Info dictionary carries title, author, subject, keywords, dates and
  // producer-tool entries. pdf-lib re-stamps Producer/Creator/dates on save,
  // so everything here is dropped and only those remain.
  const info = document.context.lookup(document.context.trailerInfo.Info);
  if (info instanceof PDFDict) {
    for (const [key] of info.entries()) info.delete(key);
  }

  document.setCreator("PDFKit");
}

/** True when the dict's `/DecodeParms` carry a predictor (`/Predictor > 1`). */
function hasPredictorParms(dict: PDFDict): boolean {
  const check = (parms: unknown): boolean => {
    if (!(parms instanceof PDFDict)) return false;
    const predictor = parms.lookup(PDFName.of("Predictor"));
    if (predictor === undefined) return false;
    return predictor.toString() !== "/1";
  };

  const parms = dict.lookup(PDFName.of("DecodeParms"));
  if (parms instanceof PDFArray) {
    for (let index = 0; index < parms.size(); index += 1) {
      if (check(parms.lookup(index))) return true;
    }
    return false;
  }
  return check(parms);
}

export interface LosslessOptions {
  /**
   * Re-compress stream contents (levels `medium`/`high`). When false, only the
   * structural work above happens (level `low`).
   */
  recompressStreams: boolean;
}

export interface LosslessReport {
  /** Number of streams whose encoded bytes were replaced. */
  streamsRewritten: number;
  /** Encoded bytes saved inside streams (before structural savings). */
  streamBytesSaved: number;
}

/**
 * Optimise the loaded document in place. Returns immediately when streams
 * should not be touched; every stream is handled independently and any decode
 * or encode failure leaves that stream exactly as it was.
 */
export function optimiseDocumentLosslessly(
  document: PDFDocument,
  { recompressStreams }: LosslessOptions,
): LosslessReport {
  stripDocumentMetadata(document);

  const report: LosslessReport = {
    streamsRewritten: 0,
    streamBytesSaved: 0,
  };

  if (!recompressStreams) return report;

  for (const [ref, object] of document.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue;

    const dict = object.dict;
    const type = dict.lookup(PDFName.of("Type"))?.toString();
    // pdf-lib writes fresh cross-reference and object streams while saving;
    // the loaded ones are transient and never worth touching.
    if (type === "/XRef" || type === "/ObjStm") continue;

    // Predictor parameters describe post-inflate processing; although the
    // transform below would keep them valid, staying away from predictor
    // streams entirely removes any chance of corrupting image samples.
    if (hasPredictorParms(dict)) continue;

    const filter = dict.lookup(PDFName.of("Filter"));

    try {
      let replacement: Uint8Array | undefined;

      if (filter === undefined) {
        // Uncompressed: wrap the raw bytes in a zlib container.
        if (dict.lookup(PDFName.of("DecodeParms")) === undefined) {
          const packed = zlibSync(object.contents, { level: DEFLATE_LEVEL });
          if (packed.length < object.contents.length) replacement = packed;
          if (replacement) {
            dict.set(PDFName.of("Filter"), PDFName.of("FlateDecode"));
          }
        }
      } else if (
        filter instanceof PDFName &&
        filter.asString() === "/FlateDecode"
      ) {
        // Already deflated: re-deflate the same decompressed bytes with more
        // effort. Only ever replaced when strictly smaller.
        const decoded = unzlibSync(object.contents);
        const packed = zlibSync(decoded, { level: DEFLATE_LEVEL });
        if (packed.length < object.contents.length) replacement = packed;
      }

      if (replacement) {
        report.streamBytesSaved += object.contents.length - replacement.length;
        // `/Length` is recomputed from the contents by pdf-lib on save.
        document.context.assign(ref, PDFRawStream.of(dict, replacement));
        report.streamsRewritten += 1;
      }
    } catch {
      // Undecodable or unencodable: keep the original stream untouched.
    }
  }

  return report;
}

/**
 * Does the document contain image XObjects at all?
 *
 * Used to decide whether the lossy rasterisation pass is worth attempting: a
 * document without a single image object cannot shrink by rasterising, so the
 * expensive attempt is skipped. Inline images (rare, embedded directly in
 * content streams) are not detected — at worst the pass is skipped for such a
 * document and the lossless result is returned instead.
 */
export function hasImageObjects(document: PDFDocument): boolean {
  for (const [, object] of document.context.enumerateIndirectObjects()) {
    if (object instanceof PDFRawStream) {
      const subtype = object.dict.lookup(PDFName.of("Subtype"))?.toString();
      if (subtype === "/Image") return true;
    }
    if (object instanceof PDFDict) {
      const subtype = object.lookup(PDFName.of("Subtype"))?.toString();
      if (subtype === "/Image") return true;
    }
  }
  return false;
}
