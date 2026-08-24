// @vitest-environment node
import { EncryptedPDFError, PDFDocument } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import { rasterizePdfForCompression } from "@/lib/processing/optimize/rasterize";

// Wrap the rasteriser in a spy that delegates to the real implementation, so
// one test can simulate a crash without changing behaviour for the others.
vi.mock("@/lib/processing/optimize/rasterize", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/lib/processing/optimize/rasterize")
  >();
  return {
    ...actual,
    rasterizePdfForCompression: vi.fn(actual.rasterizePdfForCompression),
  };
});
import type { ProcessingInputFile } from "@/lib/processing/contract";
import { computeCompressionStats } from "@/lib/processing/compression";
import { ProcessingError } from "@/lib/processing/errors";
import { compressPdfProcessor } from "@/lib/processing/processors/compress-pdf";
import { DEFAULT_PROCESSING_LIMITS } from "@/lib/processing/limits";
import { runProcessingJob } from "@/lib/processing/service";
import {
  makeBrokenPdf,
  makeNonPdf,
  makeNumberedPdf,
  makeScannedPdf,
  makeUncompressedPdf,
  pageWidths,
} from "@/test/pdf-fixtures";

const CONTEXT = { limits: { ...DEFAULT_PROCESSING_LIMITS } };

async function inputFile(
  name: string,
  bytes: Uint8Array,
  mimeType = "application/pdf",
): Promise<ProcessingInputFile> {
  return {
    id: "input-1",
    name,
    size: bytes.length,
    mimeType,
    bytes,
  };
}

async function compress(
  file: ProcessingInputFile,
  level?: string,
  limits = CONTEXT.limits,
) {
  return compressPdfProcessor.process(
    { toolId: "compress-pdf", files: [file], options: { level } },
    { limits },
  );
}

async function expectFailure(promise: Promise<unknown>, code: string) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ProcessingError);
    expect((error as ProcessingError).code).toBe(code);
    return error as ProcessingError;
  }
  throw new Error(`Expected a ${code} ProcessingError, but the call succeeded.`);
}

/** Which source pages a document holds, in order (fixture geometry). */
async function sourcePagesOf(bytes: Uint8Array): Promise<number[]> {
  const document = await PDFDocument.load(bytes);
  return pageWidths(document).map((width) => width - 100);
}

const statsOf = (result: { meta?: Record<string, number | string> }) =>
  computeCompressionStats({
    originalBytes: result.meta!.originalBytes as number,
    outputBytes: result.meta!.outputBytes as number,
    compressionLevel: result.meta!.compressionLevel as "low" | "medium" | "high",
    strategy: result.meta!.strategy as "lossless" | "rasterized" | "original",
  });

