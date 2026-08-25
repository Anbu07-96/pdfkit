import "server-only";

import { rgb } from "pdf-lib";
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
import { HIGHLIGHT_INPUT_RULES } from "@/lib/processing/rules";
import { parseHexColor } from "@/lib/processing/add-shapes";
import {
  parseHighlightOptions,
  resolveHighlightPages,
} from "@/lib/processing/highlight";

const MARGIN = 36;

export class HighlightProcessor implements ToolProcessor {
  readonly toolId = "highlight";
  readonly input = HIGHLIGHT_INPUT_RULES;

  async process(
    request: ProcessingRequest<Record<string, unknown>>,
  ): Promise<ProcessingSuccess> {
    const file = request.files[0];
    if (!file) {
      throw new ProcessingError("VALIDATION_ERROR", "No PDF was uploaded.");
    }

    const parsed = parseHighlightOptions(request.options ?? {});
    if (!parsed.ok) {
      throw new ProcessingError("INVALID_HIGHLIGHT_CONFIGURATION", parsed.issue.message);
    }
    const options = parsed.options;

    const document = await loadPdfDocument(file.name, file.bytes);
    const pageCount = readPageCount(document, file.name);

    const parsedColor = parseHexColor(options.color) ?? { r: 0.99, g: 0.94, b: 0.54 };
    const highlightRgb = rgb(parsedColor.r, parsedColor.g, parsedColor.b);

    const targetPages = resolveHighlightPages(options.pages, pageCount);
    for (const pageNumber of targetPages) {
      const page = document.getPage(pageNumber - 1);
      const pageWidth = page.getWidth();
      const pageHeight = page.getHeight();

      const availableWidth = Math.max(10, pageWidth - MARGIN * 2);
      const availableHeight = Math.max(10, pageHeight - MARGIN * 2);

      const effectiveWidth = Math.min(options.width, availableWidth);
      const effectiveHeight = Math.min(options.height, availableHeight);

      const row = options.placement.startsWith("top")
        ? "top"
        : options.placement.startsWith("bottom")
          ? "bottom"
          : "center";

      const col = options.placement.endsWith("left")
        ? "left"
        : options.placement.endsWith("right")
          ? "right"
          : "center";

      let x = MARGIN;
      if (col === "right") {
        x = pageWidth - MARGIN - effectiveWidth;
      } else if (col === "center") {
        x = pageWidth / 2 - effectiveWidth / 2;
      }

      let y = MARGIN;
      if (row === "top") {
        y = pageHeight - MARGIN - effectiveHeight;
      } else if (row === "center") {
        y = pageHeight / 2 - effectiveHeight / 2;
      }

      x = Math.max(MARGIN, Math.min(x, pageWidth - MARGIN - effectiveWidth));
      y = Math.max(MARGIN, Math.min(y, pageHeight - MARGIN - effectiveHeight));

      page.drawRectangle({
        x,
        y,
        width: effectiveWidth,
        height: effectiveHeight,
        color: highlightRgb,
        opacity: options.opacity,
      });
    }

    stampPdfKitMetadata(document);
    const bytes = await savePdfDocument(document);

    return {
      status: "succeeded",
      artifacts: [
        {
          name: derivedDocumentName(file.name, "highlighted"),
          mimeType: "application/pdf",
          size: bytes.length,
          bytes,
        },
      ],
      meta: {
        pages: pageCount,
        outputPages: pageCount,
        highlightedPages: targetPages.length,
      },
    };
  }
}

export const highlightProcessor = new HighlightProcessor();
