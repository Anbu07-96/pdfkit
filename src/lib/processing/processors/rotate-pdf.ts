import "server-only";

import { degrees } from "pdf-lib";
import type {
  ProcessingRequest,
  ProcessingSuccess,
  ToolProcessor,
} from "@/lib/processing/contract";
import { ProcessingError } from "@/lib/processing/errors";
import { derivedDocumentName } from "@/lib/processing/file-names";
import {
  addRotations,
  hasRotations,
  parsePageRotations,
  validatePageRotations,
  type PageRotationMap,
} from "@/lib/processing/pages";
import {
  loadPdfDocument,
  readPageCount,
  savePdfDocument,
  stampPdfKitMetadata,
} from "@/lib/processing/pdf-document";
import { ROTATE_PDF_INPUT_RULES } from "@/lib/processing/rules";

/** Options accepted by the Rotate PDF API. */
export interface RotatePdfOptions {
  /**
   * JSON object mapping 1-based page numbers to clockwise rotations, e.g.
   * `{"1":90,"3":180}`. Pages that are absent keep their orientation.
   */
  rotations?: string;
}

/**
 * Rotate pages of one PDF.
 *
 * Rotation is **additive**: the requested angle is added to whatever rotation
 * the page already carries, which is what the interface implies when you press
 * "rotate clockwise" on a page that is already sideways. A page with `/Rotate
 * 90` plus a requested 90° ends up at 180°.
 *
 * Only the `/Rotate` entry is changed — page content is never rasterised or
 * rebuilt, so the output stays a real vector/text PDF with the same pages, in
 * the same order.
 */
export class RotatePdfProcessor implements ToolProcessor<RotatePdfOptions> {
  readonly toolId = "rotate-pdf";
  readonly input = ROTATE_PDF_INPUT_RULES;

  async process(
    request: ProcessingRequest<RotatePdfOptions>,
  ): Promise<ProcessingSuccess> {
    const file = request.files[0];
    if (!file) {
      throw new ProcessingError("VALIDATION_ERROR", "No PDF was uploaded.");
    }

    const document = await loadPdfDocument(file.name, file.bytes);
    const pageCount = readPageCount(document, file.name);
    const rotations = this.resolveRotations(request.options?.rotations, pageCount);

    let rotatedPages = 0;

    for (const [key, requested] of Object.entries(rotations)) {
      if (requested === 0) continue;

      const page = document.getPage(Number(key) - 1);
      // Additive: keep whatever the document already declared.
      const existing = page.getRotation().angle;
      page.setRotation(degrees(addRotations(existing, requested)));
      rotatedPages += 1;
    }

    stampPdfKitMetadata(document);
    const bytes = await savePdfDocument(document);

    return {
      status: "succeeded",
      artifacts: [
        {
          name: derivedDocumentName(file.name, "rotated"),
          mimeType: "application/pdf",
          size: bytes.length,
          bytes,
        },
      ],
      meta: {
        pages: pageCount,
        outputPages: pageCount,
        rotatedPages,
        changed: hasRotations(rotations) ? "yes" : "no",
      },
    };
  }

  /** Parse and validate the requested rotations; never repairs bad input. */
  private resolveRotations(
    raw: string | undefined,
    pageCount: number,
  ): PageRotationMap {
    const parsed = parsePageRotations(raw ?? "");
    if (!parsed.ok) {
      throw new ProcessingError(
        parsed.issue.code === "OUT_OF_RANGE"
          ? "PAGE_OUT_OF_RANGE"
          : "INVALID_PAGE_ROTATION",
        parsed.issue.message,
      );
    }

    const problem = validatePageRotations(parsed.rotations, pageCount);
    if (problem) {
      throw new ProcessingError(
        problem.code === "OUT_OF_RANGE"
          ? "PAGE_OUT_OF_RANGE"
          : "INVALID_PAGE_ROTATION",
        problem.message,
      );
    }

    return parsed.rotations;
  }
}

export const rotatePdfProcessor = new RotatePdfProcessor();
