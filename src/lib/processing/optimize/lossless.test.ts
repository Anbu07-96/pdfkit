// @vitest-environment node
import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
} from "pdf-lib";
import { describe, expect, it } from "vitest";
import {
  hasImageObjects,
  optimiseDocumentLosslessly,
} from "@/lib/processing/optimize/lossless";
import { makeNumberedPdf, makeScannedPdf, makeUncompressedPdf } from "@/test/pdf-fixtures";

/**
 * A stable signature of every decodable stream's *decoded* bytes, so tests can
 * prove the optimiser is lossless: the same content must decode identically
 * before and after, whatever happened to the encoded representation.
 */
async function decodedStreamSignature(bytes: Uint8Array): Promise<string[]> {
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  const signatures: string[] = [];

  for (const [, object] of document.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue;
    const type = object.dict.lookup(PDFName.of("Type"))?.toString();
    if (type === "/XRef" || type === "/ObjStm") continue;

    try {
      const decoded = decodePDFRawStream(object).decode();
      let h1 = 0xdeadbeef;
      let h2 = 0x41c6ce57;
      for (let index = 0; index < decoded.length; index += 1) {
        h1 = Math.imul(h1 ^ decoded[index], 2654435761);
        h2 = Math.imul(h2 ^ decoded[index], 1597334677);
      }
      signatures.push(
        `${type ?? "?"}:${decoded.length}:${(h1 >>> 0).toString(16)}-${(h2 >>> 0).toString(16)}`,
      );
    } catch {
      // Image codecs (DCTDecode) are not decodable here; their streams must
      // survive untouched, which the encoded-bytes test below covers.
      signatures.push(
        `${type ?? "?"}:raw:${object.contents.length}:${object.contents[0] ?? -1}`,
      );
    }
  }

  return signatures.sort();
}

/** Encoded stream contents by position — image bytes must not change at all. */
async function rawImageStreams(
  bytes: Uint8Array,
): Promise<{ filters: string; length: number; first: number }[]> {
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  const streams: { filters: string; length: number; first: number }[] = [];
  for (const [, object] of document.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue;
    if (object.dict.lookup(PDFName.of("Subtype"))?.toString() !== "/Image") continue;
    const filter = object.dict.lookup(PDFName.of("Filter"));
    const filters =
      filter instanceof PDFName
        ? filter.asString()
        : filter instanceof PDFArray
          ? filter.toString()
          : "(none)";
    streams.push({
      filters,
      length: object.contents.length,
      first: object.contents[0] ?? -1,
    });
  }
  return streams.sort((a, b) => a.length - b.length);
}

async function optimisedCopy(
  bytes: Uint8Array,
  recompressStreams: boolean,
): Promise<Uint8Array> {
  const document = await PDFDocument.load(bytes, {
    updateMetadata: false,
    ignoreEncryption: false,
  });
  optimiseDocumentLosslessly(document, { recompressStreams });
  return document.save({ useObjectStreams: true });
}

