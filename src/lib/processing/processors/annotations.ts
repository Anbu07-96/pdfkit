import "server-only";

import { PDFArray, PDFHexString, PDFName, PDFString } from "pdf-lib";
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
import { ANNOTATIONS_INPUT_RULES } from "@/lib/processing/rules";
import {
  parseAnnotationsOptions,
  resolveAnnotationPages,
} from "@/lib/processing/annotations";

const MARGIN = 36;

export class AnnotationsProcessor implements ToolProcessor {
  readonly toolId = "annotations";
  readonly input = ANNOTATIONS_INPUT_RULES;

  async process(
    request: ProcessingRequest<Record<string, unknown>>,
  ): Promise<ProcessingSuccess> {
    const file = request.files[0];
    if (!file) {
      throw new ProcessingError("VALIDATION_ERROR", "No PDF was uploaded.");
    }

    const parsed = parseAnnotationsOptions(request.options ?? {});
    if (!parsed.ok) {
      throw new ProcessingError("INVALID_ANNOTATION_CONFIGURATION", parsed.issue.message);
    }
    const options = parsed.options;

    const document = await loadPdfDocument(file.name, file.bytes);
    const pageCount = readPageCount(document, file.name);

    const targetPages = resolveAnnotationPages(options.pages, pageCount);
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

      // Clamp bounds
      x = Math.max(MARGIN, Math.min(x, pageWidth - MARGIN - effectiveWidth));
      y = Math.max(MARGIN, Math.min(y, pageHeight - MARGIN - effectiveHeight));

      const rect = [x, y, x + effectiveWidth, y + effectiveHeight];

      let annotObj;
      if (options.type === "comment") {
        annotObj = document.context.obj({
          Type: "Annot",
          Subtype: "Text",
          Rect: rect,
          Contents: PDFHexString.fromText(options.text),
          Name: "Comment",
          C: [1, 0.9, 0],
          ...(options.author ? { T: PDFHexString.fromText(options.author) } : {}),
          Open: false,
        });
      } else {
        annotObj = document.context.obj({
          Type: "Annot",
          Subtype: "Link",
          Rect: rect,
          A: {
            Type: "Action",
            S: "URI",
            URI: PDFString.of(options.url),
          },
          Border: [0, 0, 1],
          C: [0, 0.4, 0.8],
        });
      }

      const annotRef = document.context.register(annotObj);

      let annots = page.node.get(PDFName.of("Annots"));
      if (!annots) {
        annots = document.context.obj([]);
        page.node.set(PDFName.of("Annots"), annots);
      }
      const annotsArray = document.context.lookup(annots);
      if (annotsArray instanceof PDFArray) {
        annotsArray.push(annotRef);
      }
    }

    stampPdfKitMetadata(document);
    const bytes = await savePdfDocument(document);

    return {
      status: "succeeded",
      artifacts: [
        {
          name: derivedDocumentName(file.name, "annotated"),
          mimeType: "application/pdf",
          size: bytes.length,
          bytes,
        },
      ],
      meta: {
        pages: pageCount,
        outputPages: pageCount,
        annotatedPages: targetPages.length,
        annotationCount: targetPages.length,
      },
    };
  }
}

export const annotationsProcessor = new AnnotationsProcessor();
