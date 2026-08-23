import "server-only";

import { StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from "pdf-lib";
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
import { WATERMARK_INPUT_RULES } from "@/lib/processing/rules";
import {
  parseWatermarkOptions,
  resolveWatermarkPages,
  type WatermarkOptions,
} from "@/lib/processing/watermark";

/**
 * Watermark PDF — text stamps drawn with pdf-lib, no rasterising.
 *
 * Draws the requested text on the selected pages with the chosen opacity,
 * rotation and placement. Pages are never rebuilt: size, rotation, content
 * and count are untouched, and the watermark is ordinary page content
 * (vector text with an ExtGState alpha), so the output stays a real,
 * searchable PDF.
 *
 * Honesty notes carried through to the interface and docs: the standard-font
 * watermark supports the standard Latin character set (pdf-lib's WinAnsi
 * fonts); text outside it is rejected with a clear message rather than
 * replaced. And a visible watermark is a deterrent, not protection — it can
 * be removed by anyone with a PDF editor.
 */
export class WatermarkProcessor implements ToolProcessor {
  readonly toolId = "watermark";
  readonly input = WATERMARK_INPUT_RULES;

  async process(
    request: ProcessingRequest<Record<string, unknown>>,
  ): Promise<ProcessingSuccess> {
    const file = request.files[0];
    if (!file) {
      throw new ProcessingError("VALIDATION_ERROR", "No PDF was uploaded.");
    }

    const parsed = parseWatermarkOptions(request.options ?? {});
    if (!parsed.ok) {
      throw new ProcessingError(
        "INVALID_WATERMARK_CONFIGURATION",
        parsed.issue.message,
      );
    }
    const options = parsed.options;

    const document = await loadPdfDocument(file.name, file.bytes);
    const pageCount = readPageCount(document, file.name);
    const font = await document.embedFont(StandardFonts.HelveticaBold);

    const targetPages = resolveWatermarkPages(options.pages, pageCount);
    for (const pageNumber of targetPages) {
      const page = document.getPage(pageNumber - 1);
      try {
        drawWatermark(page, font, options);
      } catch (cause) {
        if (cause instanceof ProcessingError) throw cause;
        // pdf-lib rejects characters the standard fonts cannot encode.
        if (/WinAnsi cannot encode/i.test(
              cause instanceof Error ? cause.message : "",
            )) {
          throw new ProcessingError(
            "INVALID_WATERMARK_CONFIGURATION",
            "The watermark text contains characters the watermark font cannot display. Use standard Latin characters.",
            { cause },
          );
        }
        throw new ProcessingError(
          "PROCESSING_ERROR",
          "The watermark could not be added.",
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
          name: derivedDocumentName(file.name, "watermarked"),
          mimeType: "application/pdf",
          size: bytes.length,
          bytes,
        },
      ],
      meta: {
        pages: pageCount,
        outputPages: pageCount,
        watermarkedPages: targetPages.length,
      },
    };
  }
}

/** Neutral grey at the requested strength — the classic watermark look. */
const WATERMARK_COLOR = rgb(0.55, 0.55, 0.55);

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Draw one watermark according to the validated options. */
function drawWatermark(
  page: PDFPage,
  font: PDFFont,
  options: WatermarkOptions,
): void {
  const width = page.getWidth();
  const height = page.getHeight();
  const angle = (options.rotationDegrees * Math.PI) / 180;
  const opacity = options.opacityPercent / 100;
  const shared = {
    font,
    color: WATERMARK_COLOR,
    opacity,
    rotate: degrees(options.rotationDegrees),
  };

  if (options.placement === "center") {
    const size = clamp(Math.min(width, height) * 0.12, 16, 96);
    const textWidth = font.widthOfTextAtSize(options.text, size);
    page.drawText(options.text, {
      ...shared,
      size,
      x: width / 2 - (textWidth / 2) * Math.cos(angle),
      y: height / 2 - (textWidth / 2) * Math.sin(angle) - size * 0.35,
    });
    return;
  }

  if (options.placement === "corner") {
    // Bottom-right corner; the rotated text grows up/left from the anchor so
    // its bounding box hugs the corner instead of clipping the page edge.
    const size = clamp(Math.min(width, height) * 0.06, 10, 32);
    const textWidth = font.widthOfTextAtSize(options.text, size);
    const margin = size;
    page.drawText(options.text, {
      ...shared,
      size,
      x: width - margin - textWidth * Math.cos(angle),
      y: margin + Math.max(0, textWidth * Math.sin(angle)),
    });
    return;
  }

  // diagonal-tiled: cover a square the size of the page diagonal so every
  // rotation angle leaves the page fully covered.
  const size = clamp(Math.min(width, height) * 0.08, 12, 72);
  const textWidth = font.widthOfTextAtSize(options.text, size);
  const stepX = textWidth + Math.min(width, height) * 0.25;
  const stepY = size * 3.5;
  const diagonal = Math.hypot(width, height);
  const startX = width / 2 - diagonal / 2;
  const startY = height / 2 - diagonal / 2;
  for (let y = startY; y <= startY + diagonal; y += stepY) {
    for (let x = startX; x <= startX + diagonal; x += stepX) {
      page.drawText(options.text, { ...shared, size, x, y });
    }
  }
}

export const watermarkProcessor = new WatermarkProcessor();
