import "server-only";

import { StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import type {
  ProcessingRequest,
  ProcessingSuccess,
  ToolProcessor,
} from "@/lib/processing/contract";
import { ProcessingError } from "@/lib/processing/errors";
import { derivedDocumentName } from "@/lib/processing/file-names";
import {
  loadPdfDocument,
  readPageCount,
  savePdfDocument,
  stampPdfKitMetadata,
} from "@/lib/processing/pdf-document";
import { ADD_TEXT_INPUT_RULES } from "@/lib/processing/rules";
import {
  parseAddTextOptions,
  resolveAddTextPages,
  type AddTextOptions,
} from "@/lib/processing/add-text";

/**
 * Add Text — vector text drawn on existing pages with pdf-lib, no rasterising.
 *
 * Draws the text box on the selected pages at the chosen anchor position and
 * font size. Pages are never rebuilt: size, rotation, content and count are
 * untouched, and the added text is ordinary page content, so the output stays
 * a real, searchable PDF.
 *
 * Honesty notes carried through to the interface and docs: the standard Latin
 * font (pdf-lib's WinAnsi Helvetica) cannot encode characters outside its
 * range — those are rejected with a clear message, never silently replaced.
 * When the text box would overflow the page it is scaled down to fit (never
 * clipped without telling anyone); the workspace says this can happen.
 */
export class AddTextProcessor implements ToolProcessor {
  readonly toolId = "add-text";
  readonly input = ADD_TEXT_INPUT_RULES;

  async process(
    request: ProcessingRequest<Record<string, unknown>>,
  ): Promise<ProcessingSuccess> {
    const file = request.files[0];
    if (!file) {
      throw new ProcessingError("VALIDATION_ERROR", "No PDF was uploaded.");
    }

    const parsed = parseAddTextOptions(request.options ?? {});
    if (!parsed.ok) {
      throw new ProcessingError("INVALID_TEXT_CONFIGURATION", parsed.issue.message);
    }
    const options = parsed.options;

    const document = await loadPdfDocument(file.name, file.bytes);
    const pageCount = readPageCount(document, file.name);
    const font = await document.embedFont(StandardFonts.Helvetica);

    const targetPages = resolveAddTextPages(options.pages, pageCount);
    for (const pageNumber of targetPages) {
      const page = document.getPage(pageNumber - 1);
      try {
        drawTextBox(page, font, options);
      } catch (cause) {
        if (cause instanceof ProcessingError) throw cause;
        // pdf-lib rejects characters the standard fonts cannot encode.
        if (
          /WinAnsi cannot encode/i.test(cause instanceof Error ? cause.message : "")
        ) {
          throw new ProcessingError(
            "INVALID_TEXT_CONFIGURATION",
            "The text contains characters the standard font cannot display. Use standard Latin characters.",
            { cause },
          );
        }
        throw new ProcessingError(
          "PROCESSING_ERROR",
          "The text could not be added.",
          { cause },
        );
      }
    }

    stampPdfKitMetadata(document);
    const bytes = await savePdfDocument(document);

    return {
      status: "succeeded",
      artifacts: [
        {
          name: derivedDocumentName(file.name, "text-added"),
          mimeType: "application/pdf",
          size: bytes.length,
          bytes,
        },
      ],
      meta: {
        pages: pageCount,
        outputPages: pageCount,
        textPages: targetPages.length,
      },
    };
  }
}

/** Page margin for every anchor position, in points (0.5 inch). */
const MARGIN = 36;

/** Line spacing as a multiple of the font size. */
const LINE_HEIGHT_FACTOR = 1.4;

/** The smallest size the fit-scaling may produce, in points. */
const MIN_EFFECTIVE_SIZE = 6;

/** Draw one validated text box on a page. */
function drawTextBox(page: PDFPage, font: PDFFont, options: AddTextOptions): void {
  const width = page.getWidth();
  const height = page.getHeight();
  const availableWidth = Math.max(0, width - MARGIN * 2);
  const availableHeight = Math.max(0, height - MARGIN * 2);

  // Fit-scaling: text that would overflow the page is shrunk, never clipped.
  // Width and height are both bounded by the longest line and the line count.
  const longest = Math.max(
    ...options.lines.map((line) => font.widthOfTextAtSize(line, options.fontSize)),
    0,
  );
  const naturalBlockHeight =
    options.fontSize * LINE_HEIGHT_FACTOR * options.lines.length;

  let scale = 1;
  if (longest > 0 && longest > availableWidth) {
    scale = Math.min(scale, availableWidth / longest);
  }
  if (naturalBlockHeight > availableHeight) {
    scale = Math.min(scale, availableHeight / naturalBlockHeight);
  }
  const effectiveSize = Math.max(
    MIN_EFFECTIVE_SIZE,
    Math.floor(options.fontSize * scale * 100) / 100,
  );

  const lineHeight = effectiveSize * LINE_HEIGHT_FACTOR;
  const blockHeight = lineHeight * options.lines.length;

  // Vertical anchor: the block's top edge for "top-*", its centre for
  // "center-*", its bottom edge for "bottom-*".
  const row = options.placement.startsWith("top")
    ? "top"
    : options.placement.startsWith("bottom")
      ? "bottom"
      : "center";
  const blockTop =
    row === "top"
      ? height - MARGIN
      : row === "bottom"
        ? MARGIN + blockHeight
        : height / 2 + blockHeight / 2;

  // Horizontal anchor per line (lines are aligned within the block).
  const column = options.placement.endsWith("left")
    ? "left"
    : options.placement.endsWith("right")
      ? "right"
      : "center";
  const horizontal = (lineWidth: number): number => {
    if (column === "right") return width - MARGIN - lineWidth;
    if (column === "left") return MARGIN;
    return width / 2 - lineWidth / 2;
  };

  options.lines.forEach((line, index) => {
    const lineWidth = font.widthOfTextAtSize(line, effectiveSize);
    // Even at the minimum size a line can still exceed the page; it then
    // starts at the margin instead of running off the left edge.
    const x = Math.max(MARGIN, horizontal(lineWidth));
    // drawText's `y` is the baseline; place the first line's top at blockTop.
    const baseline = blockTop - effectiveSize - index * lineHeight;
    page.drawText(line, {
      font,
      size: effectiveSize,
      x,
      y: Math.max(MARGIN / 2, baseline),
    });
  });
}

export const addTextProcessor = new AddTextProcessor();
