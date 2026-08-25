import "server-only";

import { rgb, type PDFPage } from "pdf-lib";
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
import { ADD_SHAPES_INPUT_RULES } from "@/lib/processing/rules";
import {
  parseAddShapesOptions,
  parseHexColor,
  resolveAddShapesPages,
  type AddShapesOptions,
} from "@/lib/processing/add-shapes";

/** Page margin in points (0.5 inch). */
const MARGIN = 36;

/**
 * Add Shapes — vector shapes (rectangle, circle, ellipse, line) drawn on PDF pages.
 *
 * Shapes are drawn directly as vector path content using pdf-lib. Pages are never
 * rasterised, and shapes are strictly constrained to remain within page boundaries.
 */
export class AddShapesProcessor implements ToolProcessor {
  readonly toolId = "add-shapes";
  readonly input = ADD_SHAPES_INPUT_RULES;

  async process(
    request: ProcessingRequest<Record<string, unknown>>,
  ): Promise<ProcessingSuccess> {
    const file = request.files[0];
    if (!file) {
      throw new ProcessingError("VALIDATION_ERROR", "No PDF was uploaded.");
    }

    const parsed = parseAddShapesOptions(request.options ?? {});
    if (!parsed.ok) {
      throw new ProcessingError("INVALID_SHAPE_CONFIGURATION", parsed.issue.message);
    }
    const options = parsed.options;

    const document = await loadPdfDocument(file.name, file.bytes);
    const pageCount = readPageCount(document, file.name);

    const targetPages = resolveAddShapesPages(options.pages, pageCount);
    for (const pageNumber of targetPages) {
      const page = document.getPage(pageNumber - 1);
      try {
        drawShapeOnPage(page, options);
      } catch (cause) {
        if (cause instanceof ProcessingError) throw cause;
        throw new ProcessingError(
          "PROCESSING_ERROR",
          "The shape could not be added.",
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
          name: derivedDocumentName(file.name, "shapes-added"),
          mimeType: "application/pdf",
          size: bytes.length,
          bytes,
        },
      ],
      meta: {
        pages: pageCount,
        outputPages: pageCount,
        shapePages: targetPages.length,
      },
    };
  }
}

/** Draw a vector shape on a single page, clamping bounds so it stays within margins. */
function drawShapeOnPage(page: PDFPage, options: AddShapesOptions): void {
  const pageWidth = page.getWidth();
  const pageHeight = page.getHeight();

  const availableWidth = Math.max(10, pageWidth - MARGIN * 2);
  const availableHeight = Math.max(10, pageHeight - MARGIN * 2);

  let effectiveWidth = Math.min(options.width, availableWidth);
  let effectiveHeight = Math.min(options.height, availableHeight);

  if (options.shape === "circle") {
    const maxDiameter = Math.min(availableWidth, availableHeight);
    effectiveWidth = Math.min(options.width, maxDiameter);
    effectiveHeight = effectiveWidth;
  }

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

  // Strict boundary clamp
  const minX = MARGIN;
  const maxX = Math.max(MARGIN, pageWidth - MARGIN - effectiveWidth);
  const minY = MARGIN;
  const maxY = Math.max(MARGIN, pageHeight - MARGIN - effectiveHeight);

  x = Math.max(minX, Math.min(x, maxX));
  y = Math.max(minY, Math.min(y, maxY));

  const strokeParsed = parseHexColor(options.strokeColor);
  const fillParsed = parseHexColor(options.fillColor);

  const strokeRgb = strokeParsed
    ? rgb(strokeParsed.r, strokeParsed.g, strokeParsed.b)
    : undefined;
  const fillRgb = fillParsed
    ? rgb(fillParsed.r, fillParsed.g, fillParsed.b)
    : undefined;

  const borderWidth =
    strokeRgb && options.strokeWidth > 0 ? options.strokeWidth : undefined;
  const borderColor = borderWidth ? strokeRgb : undefined;
  const color = fillRgb;

  switch (options.shape) {
    case "rectangle": {
      page.drawRectangle({
        x,
        y,
        width: effectiveWidth,
        height: effectiveHeight,
        borderWidth,
        borderColor,
        color,
      });
      break;
    }
    case "circle": {
      const radius = effectiveWidth / 2;
      page.drawCircle({
        x: x + radius,
        y: y + radius,
        size: radius,
        borderWidth,
        borderColor,
        color,
      });
      break;
    }
    case "ellipse": {
      const rx = effectiveWidth / 2;
      const ry = effectiveHeight / 2;
      page.drawEllipse({
        x: x + rx,
        y: y + ry,
        xScale: rx,
        yScale: ry,
        borderWidth,
        borderColor,
        color,
      });
      break;
    }
    case "line": {
      page.drawLine({
        start: { x, y: y + effectiveHeight / 2 },
        end: { x: x + effectiveWidth, y: y + effectiveHeight / 2 },
        thickness: options.strokeWidth > 0 ? options.strokeWidth : 1,
        color: strokeRgb ?? rgb(0, 0, 0),
      });
      break;
    }
  }
}

export const addShapesProcessor = new AddShapesProcessor();
