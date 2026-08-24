import "server-only";

import { StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type {
  ProcessingRequest,
  ProcessingSuccess,
  ToolProcessor,
} from "@/lib/processing/contract";
import { ProcessingError } from "@/lib/processing/errors";
import { derivedDocumentName } from "@/lib/processing/file-names";
import {
  pageNumberOf,
  parsePageNumberOptions,
  resolveNumberedPages,
} from "@/lib/processing/page-numbers";
import {
  loadPdfDocument,
  readPageCount,
  savePdfDocument,
  stampPdfKitMetadata,
} from "@/lib/processing/pdf-document";
import { PAGE_NUMBERS_INPUT_RULES } from "@/lib/processing/rules";

/**
 * Page Numbers — vector text stamps, the watermark pipeline's sibling.
 *
 * Draws each selected page's number as ordinary text near the bottom edge
 * with pdf-lib. Pages are never rasterised or rebuilt: count, dimensions,
 * `/Rotate` and content are untouched, and the numbers are real, searchable
 * PDF text (verified in tests by decoding the produced content streams).
 *
 * `Page X of Y` always reports the document's real page count; the starting
 * number only shifts the printed X (a front-matter offset), which can make X
 * exceed Y — that behaviour is documented rather than hidden.
 */
export class PageNumbersProcessor implements ToolProcessor {
  readonly toolId = "page-numbers";
  readonly input = PAGE_NUMBERS_INPUT_RULES;

  async process(
    request: ProcessingRequest<Record<string, unknown>>,
  ): Promise<ProcessingSuccess> {
    const file = request.files[0];
    if (!file) {
      throw new ProcessingError("VALIDATION_ERROR", "No PDF was uploaded.");
    }

    const parsed = parsePageNumberOptions(request.options ?? {});
    if (!parsed.ok) {
      throw new ProcessingError(
        "INVALID_PAGE_NUMBER_CONFIGURATION",
        parsed.issue.message,
      );
    }
    const options = parsed.options;

    const document = await loadPdfDocument(file.name, file.bytes);
    const pageCount = readPageCount(document, file.name);
    const font = await document.embedFont(StandardFonts.Helvetica);

    const targets = resolveNumberedPages(options.pages, pageCount);
    for (const pageNumber of targets) {
      drawNumber(document.getPage(pageNumber - 1), font, {
        label: pageNumberOf(pageNumber, pageCount, options),
        fontSize: options.fontSize,
        position: options.position,
      });
    }

    stampPdfKitMetadata(document);
    const bytes = await savePdfDocument(document);

    return {
      status: "succeeded",
      artifacts: [
        {
          name: derivedDocumentName(file.name, "numbered"),
          mimeType: "application/pdf",
          size: bytes.length,
          bytes,
        },
      ],
      meta: {
        pages: pageCount,
        outputPages: pageCount,
        numberedPages: targets.length,
      },
    };
  }
}

/** Dark grey, unobtrusive — a page number, not decoration. */
const NUMBER_COLOR = rgb(0.25, 0.25, 0.25);

function drawNumber(
  page: PDFPage,
  font: PDFFont,
  config: { label: string; fontSize: number; position: string },
): void {
  const { label, fontSize, position } = config;
  const width = page.getWidth();
  const textWidth = font.widthOfTextAtSize(label, fontSize);
  // Bottom margin scales with the font so small pages stay tidy; side margins
  // match the cap height for a balanced corner position.
  const bottomMargin = Math.max(6, fontSize * 0.6);
  const sideMargin = Math.max(8, fontSize * 0.9);

  let x: number;
  if (position === "bottom-left") x = sideMargin;
  else if (position === "bottom-right") x = width - textWidth - sideMargin;
  else x = (width - textWidth) / 2;

  page.drawText(label, {
    x,
    y: bottomMargin,
    size: fontSize,
    font,
    color: NUMBER_COLOR,
  });
}

export const pageNumbersProcessor = new PageNumbersProcessor();
