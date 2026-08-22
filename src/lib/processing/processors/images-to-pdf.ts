import "server-only";

import { PDFDocument, rgb } from "pdf-lib";
import type {
  ProcessingRequest,
  ProcessingSuccess,
  ToolProcessor,
} from "@/lib/processing/contract";
import { ProcessingError } from "@/lib/processing/errors";
import {
  inspectImage,
  MAX_PAGE_POINTS,
  type InspectedImage,
} from "@/lib/processing/images";
import { savePdfDocument, stampPdfKitMetadata } from "@/lib/processing/pdf-document";
import { IMAGES_TO_PDF_INPUT_RULES } from "@/lib/processing/rules";

/**
 * Images → PDF.
 *
 * Every uploaded JPG/JPEG/PNG becomes exactly one PDF page, in upload order:
 *
 * - **JPEGs are embedded as-is** — the original DCT stream is placed into the
 *   PDF untouched, so no quality is lost and no time is wasted re-encoding.
 * - **PNGs go through pdf-lib's `embedPng`**, which preserves the alpha
 *   channel as a soft mask. Because a PDF page has no background of its own,
 *   a white rectangle is drawn behind every image first, so transparent areas
 *   render predictably (white) instead of whatever the viewer shows behind
 *   the page.
 * - **Page sizing** is deliberately simple: the page matches the image's
 *   aspect ratio exactly, sized at 96 DPI (1 px = 0.75 pt) and capped at the
 *   PDF limit of 14 400 pt per side by scaling both dimensions uniformly.
 *   The image is centred and drawn full-bleed — never stretched, never
 *   cropped, no margins to configure.
 *
 * Pixel caps (24 MP / 12 000 px per side) are enforced from the image headers
 * *before* anything is embedded, so a hostile file cannot make the server
 * allocate a huge bitmap.
 */
export class ImagesToPdfProcessor implements ToolProcessor {
  readonly toolId = "images-to-pdf";
  readonly input = IMAGES_TO_PDF_INPUT_RULES;

  async process(request: ProcessingRequest): Promise<ProcessingSuccess> {
    // The service validates count, sizes, extensions, MIME types and the real
    // JPEG/PNG signatures before this runs; `files` is guaranteed non-empty.
    const files = request.files;

    const document = await PDFDocument.create();
    const inspected: InspectedImage[] = [];

    for (const file of files) {
      const result = inspectImage(file.name, file.bytes);
      if ("reason" in result) {
        throw new ProcessingError("INVALID_IMAGE", "An image could not be used.", {
          details: [result.reason],
        });
      }
      inspected.push(result.image);
    }

    for (const [index, file] of files.entries()) {
      const image = inspected[index];
      try {
        const embedded =
          image.kind === "jpeg"
            ? await document.embedJpg(file.bytes)
            : await document.embedPng(file.bytes);

        // 1 px at 96 DPI = 0.75 pt, uniformly capped at the PDF page limit.
        const factor = Math.min(
          0.75,
          MAX_PAGE_POINTS / image.width,
          MAX_PAGE_POINTS / image.height,
        );
        const width = Math.round(image.width * factor * 100) / 100;
        const height = Math.round(image.height * factor * 100) / 100;

        const page = document.addPage([width, height]);
        // Predictable background: viewers disagree on what to show behind a
        // transparent image, so PDFKit paints white first.
        page.drawRectangle({ x: 0, y: 0, width, height, color: rgb(1, 1, 1) });
        page.drawImage(embedded, { x: 0, y: 0, width, height });
      } catch (cause) {
        if (cause instanceof ProcessingError) throw cause;
        // e.g. a PNG variant pdf-lib cannot decode (16-bit, exotic palette).
        throw new ProcessingError(
          "INVALID_IMAGE",
          "An image could not be converted.",
          { details: [`${file.name} could not be embedded as a ${image.kind.toUpperCase()}.`], cause },
        );
      }
    }

    stampPdfKitMetadata(document);
    const bytes = await savePdfDocument(document);

    return {
      status: "succeeded",
      artifacts: [
        {
          name: "images-to-pdf.pdf",
          mimeType: "application/pdf",
          size: bytes.length,
          bytes,
        },
      ],
      meta: {
        pages: inspected.length,
        outputPages: inspected.length,
        images: inspected.length,
      },
    };
  }
}

export const imagesToPdfProcessor = new ImagesToPdfProcessor();
