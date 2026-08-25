import "server-only";

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
import { ADD_IMAGES_INPUT_RULES } from "@/lib/processing/rules";
import {
  hasImageSignature,
} from "@/lib/processing/validation/pdf-input";
import {
  parseAddImagesOptions,
  resolveAddImagesPages,
} from "@/lib/processing/add-images";

const MARGIN = 36;

export class AddImagesProcessor implements ToolProcessor {
  readonly toolId = "add-images";
  readonly input = ADD_IMAGES_INPUT_RULES;

  async process(
    request: ProcessingRequest<Record<string, unknown>>,
  ): Promise<ProcessingSuccess> {
    const pdfFile = request.files[0];
    const imageFile = request.files[1];

    if (!pdfFile || !imageFile) {
      throw new ProcessingError(
        "VALIDATION_ERROR",
        "Both a PDF and an image file (JPG or PNG) are required.",
      );
    }

    const parsed = parseAddImagesOptions(request.options ?? {});
    if (!parsed.ok) {
      throw new ProcessingError("VALIDATION_ERROR", parsed.issue.message);
    }
    const options = parsed.options;

    const document = await loadPdfDocument(pdfFile.name, pdfFile.bytes);
    const pageCount = readPageCount(document, pdfFile.name);

    if (!hasImageSignature(imageFile.bytes)) {
      throw new ProcessingError(
        "INVALID_IMAGE",
        "The image file does not contain a valid JPG or PNG signature.",
      );
    }

    let embeddedImage;
    try {
      const isPng = imageFile.name.toLowerCase().endsWith(".png") || imageFile.bytes[0] === 0x89;
      if (isPng) {
        embeddedImage = await document.embedPng(imageFile.bytes);
      } else {
        embeddedImage = await document.embedJpg(imageFile.bytes);
      }
    } catch (cause) {
      throw new ProcessingError(
        "INVALID_IMAGE",
        "The image file could not be read or embedded.",
        { cause },
      );
    }

    const targetPages = resolveAddImagesPages(options.pages, pageCount);
    for (const pageNumber of targetPages) {
      const page = document.getPage(pageNumber - 1);
      const pageWidth = page.getWidth();
      const pageHeight = page.getHeight();

      const availableWidth = Math.max(10, pageWidth - MARGIN * 2);
      const availableHeight = Math.max(10, pageHeight - MARGIN * 2);

      let effectiveWidth = Math.min(options.width, availableWidth);
      let effectiveHeight = Math.min(options.height, availableHeight);

      if (options.preserveAspectRatio && embeddedImage.width > 0 && embeddedImage.height > 0) {
        const scale = Math.min(
          effectiveWidth / embeddedImage.width,
          effectiveHeight / embeddedImage.height,
        );
        effectiveWidth = Math.max(1, embeddedImage.width * scale);
        effectiveHeight = Math.max(1, embeddedImage.height * scale);
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

      // Clamp bounds
      x = Math.max(MARGIN, Math.min(x, pageWidth - MARGIN - effectiveWidth));
      y = Math.max(MARGIN, Math.min(y, pageHeight - MARGIN - effectiveHeight));

      page.drawImage(embeddedImage, {
        x,
        y,
        width: effectiveWidth,
        height: effectiveHeight,
      });
    }

    stampPdfKitMetadata(document);
    const bytes = await savePdfDocument(document);

    return {
      status: "succeeded",
      artifacts: [
        {
          name: derivedDocumentName(pdfFile.name, "image-added"),
          mimeType: "application/pdf",
          size: bytes.length,
          bytes,
        },
      ],
      meta: {
        pages: pageCount,
        outputPages: pageCount,
        imagePages: targetPages.length,
      },
    };
  }
}

export const addImagesProcessor = new AddImagesProcessor();
