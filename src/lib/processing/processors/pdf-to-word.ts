import "server-only";

import { Document, ImageRun, Packer, PageBreak, Paragraph, TextRun } from "docx";
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
import { encodePng } from "@/lib/thumbnails/png";
import {
  extractPdfPageTexts,
  renderEachPdfPage,
} from "@/lib/thumbnails/renderer";

/**
 * PDF → Word (.docx), **text only**.
 *
 * What this tool honestly does: extract the text of every page with pdfium
 * (the same rasteriser that powers previews and image exports) and write it
 * into a real Word document — one paragraph per extracted line and a page
 * break between pages. Formatting, fonts, tables and exact layout are
 * **not** preserved, and the interface and catalog say so. There is no fake
 * reconstruction.
 *
 * Pages with NO extractable text (scanned / image-only pages) are embedded
 * as rendered page images (Phase 75C: the honest fix for "scanned PDFs are
 * not converted" — the previous marker-only output was technically a success
 * but practically useless). Rendering reuses the pdf-to-image infrastructure
 * (same serialized pdfium queue, same DPI, same per-image byte cap); when a
 * page image cannot be produced or exceeds the cap, the page degrades to
 * the honest `[Page N contains no extractable text]` marker instead of
 * failing the conversion. Recovering TEXT from scanned pages still requires
 * OCR, which this tool deliberately does not do.
 *
 * Extracted text is additionally stripped of XML-invalid control characters
 * (see `stripXmlInvalidCharacters`), because unusual PDF text must never be
 * able to malform the generated document.
 *
 * Everything runs in memory: no temp files, no child processes, no external
 * services. The produced DOCX is validated before it is returned — it must be
 * a real ZIP containing the required Office parts, or the job fails.
 */

/** The DOCX media type (long, but it is the registered one). */
export const DOCX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * Characters XML 1.0 permits: tab, and everything from space up through the
 * BMP/astral ranges minus the non-characters at the edges. Line separators
 * are handled by the split before this runs.
 */
const XML_INVALID = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF\uFFFE\uFFFF]/gu;

/**
 * Drop characters a Word document cannot legally contain.
 *
 * Confirmed defect (Phase 19 audit): a PDF can carry raw control bytes in its
 * content stream — a crafted `Tj` string is enough — and pdfium's text
 * extraction passes them through verbatim. The `docx` generator then writes
 * them raw into `word/document.xml`, producing an invalid Office file that
 * Word refuses to open. Stripping XML-invalid code points keeps the document
 * well-formed; they carry no readable text, so nothing of value is lost.
 */
export function stripXmlInvalidCharacters(text: string): string {
  return text.replace(XML_INVALID, "");
}

/** Split a page's extracted text into non-empty, XML-safe trimmed lines. */
function pageLines(text: string): string[] {
  return text
    .split(/\r\n|\r|\n/)
    .map((line) => stripXmlInvalidCharacters(line).trim())
    .filter((line) => line.length > 0);
}

/** A rendered page image to embed for a page that has no extractable text. */
interface PageImage {
  png: Uint8Array;
  /** Rendered bitmap size in pixels (used to size the image in Word). */
  widthPx: number;
  heightPx: number;
}

/** Word renders image dimensions in pixels at 96 DPI. */
const WORD_DPI = 96;

/** Build the document structure from per-page texts (+ optional page images). */
function buildDocx(
  pageTexts: string[],
  pageImages: ReadonlyMap<number, PageImage>,
  renderDpi: number,
): Document {
  const children: Paragraph[] = [];

  pageTexts.forEach((text, index) => {
    if (index > 0) children.push(new Paragraph({ children: [new PageBreak()] }));

    const lines = pageLines(text);
    if (lines.length === 0) {
      const image = pageImages.get(index + 1);
      if (image) {
        // Image-only page: embed the rendered page so scanned documents
        // still carry their visual content into Word (Phase 75C).
        children.push(
          new Paragraph({
            children: [
              new ImageRun({
                type: "png",
                data: image.png,
                transformation: {
                  // Preserve the rendered page's physical size: the bitmap
                  // was rendered at `renderDpi`, Word sizes images at 96.
                  width: Math.max(1, Math.round((image.widthPx * WORD_DPI) / renderDpi)),
                  height: Math.max(1, Math.round((image.heightPx * WORD_DPI) / renderDpi)),
                },
              }),
            ],
          }),
        );
        return;
      }
      // No embeddable image (over the per-image cap, or rendering was not
      // possible): the honest marker instead of an invisible gap.
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
    const linesPerPage = texts.map(pageLines);
    const paragraphs = linesPerPage.reduce((total, lines) => total + lines.length, 0);

    // Pages without extractable text: render them (and only them) so the
    // DOCX can embed the visual page instead of a bare marker. Rendering
    // reuses the pdf-to-image path — same queue, DPI and per-image cap.
    const imagePageNumbers = linesPerPage
      .map((lines, index) => (lines.length === 0 ? index + 1 : 0))
      .filter((pageNumber) => pageNumber > 0);
    const pageImages = new Map<number, PageImage>();
    if (imagePageNumbers.length > 0) {
      await renderEachPdfPage(
        file.bytes,
        {
          dpi: context.limits.conversionDpi,
          maxPages: context.limits.maxConversionPages,
          pages: imagePageNumbers,
        },
        (page) => {
          try {
            const png = encodePng({
              width: page.width,
              height: page.height,
              pixels: page.pixels,
              level: 6,
            });
            if (png.length > context.limits.conversionMaxImageBytes) {
              // Over the per-image cap: degrade to the marker for this
              // page rather than failing a conversion whose text pages
              // are perfectly fine.
              return;
            }
            pageImages.set(page.pageNumber, {
              png,
              widthPx: page.width,
              heightPx: page.height,
            });
          } catch {
            // Encoding failure for one page: marker fallback, never a
            // whole-conversion failure (the text content is unaffected).
          }
        },
      );
    }

    let bytes: Uint8Array;
    try {
      const packed = await Packer.toBuffer(
        buildDocx(texts, pageImages, context.limits.conversionDpi),
      );
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
        // Truthful output description (surfaced as x-pdfkit-mode): a
        // document with embedded page images is no longer "text-only".
        mode: pageImages.size > 0 ? "text-and-page-images" : "text-only",
        imagePages: pageImages.size,
      },
    };
  }
}

export const pdfToWordProcessor = new PdfToWordProcessor();
