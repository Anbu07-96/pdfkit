import "server-only";

import { Document, Packer, PageBreak, Paragraph, TextRun } from "docx";
import { unzipSync } from "fflate";
import type {
  ProcessingContext,
  ProcessingRequest,
  ProcessingSuccess,
  ToolProcessor,
} from "@/lib/processing/contract";
import { ProcessingError } from "@/lib/processing/errors";
import { baseDocumentName } from "@/lib/processing/file-names";
import { loadPdfDocument, readPageCount } from "@/lib/processing/pdf-document";
import { PDF_TO_WORD_INPUT_RULES } from "@/lib/processing/rules";
import { extractPdfPageTexts } from "@/lib/thumbnails/renderer";

/**
 * PDF → Word (.docx), **text only**.
 *
 * What this tool honestly does: extract the text of every page with pdfium
 * (the same rasteriser that powers previews and image exports) and write it
 * into a real Word document — one paragraph per extracted line and a page
 * break between pages. Nothing else: formatting, fonts, images, tables and
 * exact layout are **not** preserved, and the interface and catalog say so.
 * There is no fake reconstruction.
 *
 * Everything runs in memory: no temp files, no child processes, no external
 * services. The produced DOCX is validated before it is returned — it must be
 * a real ZIP containing the required Office parts, or the job fails.
 */

/** The DOCX media type (long, but it is the registered one). */
export const DOCX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Split a page's extracted text into non-empty trimmed lines. */
function pageLines(text: string): string[] {
  return text
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Build the document structure from per-page texts. */
function buildDocx(pageTexts: string[]): Document {
  const children: Paragraph[] = [];

  pageTexts.forEach((text, index) => {
    if (index > 0) children.push(new Paragraph({ children: [new PageBreak()] }));

    const lines = pageLines(text);
    if (lines.length === 0) {
      // Image-only page: an honest marker instead of an invisible gap.
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `[Page ${index + 1} contains no extractable text]`,
              italics: true,
            }),
          ],
        }),
      );
      return;
    }

    for (const line of lines) {
      children.push(new Paragraph({ children: [new TextRun(line)] }));
    }
  });

  return new Document({
    creator: "PDFKit",
    title: "Converted from PDF (text only)",
    sections: [{ children }],
  });
}

/** Prove the produced bytes are a real DOCX before claiming success. */
function validateDocx(bytes: Uint8Array): void {
  const isZip = bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (!isZip) {
    throw new ProcessingError(
      "PROCESSING_ERROR",
      "The Word document could not be created.",
    );
  }

  let entries: string[];
  try {
    entries = Object.keys(unzipSync(bytes));
  } catch (cause) {
    throw new ProcessingError(
      "PROCESSING_ERROR",
      "The Word document could not be verified.",
      { cause },
    );
  }

  for (const required of ["[Content_Types].xml", "word/document.xml"]) {
    if (!entries.includes(required)) {
      throw new ProcessingError(
        "PROCESSING_ERROR",
        "The Word document is missing required parts.",
      );
    }
  }
}

export class PdfToWordProcessor implements ToolProcessor {
  readonly toolId = "pdf-to-word";
  readonly input = PDF_TO_WORD_INPUT_RULES;

  async process(
    request: ProcessingRequest,
    context: ProcessingContext,
  ): Promise<ProcessingSuccess> {
    const file = request.files[0];
    if (!file) {
      throw new ProcessingError("VALIDATION_ERROR", "No PDF was uploaded.");
    }

    // Fail fast on malformed/encrypted documents and excessive page counts —
    // before pdfium touches anything.
    const document = await loadPdfDocument(file.name, file.bytes);
    const pageCount = readPageCount(document, file.name);
    if (pageCount > context.limits.maxConversionPages) {
      throw new ProcessingError(
        "TOO_MANY_OUTPUTS",
        `This PDF has ${pageCount} pages; the limit for Word export is ${context.limits.maxConversionPages}.`,
      );
    }

    const { texts } = await extractPdfPageTexts(file.bytes, {
      maxPages: context.limits.maxConversionPages,
    });

    const characters = texts.reduce((total, text) => total + text.length, 0);
    const paragraphs = texts.reduce(
      (total, text) => total + pageLines(text).length,
      0,
    );

    let bytes: Uint8Array;
    try {
      const packed = await Packer.toBuffer(buildDocx(texts));
      bytes = new Uint8Array(packed);
    } catch (cause) {
      throw new ProcessingError(
        "PROCESSING_ERROR",
        "The Word document could not be created.",
        { cause },
      );
    }

    validateDocx(bytes);

    return {
      status: "succeeded",
      artifacts: [
        {
          name: `${baseDocumentName(file.name)}.docx`,
          mimeType: DOCX_MIME_TYPE,
          size: bytes.length,
          bytes,
        },
      ],
      meta: {
        pages: pageCount,
        outputPages: pageCount,
        paragraphs,
        characters,
        mode: "text-only",
      },
    };
  }
}

export const pdfToWordProcessor = new PdfToWordProcessor();
