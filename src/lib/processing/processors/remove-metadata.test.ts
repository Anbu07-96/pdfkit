// @vitest-environment node
import { EncryptedPDFError, PDFDocument, PDFName, StandardFonts } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import type { ProcessingInputFile } from "@/lib/processing/contract";
import { ProcessingError } from "@/lib/processing/errors";
import { readDocumentMetadata } from "@/lib/processing/inspect";
import { removeMetadataProcessor } from "@/lib/processing/processors/remove-metadata";
import { runProcessingJob } from "@/lib/processing/service";
import {
  makeBrokenPdf,
  makeNumberedPdf,
  makeUncompressedPdf,
} from "@/test/pdf-fixtures";

async function input(name: string, bytes: Uint8Array): Promise<ProcessingInputFile> {
  return {
    id: "input-1",
    name,
    size: bytes.length,
    mimeType: "application/pdf",
    bytes,
  };
}

async function remove(file: ProcessingInputFile) {
  return removeMetadataProcessor.process({
    toolId: "remove-metadata",
    files: [file],
    options: {},
  });
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

/** A document with all five Info fields plus an XMP stream on the catalog. */
async function pdfWithEverything(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  document.addPage([200, 200]).drawText("content stays", { x: 10, y: 100, size: 12, font });
  document.setTitle("Sécret Tïtle 中文");
  document.setAuthor("Ana Ñúñez");
  document.setSubject("Private subject");
  document.setKeywords(["confidential, internal"]);
  document.setCreator("Spooky Authoring Tool");
  const xmp = document.context.stream(new TextEncoder().encode("<x:xmpmeta>private data</x:xmpmeta>"), {
    Type: "Metadata",
    Subtype: "XML",
  });
  document.catalog.set(PDFName.of("Metadata"), document.context.register(xmp));
  return document.save();
}

describe("RemoveMetadataProcessor", () => {
  it("declares the tool id and single-file input rules", () => {
    expect(removeMetadataProcessor.toolId).toBe("remove-metadata");
    expect(removeMetadataProcessor.input.minFiles).toBe(1);
    expect(removeMetadataProcessor.input.maxFiles).toBe(1);
    expect(removeMetadataProcessor.input.extensions).toEqual([".pdf"]);
  });

  it("removes every Info field and the XMP stream, and verifies it", async () => {
    const result = await remove(await input("doc.pdf", await pdfWithEverything()));

    const artifact = result.artifacts[0];
    expect(artifact.name).toBe("doc-metadata-removed.pdf");
    expect(artifact.mimeType).toBe("application/pdf");
    expect(new TextDecoder().decode(artifact.bytes.slice(0, 5))).toBe("%PDF-");

    // The verification promise: re-read the output independently.
    const reloaded = await PDFDocument.load(artifact.bytes);
    expect(reloaded.getTitle()).toBeUndefined();
    expect(reloaded.getAuthor()).toBeUndefined();
    expect(reloaded.getSubject()).toBeUndefined();
    expect(reloaded.getKeywords()).toBeUndefined();
    // Creator is emptied (pdf-lib re-stamps a deleted key with its default).
    expect(reloaded.getCreator()).toBe("");
    expect(reloaded.catalog.get(PDFName.of("Metadata"))).toBeUndefined();
    // The XMP bytes must not survive anywhere in the output.
    expect(new TextDecoder().decode(artifact.bytes).includes("private data")).toBe(
      false,
    );

    expect(result.meta).toMatchObject({
      pages: 1,
      outputPages: 1,
      removedFields: 5,
      xmpRemoved: "yes",
      verification: "verified",
      creatorEmptied: "yes",
      producerStamped: "yes",
    });
  });

  it("preserves page count, order, dimensions and content exactly", async () => {
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);
    for (let page = 1; page <= 4; page += 1) {
      const created = document.addPage([100 + page, 200]);
      created.drawText(`page ${page}`, { x: 10, y: 100, size: 10, font });
    }
    document.setTitle("will be removed");
    const bytes = await document.save();

    const result = await remove(await input("keep.pdf", bytes));
    const reloaded = await PDFDocument.load(result.artifacts[0].bytes);
    expect(reloaded.getPageCount()).toBe(4);
    expect(reloaded.getPages().map((page) => Math.round(page.getSize().width))).toEqual(
      [101, 102, 103, 104],
    );
    // Text content is untouched (not rasterised, not rebuilt).
    expect(reloaded.getPage(1).getSize().height).toBe(200);
  });

  it("handles unicode metadata removal", async () => {
    const result = await remove(await input("u.pdf", await pdfWithEverything()));
    const metadata = readDocumentMetadata(
      await PDFDocument.load(result.artifacts[0].bytes),
    );
    expect(metadata.title).toBeNull();
    expect(metadata.author).toBeNull();
    expect(metadata.keywords).toBeNull();
  });

  it("reports honestly when nothing was there to remove", async () => {
    // makeUncompressedPdf has no Info dictionary and no XMP at all.
    const result = await remove(await input("bare.pdf", makeUncompressedPdf(2)));
    expect(result.meta).toMatchObject({
      removedFields: 0,
      xmpRemoved: "not-present",
      verification: "verified",
      creatorEmptied: "yes",
    });
    const reloaded = await PDFDocument.load(result.artifacts[0].bytes);
    expect(reloaded.getPageCount()).toBe(2);
  });

  it("removes only the Info fields when there is no XMP stream", async () => {
    const document = await PDFDocument.create();
    document.addPage([100, 100]);
    document.setTitle("Only Info");
    const bytes = await document.save();

    const result = await remove(await input("info-only.pdf", bytes));
    // pdf-lib's create() stamps its own Creator by default, so the document
    // really carries two of the five fields: the title and that creator.
    expect(result.meta).toMatchObject({
      removedFields: 2,
      xmpRemoved: "not-present",
    });
    const cleaned = await PDFDocument.load(result.artifacts[0].bytes);
    expect(cleaned.getTitle()).toBeUndefined();
    expect(cleaned.getCreator()).toBe("");
  });

  it("never claims the result is metadata-free: producer and dates remain", async () => {
    const result = await remove(await input("doc.pdf", await pdfWithEverything()));
    const metadata = readDocumentMetadata(
      await PDFDocument.load(result.artifacts[0].bytes),
    );
    // pdf-lib re-stamps these on save; the tool reports them as remaining.
    expect(metadata.producer).not.toBeNull();
    expect(metadata.creationDate).not.toBeNull();
    expect(metadata.modificationDate).not.toBeNull();
    expect(result.meta).toMatchObject({ producerStamped: "yes" });
  });

  it("does not mutate the input bytes", async () => {
    const bytes = await pdfWithEverything();
    const snapshot = new Uint8Array(bytes);
    await remove(await input("doc.pdf", bytes));
    expect([...bytes]).toEqual([...snapshot]);
  });

  it("rejects malformed PDFs", async () => {
    await expectFailure(
      remove(await input("broken.pdf", makeBrokenPdf())),
      "INVALID_PDF",
    );
  });

  it("rejects encrypted PDFs", async () => {
    const spy = vi
      .spyOn(PDFDocument, "load")
      .mockRejectedValueOnce(new EncryptedPDFError());
    try {
      await expectFailure(
        remove(await input("locked.pdf", await makeNumberedPdf(1))),
        "ENCRYPTED_PDF",
      );
    } finally {
      spy.mockRestore();
    }
  });

  it("rejects multiple files at the service layer", async () => {
    const bytes = await makeNumberedPdf(2);
    const result = await runProcessingJob({
      toolId: "remove-metadata",
      files: [await input("a.pdf", bytes), await input("b.pdf", bytes)],
      options: {},
    });
    expect(result.status).toBe("failed");
    expect(result.status === "failed" && result.error.code).toBe("TOO_MANY_FILES");
  });

  it("sanitises hostile filenames out of the artifact name", async () => {
    const result = await remove(
      await input("../../Ő-private.pdf", await makeNumberedPdf(1)),
    );
    expect(result.artifacts[0].name).toBe("_-private-metadata-removed.pdf");
    expect(JSON.stringify(result.meta)).not.toContain("private.pdf");
  });
});
