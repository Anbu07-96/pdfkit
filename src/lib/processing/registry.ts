import "server-only";

import type { ToolProcessor } from "@/lib/processing/contract";
import { ProcessingError } from "@/lib/processing/errors";
import { addImagesProcessor } from "@/lib/processing/processors/add-images";
import { addShapesProcessor } from "@/lib/processing/processors/add-shapes";
import { addTextProcessor } from "@/lib/processing/processors/add-text";
import { annotationsProcessor } from "@/lib/processing/processors/annotations";
import { compressPdfProcessor } from "@/lib/processing/processors/compress-pdf";
import { cropProcessor } from "@/lib/processing/processors/crop";
import { drawProcessor } from "@/lib/processing/processors/draw";
import { editPdfMetadataProcessor } from "@/lib/processing/processors/edit-pdf-metadata";
import { extractImagesProcessor } from "@/lib/processing/processors/extract-images";
import { pdfToTextProcessor } from "@/lib/processing/processors/pdf-to-text";
import { flattenPdfProcessor } from "@/lib/processing/processors/flatten-pdf";
import { highlightProcessor } from "@/lib/processing/processors/highlight";
import {
  imagesToPdfProcessor,
  pngToPdfProcessor,
} from "@/lib/processing/processors/images-to-pdf";
import { pageNumbersProcessor } from "@/lib/processing/processors/page-numbers";
import { passwordProtectProcessor } from "@/lib/processing/processors/password-protect";
import { removeMetadataProcessor } from "@/lib/processing/processors/remove-metadata";
import { watermarkProcessor } from "@/lib/processing/processors/watermark";
import { pdfToJpgProcessor, pdfToPngProcessor } from "@/lib/processing/processors/pdf-to-image";
import { pdfToWordProcessor } from "@/lib/processing/processors/pdf-to-word";
import { deletePdfPagesProcessor } from "@/lib/processing/processors/delete-pdf-pages";
import { extractPdfPagesProcessor } from "@/lib/processing/processors/extract-pdf-pages";
import { mergePdfProcessor } from "@/lib/processing/processors/merge-pdf";
import { organizePdfProcessor } from "@/lib/processing/processors/organize-pdf";
import { reorderPdfPagesProcessor } from "@/lib/processing/processors/reorder-pdf-pages";
import { rotatePdfProcessor } from "@/lib/processing/processors/rotate-pdf";
import { splitPdfProcessor } from "@/lib/processing/processors/split-pdf";
import { compareDocumentsProcessor } from "@/lib/processing/processors/compare-documents";
import { extractTablesProcessor } from "@/lib/processing/processors/extract-tables";
import { pdfToExcelProcessor } from "@/lib/processing/processors/pdf-to-excel";
import { redactProcessor } from "@/lib/processing/processors/redact";
import { unlockPdfProcessor } from "@/lib/processing/processors/unlock-pdf";

/**
 * Registry of implemented tool processors.
 *
 * This is the authoritative answer to "does this tool actually work?" — a tool
 * may only be marked `AVAILABLE` in the catalog when it has an entry here, and
 * a test enforces that both stay in sync.
 */
const PROCESSORS = new Map<string, ToolProcessor<never>>([
  [addImagesProcessor.toolId, addImagesProcessor as ToolProcessor<never>],
  [addShapesProcessor.toolId, addShapesProcessor as ToolProcessor<never>],
  [addTextProcessor.toolId, addTextProcessor as ToolProcessor<never>],
  [annotationsProcessor.toolId, annotationsProcessor as ToolProcessor<never>],
  [drawProcessor.toolId, drawProcessor as ToolProcessor<never>],
  [extractImagesProcessor.toolId, extractImagesProcessor as ToolProcessor<never>],
  [pdfToTextProcessor.toolId, pdfToTextProcessor as ToolProcessor<never>],
  [highlightProcessor.toolId, highlightProcessor as ToolProcessor<never>],
  [mergePdfProcessor.toolId, mergePdfProcessor as ToolProcessor<never>],
  [organizePdfProcessor.toolId, organizePdfProcessor as ToolProcessor<never>],
  [splitPdfProcessor.toolId, splitPdfProcessor as ToolProcessor<never>],
  [
    extractPdfPagesProcessor.toolId,
    extractPdfPagesProcessor as ToolProcessor<never>,
  ],
  [deletePdfPagesProcessor.toolId, deletePdfPagesProcessor as ToolProcessor<never>],
  [
    reorderPdfPagesProcessor.toolId,
    reorderPdfPagesProcessor as ToolProcessor<never>,
  ],
  [rotatePdfProcessor.toolId, rotatePdfProcessor as ToolProcessor<never>],
  [compressPdfProcessor.toolId, compressPdfProcessor as ToolProcessor<never>],
  [imagesToPdfProcessor.toolId, imagesToPdfProcessor as ToolProcessor<never>],
  [pngToPdfProcessor.toolId, pngToPdfProcessor as ToolProcessor<never>],
  [editPdfMetadataProcessor.toolId, editPdfMetadataProcessor as ToolProcessor<never>],
  [removeMetadataProcessor.toolId, removeMetadataProcessor as ToolProcessor<never>],
  [pdfToJpgProcessor.toolId, pdfToJpgProcessor as ToolProcessor<never>],
  [pdfToPngProcessor.toolId, pdfToPngProcessor as ToolProcessor<never>],
  [pdfToWordProcessor.toolId, pdfToWordProcessor as ToolProcessor<never>],
  [watermarkProcessor.toolId, watermarkProcessor as ToolProcessor<never>],
  [pageNumbersProcessor.toolId, pageNumbersProcessor as ToolProcessor<never>],
  [cropProcessor.toolId, cropProcessor as ToolProcessor<never>],
  [flattenPdfProcessor.toolId, flattenPdfProcessor as ToolProcessor<never>],
  [passwordProtectProcessor.toolId, passwordProtectProcessor as ToolProcessor<never>],
  [unlockPdfProcessor.toolId, unlockPdfProcessor as ToolProcessor<never>],
  [redactProcessor.toolId, redactProcessor as ToolProcessor<never>],
  [extractTablesProcessor.toolId, extractTablesProcessor as ToolProcessor<never>],
  [pdfToExcelProcessor.toolId, pdfToExcelProcessor as ToolProcessor<never>],
  [compareDocumentsProcessor.toolId, compareDocumentsProcessor as ToolProcessor<never>],
]);

/** Tool ids with a working implementation. */
export function getImplementedToolIds(): string[] {
  return [...PROCESSORS.keys()].sort();
}

export function hasProcessor(toolId: string): boolean {
  return PROCESSORS.has(toolId);
}

export function findProcessor<TOptions>(
  toolId: string,
): ToolProcessor<TOptions> | undefined {
  return PROCESSORS.get(toolId) as ToolProcessor<TOptions> | undefined;
}

/** Resolve a processor or fail with a safe, structured error. */
export function getProcessor<TOptions>(toolId: string): ToolProcessor<TOptions> {
  const processor = findProcessor<TOptions>(toolId);
  if (!processor) {
    throw new ProcessingError(
      "TOOL_NOT_AVAILABLE",
      "This tool is not available yet.",
    );
  }
  return processor;
}
