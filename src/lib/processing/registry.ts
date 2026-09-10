import "server-only";

import type { ToolProcessor } from "@/lib/processing/contract";
import { ProcessingError } from "@/lib/processing/errors";
import { createEngineProcessor } from "@/lib/engines/processor";
import { addImagesProcessor } from "@/lib/processing/processors/add-images";
import { addShapesProcessor } from "@/lib/processing/processors/add-shapes";
import { addTextProcessor } from "@/lib/processing/processors/add-text";
import { annotationsProcessor } from "@/lib/processing/processors/annotations";
import { cropProcessor } from "@/lib/processing/processors/crop";
import { drawProcessor } from "@/lib/processing/processors/draw";
import { editPdfMetadataProcessor } from "@/lib/processing/processors/edit-pdf-metadata";
import { flattenPdfProcessor } from "@/lib/processing/processors/flatten-pdf";
import { highlightProcessor } from "@/lib/processing/processors/highlight";
import { pageNumbersProcessor } from "@/lib/processing/processors/page-numbers";
import { passwordProtectProcessor } from "@/lib/processing/processors/password-protect";
import { removeMetadataProcessor } from "@/lib/processing/processors/remove-metadata";
import { watermarkProcessor } from "@/lib/processing/processors/watermark";
import { deletePdfPagesProcessor } from "@/lib/processing/processors/delete-pdf-pages";
import { extractPdfPagesProcessor } from "@/lib/processing/processors/extract-pdf-pages";
import { mergePdfProcessor } from "@/lib/processing/processors/merge-pdf";
import { organizePdfProcessor } from "@/lib/processing/processors/organize-pdf";
import { reorderPdfPagesProcessor } from "@/lib/processing/processors/reorder-pdf-pages";
import { rotatePdfProcessor } from "@/lib/processing/processors/rotate-pdf";
import { splitPdfProcessor } from "@/lib/processing/processors/split-pdf";
import { redactProcessor } from "@/lib/processing/processors/redact";
import { unlockPdfProcessor } from "@/lib/processing/processors/unlock-pdf";

/**
 * Registry of implemented tool processors.
 *
 * This is the authoritative answer to "does this tool actually work?" — a tool
 * may only be marked `AVAILABLE` in the catalog when it has an entry here, and
 * a test enforces that both stay in sync.
 *
 * Since Phase 67, the eleven *conversion* tools (pdf-to-word, pdf-to-excel,
 * pdf-to-text, pdf-to-jpg, pdf-to-png, extract-images, extract-tables,
 * images-to-pdf, png-to-pdf, compress-pdf, compare-documents) map to
 * engine-backed processors: `createEngineProcessor` routes each request
 * through the conversion engine layer (`src/lib/engines`), which in Stage 1
 * always selects the current engine — a thin adapter over the very same
 * processor implementations. Behaviour, API contracts and error semantics
 * are unchanged; see ARCHITECTURE.md §5z.
 */
const PROCESSORS = new Map<string, ToolProcessor<never>>([
  [addImagesProcessor.toolId, addImagesProcessor as ToolProcessor<never>],
  [addShapesProcessor.toolId, addShapesProcessor as ToolProcessor<never>],
  [addTextProcessor.toolId, addTextProcessor as ToolProcessor<never>],
  [annotationsProcessor.toolId, annotationsProcessor as ToolProcessor<never>],
  // Conversion tools — routed through the engine abstraction (Phase 67).
  ["compress-pdf", createEngineProcessor("compress-pdf") as ToolProcessor<never>],
  [cropProcessor.toolId, cropProcessor as ToolProcessor<never>],
  [drawProcessor.toolId, drawProcessor as ToolProcessor<never>],
  [editPdfMetadataProcessor.toolId, editPdfMetadataProcessor as ToolProcessor<never>],
  ["extract-images", createEngineProcessor("extract-images") as ToolProcessor<never>],
  [
    extractPdfPagesProcessor.toolId,
    extractPdfPagesProcessor as ToolProcessor<never>,
  ],
  ["pdf-to-text", createEngineProcessor("pdf-to-text") as ToolProcessor<never>],
  [flattenPdfProcessor.toolId, flattenPdfProcessor as ToolProcessor<never>],
  [highlightProcessor.toolId, highlightProcessor as ToolProcessor<never>],
  ["images-to-pdf", createEngineProcessor("images-to-pdf") as ToolProcessor<never>],
  ["png-to-pdf", createEngineProcessor("png-to-pdf") as ToolProcessor<never>],
  [pageNumbersProcessor.toolId, pageNumbersProcessor as ToolProcessor<never>],
  [passwordProtectProcessor.toolId, passwordProtectProcessor as ToolProcessor<never>],
  [removeMetadataProcessor.toolId, removeMetadataProcessor as ToolProcessor<never>],
  [watermarkProcessor.toolId, watermarkProcessor as ToolProcessor<never>],
  ["pdf-to-jpg", createEngineProcessor("pdf-to-jpg") as ToolProcessor<never>],
  ["pdf-to-png", createEngineProcessor("pdf-to-png") as ToolProcessor<never>],
  ["pdf-to-word", createEngineProcessor("pdf-to-word") as ToolProcessor<never>],
  [deletePdfPagesProcessor.toolId, deletePdfPagesProcessor as ToolProcessor<never>],
  [mergePdfProcessor.toolId, mergePdfProcessor as ToolProcessor<never>],
  [organizePdfProcessor.toolId, organizePdfProcessor as ToolProcessor<never>],
  [
    reorderPdfPagesProcessor.toolId,
    reorderPdfPagesProcessor as ToolProcessor<never>,
  ],
  [rotatePdfProcessor.toolId, rotatePdfProcessor as ToolProcessor<never>],
  [splitPdfProcessor.toolId, splitPdfProcessor as ToolProcessor<never>],
  ["compare-documents", createEngineProcessor("compare-documents") as ToolProcessor<never>],
  ["extract-tables", createEngineProcessor("extract-tables") as ToolProcessor<never>],
  ["pdf-to-excel", createEngineProcessor("pdf-to-excel") as ToolProcessor<never>],
  [redactProcessor.toolId, redactProcessor as ToolProcessor<never>],
  [unlockPdfProcessor.toolId, unlockPdfProcessor as ToolProcessor<never>],
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
