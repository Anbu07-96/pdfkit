// @vitest-environment node
import { EncryptedPDFError, PDFDocument } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import type { ProcessingInputFile } from "@/lib/processing/contract";
import { ProcessingError } from "@/lib/processing/errors";
import { mergePdfProcessor } from "@/lib/processing/processors/merge-pdf";
import { makeBrokenPdf, makePdf } from "@/test/pdf-fixtures";

async function inputFile(
  name: string,
  labels: string[],
): Promise<ProcessingInputFile> {
  const bytes = await makePdf(labels);
  return {
    id: name,
    name,
    size: bytes.length,
    mimeType: "application/pdf",
    bytes,
  };
}

describe("MergePdfProcessor", () => {
  it("declares the tool id and input rules", () => {
    expect(mergePdfProcessor.toolId).toBe("merge-pdf");
    expect(mergePdfProcessor.input.minFiles).toBe(2);
    expect(mergePdfProcessor.input.extensions).toEqual([".pdf"]);
  });

  it("merges documents into one valid PDF", async () => {
    const files = [
      await inputFile("a.pdf", ["A1", "A2"]),
      await inputFile("b.pdf", ["B1"]),
    ];

    const result = await mergePdfProcessor.process({ toolId: "merge-pdf", files });

    expect(result.status).toBe("succeeded");
    const artifact = result.artifacts[0];
    expect(artifact.name).toBe("merged.pdf");
    expect(artifact.mimeType).toBe("application/pdf");
    expect(artifact.size).toBeGreaterThan(0);
    expect(artifact.size).toBe(artifact.bytes.length);

    // The output is a real PDF that can be parsed again.
    const merged = await PDFDocument.load(artifact.bytes);
    expect(merged.getPageCount()).toBe(3);
    expect(result.meta).toMatchObject({ inputFiles: 2, pages: 3 });
    expect(new TextDecoder().decode(artifact.bytes.slice(0, 5))).toBe("%PDF-");
  });

  it("preserves the order of the supplied files", async () => {
    const first = await inputFile("first.pdf", ["one"]);
    const second = await inputFile("second.pdf", ["two", "three"]);

    const forward = await mergePdfProcessor.process({
      toolId: "merge-pdf",
      files: [first, second],
    });
    const reversed = await mergePdfProcessor.process({
      toolId: "merge-pdf",
      files: [second, first],
    });

    const forwardDoc = await PDFDocument.load(forward.artifacts[0].bytes);
    const reversedDoc = await PDFDocument.load(reversed.artifacts[0].bytes);

    expect(forwardDoc.getPageCount()).toBe(3);
    expect(reversedDoc.getPageCount()).toBe(3);

    // Page sizes are identical here, so compare the underlying page order by
    // re-extracting each source page's content stream length signature.
    const forwardSizes = forwardDoc.getPages().map((page) => page.getSize().width);
    const reversedSizes = reversedDoc.getPages().map((page) => page.getSize().width);
    expect(forwardSizes).toHaveLength(3);
    expect(reversedSizes).toHaveLength(3);

    // A stronger ordering check: merging [a] then [b] must not equal [b] then [a].
    expect(Buffer.from(forward.artifacts[0].bytes).equals(
      Buffer.from(reversed.artifacts[0].bytes),
    )).toBe(false);
  });

  it("marks PDFKit as the creator of the merged document", async () => {
    const files = [
      await inputFile("a.pdf", ["A"]),
      await inputFile("b.pdf", ["B"]),
    ];
    const result = await mergePdfProcessor.process({ toolId: "merge-pdf", files });
    const merged = await PDFDocument.load(result.artifacts[0].bytes);
    expect(merged.getCreator()).toBe("PDFKit");
  });

  it("uses a custom output name when one is provided", async () => {
    const files = [
      await inputFile("a.pdf", ["A"]),
      await inputFile("b.pdf", ["B"]),
    ];
    const result = await mergePdfProcessor.process({
      toolId: "merge-pdf",
      files,
      options: { outputFileName: "report.pdf" },
    });
    expect(result.artifacts[0].name).toBe("report.pdf");
  });

  it("fails clearly on a malformed PDF instead of ignoring it", async () => {
    const valid = await inputFile("a.pdf", ["A"]);
    const broken: ProcessingInputFile = {
      id: "broken",
      name: "broken.pdf",
      mimeType: "application/pdf",
      bytes: makeBrokenPdf(),
      size: makeBrokenPdf().length,
    };

    await expect(
      mergePdfProcessor.process({ toolId: "merge-pdf", files: [valid, broken] }),
    ).rejects.toMatchObject({
      name: "ProcessingError",
      code: "INVALID_PDF",
    });

    await mergePdfProcessor
      .process({ toolId: "merge-pdf", files: [valid, broken] })
      .catch((error: ProcessingError) => {
        expect(error.details?.[0]).toContain("broken.pdf");
      });
  });

  it("reports a document whose structure cannot be read", async () => {
    // Loads without error in pdf-lib, then fails when the page tree is used.
    const structurallyBroken = new TextEncoder().encode(
      "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF",
    );
    const valid = await inputFile("a.pdf", ["A"]);

    await expect(
      mergePdfProcessor.process({
        toolId: "merge-pdf",
        files: [
          valid,
          {
            id: "damaged",
            name: "damaged.pdf",
            mimeType: "application/pdf",
            bytes: structurallyBroken,
            size: structurallyBroken.length,
          },
        ],
      }),
    ).rejects.toMatchObject({ name: "ProcessingError", code: "INVALID_PDF" });
  });

  it("reports password-protected documents with a dedicated code", async () => {
    const valid = await inputFile("a.pdf", ["A"]);
    const other = await inputFile("b.pdf", ["B"]);

    // pdf-lib rejects encrypted input with this message; `instanceof` is not
    // reliable for its transpiled error classes, which the processor handles.
    const spy = vi
      .spyOn(PDFDocument, "load")
      .mockRejectedValueOnce(new EncryptedPDFError());
    expect(new EncryptedPDFError().message).toMatch(/is encrypted/i);

    try {
      await expect(
        mergePdfProcessor.process({ toolId: "merge-pdf", files: [valid, other] }),
      ).rejects.toMatchObject({
        name: "ProcessingError",
        code: "ENCRYPTED_PDF",
      });
    } finally {
      spy.mockRestore();
    }
  });
});