describe("CompressPdfProcessor", () => {
  it("declares the tool id and single-file input rules", () => {
    expect(compressPdfProcessor.toolId).toBe("compress-pdf");
    expect(compressPdfProcessor.input.minFiles).toBe(1);
    expect(compressPdfProcessor.input.maxFiles).toBe(1);
    expect(compressPdfProcessor.input.extensions).toEqual([".pdf"]);
    expect(compressPdfProcessor.input.mimeTypes).toEqual(["application/pdf"]);
  });

  it.each(["low", "medium", "high"] as const)(
    "returns a valid, smaller PDF for a bloated document at %s",
    async (level) => {
      const file = await inputFile("document.pdf", makeUncompressedPdf(5));

      const result = await compress(file, level);
      const artifact = result.artifacts[0];

      expect(artifact.name).toBe("document-compressed.pdf");
      expect(artifact.mimeType).toBe("application/pdf");
      expect(new TextDecoder().decode(artifact.bytes.slice(0, 5))).toBe("%PDF-");
      expect(artifact.size).toBe(artifact.bytes.length);

      // The whole point: the output must actually be smaller.
      expect(artifact.bytes.length).toBeLessThan(file.bytes.length);
      expect(result.meta?.reduced).toBe("yes");

      // Page count, identity and order survive.
      expect(await sourcePagesOf(artifact.bytes)).toEqual([1, 2, 3, 4, 5]);
      expect(result.meta?.pages).toBe(5);
      expect(result.meta?.outputPages).toBe(5);
      expect(result.meta?.compressionLevel).toBe(level);
    },
  );

  it("defaults the level to medium when omitted", async () => {
    const result = await compress(await inputFile("a.pdf", makeUncompressedPdf(2)));
    expect(result.meta?.compressionLevel).toBe("medium");
  });

  it("treats an empty level string as omitted", async () => {
    const result = await compress(await inputFile("a.pdf", makeUncompressedPdf(2)), "");
    expect(result.meta?.compressionLevel).toBe("medium");
  });

  it("rejects an invalid compression level", async () => {
    const error = await expectFailure(
      compress(await inputFile("a.pdf", makeUncompressedPdf(2)), "ultra"),
      "VALIDATION_ERROR",
    );
    expect(error.status).toBe(400);
  });

  it("statistics are mathematically exact", async () => {
    const file = await inputFile("a.pdf", makeUncompressedPdf(5));
    const result = await compress(file, "medium");
    const artifact = result.artifacts[0];

    const stats = statsOf(result);
    expect(stats.originalBytes).toBe(file.bytes.length);
    expect(stats.outputBytes).toBe(artifact.bytes.length);
    expect(stats.bytesSaved).toBe(file.bytes.length - artifact.bytes.length);
    expect(stats.reductionPercent).toBe(
      Math.round(
        ((file.bytes.length - artifact.bytes.length) / file.bytes.length) *
          1000,
      ) / 10,
    );
    expect(stats.wasReduced).toBe(true);
  });

  it("uses rasterisation at high for scanned-style documents", async () => {
    // JPEG pages at twice the raster resolution: rasterising wins clearly.
    const file = await inputFile("scan.pdf", await makeScannedPdf(2, 600, 800));
    const result = await compress(file, "high");

    expect(result.meta?.strategy).toBe("rasterized");
    expect(result.meta?.reduced).toBe("yes");
    expect(result.artifacts[0].bytes.length).toBeLessThan(file.bytes.length);

    const document = await PDFDocument.load(result.artifacts[0].bytes);
    expect(document.getPageCount()).toBe(2);
  });

  it("keeps high lossless when the document has no images", async () => {
    const file = await inputFile("text.pdf", await makeNumberedPdf(3));
    const result = await compress(file, "high");

    expect(result.meta?.rasterSkipped).toBe("no-images");
    expect(result.meta?.strategy).not.toBe("rasterized");
  });

  it("keeps high lossless above the raster page limit", async () => {
    const file = await inputFile("scan.pdf", await makeScannedPdf(2, 80, 100));
    const result = await compress(file, "high", {
      ...CONTEXT.limits,
      maxCompressRasterPages: 1,
    });

    expect(result.meta?.rasterSkipped).toBe("too-many-pages");
    expect(result.meta?.strategy).not.toBe("rasterized");
  });

  it("never returns a larger file as compressed", async () => {
    // A minimal, already-optimal document: if every pass produces something
    // equal or larger, the original bytes must come back, unclaimed.
    const document = await PDFDocument.create();
    document.addPage([100, 100]);
    const bytes = await document.save({ useObjectStreams: true });
    const file = await inputFile("tiny.pdf", bytes);

    const result = await compress(file, "medium");
    const artifact = result.artifacts[0];

    if (result.meta?.reduced === "no") {
      expect(artifact.bytes.length).toBe(file.bytes.length);
      expect([...artifact.bytes]).toEqual([...file.bytes]);
      expect(result.meta?.strategy).toBe("original");
      expect(result.meta?.bytesSaved).toBe(0);
      expect(result.meta?.reductionPercent).toBe(0);
    } else {
      expect(artifact.bytes.length).toBeLessThan(file.bytes.length);
    }
  });

  it("reports honestly when nothing helps (second pass on our own output)", async () => {
    // Compressing twice: the second run sees an already-optimised file, and
    // must not claim savings it did not make.
    const first = await compress(
      await inputFile("a.pdf", makeUncompressedPdf(4)),
      "medium",
    );
    const second = await compress(
      await inputFile("a.pdf", first.artifacts[0].bytes),
      "medium",
    );

    const stats = statsOf(second);
    if (stats.wasReduced) {
      expect(second.artifacts[0].bytes.length).toBeLessThan(
        first.artifacts[0].bytes.length,
      );
    } else {
      expect(second.meta?.strategy).toBe("original");
      expect(second.meta?.bytesSaved).toBe(0);
      expect([...second.artifacts[0].bytes]).toEqual([...first.artifacts[0].bytes]);
    }
  });

  // Input-rule rejections happen in the service layer before the processor
  // runs; these go through the real pipeline, exactly as requests do.
  async function runJob(
    files: ProcessingInputFile[],
    level?: string,
  ) {
    return runProcessingJob(
      { toolId: "compress-pdf", files, options: { level } },
      { limits: CONTEXT.limits },
    );
  }

  it("rejects an empty file", async () => {
    const result = await runJob([await inputFile("empty.pdf", new Uint8Array(0))]);
    expect(result.status).toBe("failed");
    expect(result.status === "failed" && result.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a non-PDF", async () => {
    const result = await runJob([
      await inputFile("document.txt", makeNonPdf(), "text/plain"),
    ]);
    expect(result.status).toBe("failed");
    expect(result.status === "failed" && result.error.code).toBe("UNSUPPORTED_FILE");
  });

  it("rejects an empty signature-less upload the processor would choke on", async () => {
    const result = await runJob([await inputFile("zero.pdf", new Uint8Array(0))]);
    expect(result.status === "failed" && result.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a disguised non-PDF", async () => {
    const bytes = makeNonPdf();
    const error = await expectFailure(
      compress(await inputFile("document.pdf", bytes), "medium"),
      "INVALID_PDF",
    );
    expect(error.status).toBe(422);
  });

  it("rejects a malformed PDF", async () => {
    await expectFailure(
      compress(await inputFile("broken.pdf", makeBrokenPdf()), "medium"),
      "INVALID_PDF",
    );
  });

  it("rejects an encrypted PDF", async () => {
    const spy = vi
      .spyOn(PDFDocument, "load")
      .mockRejectedValueOnce(new EncryptedPDFError());
    try {
      const error = await expectFailure(
        compress(await inputFile("locked.pdf", await makeNumberedPdf(2)), "high"),
        "ENCRYPTED_PDF",
      );
      expect(error.status).toBe(422);
    } finally {
      spy.mockRestore();
    }
  });

  it("requires exactly one file", async () => {
    const bytes = await makeNumberedPdf(2);
    const result = await runJob([
      await inputFile("a.pdf", bytes),
      await inputFile("b.pdf", bytes),
    ]);
    expect(result.status).toBe("failed");
    expect(result.status === "failed" && result.error.code).toBe("TOO_MANY_FILES");
  });

  it("does not mutate the input bytes", async () => {
    const original = makeUncompressedPdf(3);
    const snapshot = new Uint8Array(original);
    await compress(await inputFile("a.pdf", original), "high");
    expect([...original]).toEqual([...snapshot]);
  });

  it("falls back to the lossless result when rasterisation fails", async () => {
    // A document WITH images (so the raster pass is attempted) whose
    // rasterisation is made to fail: the valid lossless output must win.
    const file = await inputFile("scan.pdf", await makeScannedPdf(1, 120, 150));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.mocked(rasterizePdfForCompression).mockRejectedValueOnce(
      new Error("wasm exploded"),
    );

    try {
      const result = await compress(file, "high");
      expect(result.meta?.rasterSkipped).toBe("failed");
      expect(result.meta?.strategy).not.toBe("rasterized");
      expect(new TextDecoder().decode(result.artifacts[0].bytes.slice(0, 5))).toBe(
        "%PDF-",
      );
      // The failure is logged server-side, never silently swallowed.
      expect(warn).toHaveBeenCalled();
    } finally {
      vi.mocked(rasterizePdfForCompression).mockRestore();
      warn.mockRestore();
    }
  });
});
