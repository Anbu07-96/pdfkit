import "server-only";

import { degrees, PDFDocument } from "pdf-lib";
import type {
  ProcessingRequest,
  ProcessingSuccess,
  ToolProcessor,
} from "@/lib/processing/contract";
import { ProcessingError, type ProcessingErrorCode } from "@/lib/processing/errors";
import { derivedDocumentName } from "@/lib/processing/file-names";
import { addRotations } from "@/lib/processing/pages";
import {
  copyPagesInto,
  loadPdfDocument,
  readPageCount,
  savePdfDocument,
  stampPdfKitMetadata,
} from "@/lib/processing/pdf-document";
import { ORGANIZE_PDF_INPUT_RULES } from "@/lib/processing/rules";
import { parseOrganizePdfOptions } from "@/lib/processing/organize-pdf";

export class OrganizePdfProcessor implements ToolProcessor {
  readonly toolId = "organize-pdf";
  readonly input = ORGANIZE_PDF_INPUT_RULES;

  async process(
    request: ProcessingRequest<Record<string, unknown>>,
  ): Promise<ProcessingSuccess> {
    const file = request.files[0];
    if (!file) {
      throw new ProcessingError("VALIDATION_ERROR", "No PDF was uploaded.");
    }

    const source = await loadPdfDocument(file.name, file.bytes);
    const pageCount = readPageCount(source, file.name);

    const parsed = parseOrganizePdfOptions(request.options ?? {}, pageCount);
    if (!parsed.ok) {
      const code = (parsed.issue.code ?? "VALIDATION_ERROR") as ProcessingErrorCode;
      throw new ProcessingError(code, parsed.issue.message);
    }
    const { order, rotations } = parsed.options;

    const output = await PDFDocument.create();

    // 1-based order → 0-based indices in exact requested sequence
    await copyPagesInto(
      output,
      source,
      order.map((page) => page - 1),
      file.name,
    );

    // Apply rotations
    let rotatedCount = 0;
    for (let index = 0; index < order.length; index += 1) {
      const originalPageNumber = order[index]!;
      const requestedRotation = rotations[originalPageNumber] ?? 0;
      if (requestedRotation !== 0) {
        const page = output.getPage(index);
        const existing = page.getRotation().angle;
        page.setRotation(degrees(addRotations(existing, requestedRotation)));
        rotatedCount += 1;
      }
    }

    stampPdfKitMetadata(output);
    const bytes = await savePdfDocument(output);

    return {
      status: "succeeded",
      artifacts: [
        {
          name: derivedDocumentName(file.name, "organized"),
          mimeType: "application/pdf",
          size: bytes.length,
          bytes,
        },
      ],
      meta: {
        pages: pageCount,
        outputPages: order.length,
        deletedPages: pageCount - order.length,
        rotatedPages: rotatedCount,
      },
    };
  }
}

export const organizePdfProcessor = new OrganizePdfProcessor();