describe("optimiseDocumentLosslessly", () => {
  it("shrinks a classic uncompressed PDF and keeps it valid", async () => {
    const original = makeUncompressedPdf(4);
    const optimised = await optimisedCopy(original, true);

    expect(optimised.length).toBeLessThan(original.length);

    const reloaded = await PDFDocument.load(optimised);
    expect(reloaded.getPageCount()).toBe(4);
    expect(reloaded.getPages().map((page) => page.getSize().width)).toEqual([
      101, 102, 103, 104,
    ]);
  });

  it("is lossless: every stream decodes to identical bytes", async () => {
    // An uncompressed fixture (streams get re-written) and a flate fixture
    // (streams may be re-deflated) must both decode identically afterwards.
    for (const original of [
      makeUncompressedPdf(3),
      await makeNumberedPdf(3),
    ]) {
      const before = await decodedStreamSignature(original);
      const optimised = await optimisedCopy(original, true);
      const after = await decodedStreamSignature(optimised);
      expect(after).toEqual(before);
    }
  });

  it("compresses streams only when recompression is enabled", async () => {
    const original = makeUncompressedPdf(4);

    const structural = await optimisedCopy(original, false);
    const withStreams = await optimisedCopy(original, true);

    // The structural pass alone already helps (object streams), and the
    // stream pass must help further on uncompressed content.
    expect(structural.length).toBeLessThan(original.length);
    expect(withStreams.length).toBeLessThan(structural.length);

    // Without stream recompression the content streams stay uncompressed.
    const document = await PDFDocument.load(structural, { updateMetadata: false });
    const contentFilters = new Set<string>();
    for (const [, object] of document.context.enumerateIndirectObjects()) {
      if (!(object instanceof PDFRawStream)) continue;
      const filter = object.dict.lookup(PDFName.of("Filter"));
      if (object.dict.lookup(PDFName.of("Type")) === undefined && !filter) {
        contentFilters.add("(none)");
      }
    }
    expect(contentFilters.has("(none)")).toBe(true);
  });

  it("rewrites the /Length of replaced streams correctly", async () => {
    const optimised = await optimisedCopy(makeUncompressedPdf(2), true);
    const document = await PDFDocument.load(optimised, { updateMetadata: false });

    for (const [, object] of document.context.enumerateIndirectObjects()) {
      if (!(object instanceof PDFRawStream)) continue;
      if (object.dict.lookup(PDFName.of("Type"))?.toString() === "/XRef") continue;
      const length = object.dict.lookup(PDFName.of("Length"));
      expect(Number(length?.toString())).toBe(object.contents.length);
    }
  });

  it("never touches image streams", async () => {
    const original = await makeScannedPdf(2, 200, 260);
    const before = await rawImageStreams(original);
    expect(before.length).toBe(2); // sanity: the fixture has JPEG images

    const optimised = await optimisedCopy(original, true);
    const after = await rawImageStreams(optimised);

    expect(after).toEqual(before);
  });

  it("removes document metadata", async () => {
    const document = await PDFDocument.create();
    const font = await document.embedFont("Helvetica");
    document.addPage([200, 200]).drawText("secret project name", {
      x: 10,
      y: 100,
      size: 12,
      font,
    });
    document.setTitle("Confidential title");
    document.setAuthor("Test Author");
    document.setSubject("Test subject");
    document.setKeywords(["secret", "keywords"]);
    const original = await document.save();

    const reloaded = await PDFDocument.load(original, { updateMetadata: false });
    optimiseDocumentLosslessly(reloaded, { recompressStreams: false });
    const optimised = await reloaded.save();

    const checked = await PDFDocument.load(optimised);
    expect(checked.getTitle()).toBeUndefined();
    expect(checked.getAuthor()).toBeUndefined();
    expect(checked.getSubject()).toBeUndefined();
    expect(checked.getKeywords()).toBeUndefined();
    // The text content itself is untouched — metadata is not content.
    expect(checked.getPageCount()).toBe(1);
  });

  it("skips predictor parameters and leaves those streams intact", async () => {
    // Build a document with a FlateDecode stream that carries predictor
    // parameters; it must survive the optimiser untouched.
    const { zlibSync } = await import("fflate");
    const document = await PDFDocument.create();
    const payload = new TextEncoder().encode("predictor stream payload ".repeat(8));
    const encoded = zlibSync(payload, { level: 9 });
    const stream = document.context.stream(encoded, {
      Filter: "FlateDecode",
      DecodeParms: { Predictor: 12, Columns: 4, Colors: 3, BitsPerComponent: 8 },
      Type: "XObject",
      Subtype: "Form",
      BBox: [0, 0, 10, 10],
    });
    const ref = document.context.register(stream);
    document.catalog.set(PDFName.of("AcroForm"), ref);

    const original = await document.save();
    const optimised = await optimisedCopy(original, true);
    const reloaded = await PDFDocument.load(optimised, { updateMetadata: false });

    const formRef = reloaded.catalog.get(PDFName.of("AcroForm"));
    const form = reloaded.context.lookup(formRef);
    expect(form).toBeInstanceOf(PDFRawStream);
    const formStream = form as PDFRawStream;
    // Same encoded bytes — the stream was skipped, not rewritten.
    expect(formStream.contents.length).toBe(encoded.length);
    expect([...formStream.contents]).toEqual([...encoded]);
    expect(
      formStream.dict.lookup(PDFName.of("DecodeParms")),
    ).toBeInstanceOf(PDFDict);
    expect(decodePDFRawStream(formStream).decode()).toEqual(
      new Uint8Array(payload),
    );
  });

  it("does not mutate the input bytes it read from", async () => {
    const original = makeUncompressedPdf(2);
    const snapshot = new Uint8Array(original);

    const document = await PDFDocument.load(original, { updateMetadata: false });
    optimiseDocumentLosslessly(document, { recompressStreams: true });
    await document.save({ useObjectStreams: true });

    expect([...original]).toEqual([...snapshot]);
  });
});

describe("hasImageObjects", () => {
  it("finds images in a scanned-style document", async () => {
    const document = await PDFDocument.load(await makeScannedPdf(1, 80, 100));
    expect(hasImageObjects(document)).toBe(true);
  });

  it("reports text-only documents as image-free", async () => {
    const document = await PDFDocument.load(await makeNumberedPdf(2));
    expect(hasImageObjects(document)).toBe(false);
  });
});
