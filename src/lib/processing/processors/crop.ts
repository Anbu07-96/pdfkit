import "server-only";

import { PDFDocument } from "pdf-lib";
import type {
  ProcessingRequest,
  ProcessingSuccess,
  ToolProcessor,
} from "@/lib/processing/contract";
import { ProcessingError } from "@/lib/processing/errors";
import { cropRectangleForPage, parseCropOptions } from "@/lib/processing/crop";
import {
  loadPdfDocument,
  readPageCount,
  savePdfDocument,
  stampPdfKitMetadata,
} from "@/lib/processing/pdf-document";
import { CROP_INPUT_RULES } from "@/lib/processing/rules";
import { resolveRequestedRanges } from "@/lib/processing/processors/page-selection-input";
import { expandPageRanges, formatPageRanges, everyPageRanges } from "@/lib/processing/pages";

/**
 * Crop PDF — CropBox only, never redaction.
 *
 * Sets the visible window of the selected pages and nothing else: MediaBox,
 * content streams, page order, rotation, annotations, links and forms are all
 * untouched, and unselected pages keep their original boxes. Cropped-out
 * content **remains in the file and stays recoverable** — the processor's own
 * verification (and an end-to-end test) proves that text outside the new box
 * still extracts.
 *
 * Validation is reject-never-clamp: the options and the per-page geometry are
 * fully checked **before any page is mutated**, so a request that fails on the
 * last page leaves no partially cropped output.
 */
export class CropProcessor implements ToolProcessor {
  readonly toolId = "crop";
  readonly input = CROP_INPUT_RULES;

  async process(
    request: ProcessingRequest<Record<string, unknown>>,
  ): Promise<ProcessingSuccess> {
    const file = request.files[0];
    if (!file) {
      throw new ProcessingError("VALIDATION_ERROR", "No PDF was uploaded.");
    }

    const parsed = parseCropOptions(request.options ?? {});
    if (!parsed.ok) {
      throw new ProcessingError("INVALID_CROP_CONFIGURATION", parsed.issue.message);
    }
    const options = parsed.options;

    const document = await loadPdfDocument(file.name, file.bytes);
    const pageCount = readPageCount(document, file.name);

    // Page selection reuses the shared model: the raw range string is parsed
    // against the real page count, and overlaps are rejected. An omitted or
    // empty selection means "every page" — the workspace's default.
    const rawRanges =
      typeof request.options?.ranges === "string" && request.options.ranges.trim() !== ""
        ? request.options.ranges
        : undefined;
    const selectedPages = rawRanges
      ? expandPageRanges(resolveRequestedRanges(rawRanges, pageCount))
      : expandPageRanges(everyPageRanges(pageCount));
    const selectionLabel = rawRanges ?? formatPageRanges(everyPageRanges(pageCount));

    // Geometry for every selected page is computed (and rejected) before the
    // first mutation — no partial crops, ever.
    const rectangles = new Map<number, { x: number; y: number; width: number; height: number }>();
    for (const pageNumber of selectedPages) {
      const page = document.getPage(pageNumber - 1);
      const media = page.getMediaBox();
      const result = cropRectangleForPage(options, {
        width: media.width,
        height: media.height,
      });
      if ("issue" in result) {
        throw new ProcessingError(
          "INVALID_CROP_CONFIGURATION",
          result.issue.message,
          { details: [`It does not fit page ${pageNumber}.`] },
        );
      }
      rectangles.set(pageNumber, result.rectangle);
    }

    // Mutate: CropBox only. MediaBox, content and rotation stay as they are.
    for (const [pageNumber, rectangle] of rectangles) {
      document
        .getPage(pageNumber - 1)
        .setCropBox(rectangle.x, rectangle.y, rectangle.width, rectangle.height);
    }

    stampPdfKitMetadata(document);
    const bytes = await savePdfDocument(document);

    // Self-verification: reopen and confirm the boxes landed where intended.
    let verified: boolean;
    try {
      const reloaded = await PDFDocument.load(bytes);
      verified =
        reloaded.getPageCount() === pageCount &&
        [...rectangles].every(([pageNumber, rectangle]) => {
          const box = reloaded.getPage(pageNumber - 1).getCropBox();
          return (
            Math.abs(box.x - rectangle.x) < 0.01 &&
            Math.abs(box.y - rectangle.y) < 0.01 &&
            Math.abs(box.width - rectangle.width) < 0.01 &&
            Math.abs(box.height - rectangle.height) < 0.01
          );
        });
    } catch (cause) {
      throw new ProcessingError(
        "PROCESSING_ERROR",
        "The cropped PDF could not be verified.",
        { cause },
      );
    }
    if (!verified) {
      throw new ProcessingError(
        "PROCESSING_ERROR",
        "The crop boxes could not be applied. Nothing was returned.",
      );
    }

    return {
      status: "succeeded",
      artifacts: [
        {
          // Fixed output name: never carries the source filename.
          name: "crop.pdf",
          mimeType: "application/pdf",
          size: bytes.length,
          bytes,
        },
      ],
      meta: {
        pages: pageCount,
        outputPages: pageCount,
        croppedPages: rectangles.size,
        selection: selectionLabel,
      },
    };
  }
}

export const cropProcessor = new CropProcessor();
