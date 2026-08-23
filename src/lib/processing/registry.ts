import "server-only";

import type { ToolProcessor } from "@/lib/processing/contract";
import { ProcessingError } from "@/lib/processing/errors";
import { compressPdfProcessor } from "@/lib/processing/processors/compress-pdf";
import { editPdfMetadataProcessor } from "@/lib/processing/processors/edit-pdf-metadata";
import { imagesToPdfProcessor } from "@/lib/processing/processors/images-to-pdf";
import { removeMetadataProcessor } from "@/lib/processing/processors/remove-metadata";
import { pdfToJpgProcessor, pdfToPngProcessor } from "@/lib/processing/processors/pdf-to-image";
import { deletePdfPagesProcessor } from "@/lib/processing/processors/delete-pdf-pages";
import { extractPdfPagesProcessor } from "@/lib/processing/processors/extract-pdf-pages";
import { mergePdfProcessor } from "@/lib/processing/processors/merge-pdf";
import { reorderPdfPagesProcessor } from "@/lib/processing/processors/reorder-pdf-pages";
import { rotatePdfProcessor } from "@/lib/processing/processors/rotate-pdf";
import { splitPdfProcessor } from "@/lib/processing/processors/split-pdf";

/**
 * Registry of implemented tool processors.
 *
 * This is the authoritative answer to "does this tool actually work?" — a tool
 * may only be marked `AVAILABLE` in the catalog when it has an entry here, and
 * a test enforces that both stay in sync.
 */
const PROCESSORS = new Map<string, ToolProcessor<never>>([
  [mergePdfProcessor.toolId, mergePdfProcessor as ToolProcessor<never>],
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
  [editPdfMetadataProcessor.toolId, editPdfMetadataProcessor as ToolProcessor<never>],
  [removeMetadataProcessor.toolId, removeMetadataProcessor as ToolProcessor<never>],
  [pdfToJpgProcessor.toolId, pdfToJpgProcessor as ToolProcessor<never>],
  [pdfToPngProcessor.toolId, pdfToPngProcessor as ToolProcessor<never>],
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
