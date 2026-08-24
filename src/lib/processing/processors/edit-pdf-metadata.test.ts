// @vitest-environment node
import { EncryptedPDFError, PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import type { ProcessingInputFile } from "@/lib/processing/contract";
import { ProcessingError } from "@/lib/processing/errors";
import { readDocumentMetadata } from "@/lib/processing/inspect";
import { editPdfMetadataProcessor } from "@/lib/processing/processors/edit-pdf-metadata";
import {
  makeBrokenPdf,
  makeNumberedPdf,
  makeUncompressedPdf,
} from "@/test/pdf-fixtures";

async function input(
  name: string,
  bytes: Uint8Array,
): Promise<ProcessingInputFile> {
  return {
    id: "input-1",
    name,
    size: bytes.length,
    mimeType: "application/pdf",
    bytes,
  };
}

async function edit(
  file: ProcessingInputFile,
  options: Record<string, unknown> = {},
) {
  return editPdfMetadataProcessor.process({
    toolId: "edit-pdf-metadata",
    files: [file],
    options,
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

/** A PDF that already carries metadata, made with real pdf-lib setters. */
async function pdfWithMetadata(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  document.addPage([200, 200]).drawText("content stays", { x: 10, y: 100, size: 12, font });
  document.setTitle("Old Title");
  document.setAuthor("Old Author");
  document.setSubject("Old Subject");
  // pdf-lib's array setter joins with spaces, which would blur the list on
  // read-back; PDFKit writes keywords comma-separated (see the processor).
  document.setKeywords(["old, stale"]);
  document.setCreator("Old Creator");
  return document.save();
}

describe("EditPdfMetadataProcessor", () => {
  it("declares the tool id and single-file input rules", () => {
    expect(editPdfMetadataProcessor.toolId).toBe("edit-pdf-metadata");
    expect(editPdfMetadataProcessor.input.minFiles).toBe(1);
    expect(editPdfMetadataProcessor.input.maxFiles).toBe(1);
    expect(editPdfMetadataProcessor.input.extensions).toEqual([".pdf"]);
  });

  it("writes every supported field and preserves pages and content", async () => {
    const result = await edit(await input("doc.pdf", await makeNumberedPdf(3)), {
      title: "New Title",
      author: "New Author",
      subject: "New Subject",
      keywords: "finance, 2026",
      creator: "New Creator",
    });

    const artifact = result.artifacts[0];
    expect(artifact.name).toBe("doc-metadata.pdf");
    expect(artifact.mimeType).toBe("application/pdf");
    expect(new TextDecoder().decode(artifact.bytes.slice(0, 5))).toBe("%PDF-");

    const reloaded = await PDFDocument.load(artifact.bytes);
    expect(reloaded.getPageCount()).toBe(3);
    // Page identity and order untouched.
    expect(
      reloaded.getPages().map((page) => Math.round(page.getSize().width)),
    ).toEqual([101, 102, 103]);
    expect(result.meta).toMatchObject({ pages: 3, outputPages: 3, updatedFields: 5 });

    const metadata = readDocumentMetadata(reloaded);
    expect(metadata.title).toBe("New Title");
    expect(metadata.author).toBe("New Author");
    expect(metadata.subject).toBe("New Subject");
    expect(metadata.keywords).toEqual(["finance", "2026"]);
    expect(metadata.creator).toBe("New Creator");
  });

  it("replaces existing metadata with new values", async () => {
    const result = await edit(await input("doc.pdf", await pdfWithMetadata()), {
      title: "Replacement",
    });
    const metadata = readDocumentMetadata(
      await PDFDocument.load(result.artifacts[0].bytes),
    );
    expect(metadata.title).toBe("Replacement");
    // Untouched fields keep their old values — nothing else is invented.
    expect(metadata.author).toBe("Old Author");
    expect(metadata.subject).toBe("Old Subject");
    expect(metadata.keywords).toEqual(["old", "stale"]);
  });

  it("removes fields on empty input and proves the removal", async () => {
    const result = await edit(await input("doc.pdf", await pdfWithMetadata()), {
      title: "",
      author: "",
      keywords: "",
    });
    const metadata = readDocumentMetadata(
      await PDFDocument.load(result.artifacts[0].bytes),
    );
    expect(metadata.title).toBeNull();
    expect(metadata.author).toBeNull();
    expect(metadata.keywords).toBeNull();
    // Untouched fields survive.
    expect(metadata.subject).toBe("Old Subject");
    expect(metadata.creator).toBe("Old Creator");
  });

  it("leaves fields unchanged when they are absent from the request", async () => {
    const result = await edit(await input("doc.pdf", await pdfWithMetadata()), {
      subject: "Only This",
    });
    const metadata = readDocumentMetadata(
      await PDFDocument.load(result.artifacts[0].bytes),
    );
    expect(metadata.subject).toBe("Only This");
    expect(metadata.title).toBe("Old Title");
    expect(metadata.keywords).toEqual(["old", "stale"]);
    expect(result.meta).toMatchObject({ updatedFields: 1 });
  });

  it("round-trips unicode values safely", async () => {
    const result = await edit(await input("doc.pdf", await makeNumberedPdf(1)), {
      title: "Årśvær — über naïve 中文 📄",
      author: "Ana Ñúñez",
      keywords: "café, 日本語",
    });
    const metadata = readDocumentMetadata(
      await PDFDocument.load(result.artifacts[0].bytes),
    );
    expect(metadata.title).toBe("Årśvær — über naïve 中文 📄");
    expect(metadata.author).toBe("Ana Ñúñez");
    expect(metadata.keywords).toEqual(["café", "日本語"]);
  });

  it("creates the Info dictionary when the document has none", async () => {
    // makeUncompressedPdf has no /Info in its trailer at all.
    const result = await edit(
      await input("bare.pdf", makeUncompressedPdf(2)),
      { title: "Added Later" },
    );
    const metadata = readDocumentMetadata(
      await PDFDocument.load(result.artifacts[0].bytes),
    );
    expect(metadata.title).toBe("Added Later");
  });

  it("rejects non-string field values", async () => {
    const error = await expectFailure(
      edit(await input("doc.pdf", await makeNumberedPdf(1)), {
        title: 42 as unknown as string,
      }),
      "VALIDATION_ERROR",
    );
    expect(error.status).toBe(400);
  });

  it("rejects oversized values", async () => {
    await expectFailure(
      edit(await input("doc.pdf", await makeNumberedPdf(1)), {
        title: "a".repeat(2001),
      }),
      "VALIDATION_ERROR",
    );
    await expectFailure(
      edit(await input("doc.pdf", await makeNumberedPdf(1)), {
        keywords: Array.from({ length: 51 }, (_, i) => `k${i}`).join(", "),
      }),
      "VALIDATION_ERROR",
    );
  });

  it("rejects malformed PDFs", async () => {
    await expectFailure(
      edit(await input("broken.pdf", makeBrokenPdf()), { title: "x" }),
      "INVALID_PDF",
    );
  });

  it("rejects encrypted PDFs", async () => {
    const spy = vi
      .spyOn(PDFDocument, "load")
      .mockRejectedValueOnce(new EncryptedPDFError());
    try {
      await expectFailure(
        edit(await input("locked.pdf", await makeNumberedPdf(1)), { title: "x" }),
        "ENCRYPTED_PDF",
      );
    } finally {
      spy.mockRestore();
    }
  });

  it("sanitises hostile source names out of the artifact name", async () => {
    const result = await edit(
      await input("../../Ő-report.pdf", await makeNumberedPdf(1)),
      { title: "x" },
    );
    expect(result.artifacts[0].name).toBe("_-report-metadata.pdf");
  });

  it("does not mutate the input bytes", async () => {
    const bytes = await pdfWithMetadata();
    const snapshot = new Uint8Array(bytes);
    await edit(await input("doc.pdf", bytes), { title: "x" });
    expect([...bytes]).toEqual([...snapshot]);
  });
});
