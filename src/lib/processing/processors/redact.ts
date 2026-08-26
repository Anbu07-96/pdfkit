import "server-only";

import { rgb } from "pdf-lib";
import type {
  ProcessingContext,
  ProcessingRequest,
  ProcessingSuccess,
  ToolProcessor,
} from "@/lib/processing/contract";
import { ProcessingError } from "@/lib/processing/errors";
import { loadPdfDocument, savePdfDocument } from "@/lib/processing/pdf-document";
import { parseRedactOptions } from "@/lib/processing/redact";
import { baseDocumentName } from "@/lib/processing/file-names";
import { REDACT_INFORMATION_INPUT_RULES } from "@/lib/processing/rules";

function hexToRgb(hex: string) {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.substring(0, 2), 16) / 255;
  const g = parseInt(clean.substring(2, 4), 16) / 255;
  const b = parseInt(clean.substring(4, 6), 16) / 255;
  return rgb(r, g, b);
}

export const redactProcessor: ToolProcessor<Record<string, unknown>> = {
  toolId: "redact-information",
  input: REDACT_INFORMATION_INPUT_RULES,

  async process(
    request: ProcessingRequest<Record<string, unknown>>,
    context: ProcessingContext,
  ): Promise<ProcessingSuccess> {
    if (request.files.length !== 1) {
      throw new ProcessingError(
        "TOO_MANY_FILES",
        "Send exactly one PDF document to redact.",
      );
    }

    const file = request.files[0];
    const doc = await loadPdfDocument(file.name, file.bytes);
    const pageCount = doc.getPageCount();

    if (pageCount > context.limits.maxConversionPages) {
      throw new ProcessingError(
        "TOO_MANY_OUTPUTS",
        `This document has ${pageCount} pages, exceeding the limit of ${context.limits.maxConversionPages}.`,
      );
    }

    const options = parseRedactOptions(request.options, pageCount);
    const color = hexToRgb(options.fillColor);

    const targetIndices = new Set<number>();
    for (const range of options.ranges) {
      for (let i = range.start; i <= range.end; i++) {
        if (i >= 1 && i <= pageCount) {
          targetIndices.add(i - 1);
        }
      }
    }

    let redactedCount = 0;
    for (const index of targetIndices) {
      const page = doc.getPage(index);
      for (const area of options.areas) {
        page.drawRectangle({
          x: area.x,
          y: area.y,
          width: area.width,
          height: area.height,
          color,
        });
      }
      redactedCount++;
    }

    const outputBytes = await savePdfDocument(doc);
    const outputName = `${baseDocumentName(file.name)}-redacted.pdf`;

    return {
      status: "succeeded",
      artifacts: [
        {
          name: outputName,
          mimeType: "application/pdf",
          size: outputBytes.length,
          bytes: outputBytes,
        },
      ],
      meta: {
        pages: pageCount,
        redactedPages: redactedCount,
      },
    };
  },
};
