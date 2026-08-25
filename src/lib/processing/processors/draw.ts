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
import { DRAW_INPUT_RULES } from "@/lib/processing/rules";
import { parseHexColor } from "@/lib/processing/add-shapes";
import {
  getPresetPoints,
  parseDrawOptions,
  resolveDrawPages,
} from "@/lib/processing/draw";

const MARGIN = 36;

export class DrawProcessor implements ToolProcessor {
  readonly toolId = "draw";
  readonly input = DRAW_INPUT_RULES;

  async process(
    request: ProcessingRequest<Record<string, unknown>>,
  ): Promise<ProcessingSuccess> {
    const file = request.files[0];
    if (!file) {
      throw new ProcessingError("VALIDATION_ERROR", "No PDF was uploaded.");
    }

    const parsed = parseDrawOptions(request.options ?? {});
    if (!parsed.ok) {
      throw new ProcessingError("INVALID_DRAW_CONFIGURATION", parsed.issue.message);
    }
    const options = parsed.options;

    const document = await loadPdfDocument(file.name, file.bytes);
    const pageCount = readPageCount(document, file.name);

    const parsedColor = parseHexColor(options.strokeColor) ?? { r: 0, g: 0, b: 0 };
    const strokeRgb = rgb(parsedColor.r, parsedColor.g, parsedColor.b);

    const strokePaths = getPresetPoints(options.preset);

    const targetPages = resolveDrawPages(options.pages, pageCount);
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

      let boxX = MARGIN;
      if (col === "right") {
        boxX = pageWidth - MARGIN - effectiveWidth;
      } else if (col === "center") {
        boxX = pageWidth / 2 - effectiveWidth / 2;
      }

      let boxY = MARGIN;
      if (row === "top") {
        boxY = pageHeight - MARGIN - effectiveHeight;
      } else if (row === "center") {
        boxY = pageHeight / 2 - effectiveHeight / 2;
      }

      boxX = Math.max(MARGIN, Math.min(boxX, pageWidth - MARGIN - effectiveWidth));
      boxY = Math.max(MARGIN, Math.min(boxY, pageHeight - MARGIN - effectiveHeight));

      for (const stroke of strokePaths) {
        for (let i = 0; i < stroke.length - 1; i++) {
          const p1 = stroke[i]!;
          const p2 = stroke[i + 1]!;

          const x1 = Math.max(MARGIN, Math.min(pageWidth - MARGIN, boxX + p1.x * effectiveWidth));
          const y1 = Math.max(MARGIN, Math.min(pageHeight - MARGIN, boxY + p1.y * effectiveHeight));
          const x2 = Math.max(MARGIN, Math.min(pageWidth - MARGIN, boxX + p2.x * effectiveWidth));
          const y2 = Math.max(MARGIN, Math.min(pageHeight - MARGIN, boxY + p2.y * effectiveHeight));

          page.drawLine({
            start: { x: x1, y: y1 },
            end: { x: x2, y: y2 },
            thickness: options.strokeWidth,
            color: strokeRgb,
          });
        }
      }
    }

    stampPdfKitMetadata(document);
    const bytes = await savePdfDocument(document);

    return {
      status: "succeeded",
      artifacts: [
        {
          name: derivedDocumentName(file.name, "drawn"),
          mimeType: "application/pdf",
          size: bytes.length,
          bytes,
        },
      ],
      meta: {
        pages: pageCount,
        outputPages: pageCount,
        drawnPages: targetPages.length,
      },
    };
  }
}

export const drawProcessor = new DrawProcessor();
