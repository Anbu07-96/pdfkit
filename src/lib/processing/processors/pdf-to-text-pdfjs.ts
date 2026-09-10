import "server-only";

import type {
  ProcessingRequest,
  ProcessingSuccess,
  ToolProcessor,
} from "@/lib/processing/contract";
import { ProcessingError } from "@/lib/processing/errors";
import { baseDocumentName } from "@/lib/processing/file-names";
import { PDF_TO_TEXT_INPUT_RULES } from "@/lib/processing/rules";
import { extractPdfjsTextPages } from "@/lib/processing/pdfjs/positioned-text";
import {
  parsePdfToTextOptions,
  resolvePdfToTextPages,
} from "@/lib/processing/pdf-to-text";

/**
 * PDF → Text via Mozilla PDF.js — the Phase 73 ALTERNATIVE engine
 * ("pdfjs-text").
 *
 * This processor is a contract mirror of `pdf-to-text.ts` (pdfium): the
 * SAME input rules (borrowed, never redefined), the SAME option parsing,
 * the SAME output artifact naming, page markers, no-text placeholders,
 * control-character cleanup and meta keys. Only the extraction component
 * differs: positioned text items reconstructed in reading order (see
 * `src/lib/processing/pdfjs/positioned-text.ts`) instead of pdfium's
 * per-page plain text.
 *
 * Known, documented behavioral differences vs the pdfium engine (Phase 72
 * evidence, Phase 73 compatibility rules — docs/pdfjs-text-engine.md):
 *
 * - the micro sign `µ` may normalize to Greek `μ` (Rule A: accepted engine
 *   difference, no forced re-normalization);
 * - text whose glyphs extend past the page boundary may be clipped
 *   (Rule B: pdfium's behavior remains the compatibility baseline).
 *
 * There is deliberately NO fallback to pdfium here: if this engine is
 * selected and fails, the typed error propagates (Phase 73 §12).
 */
export class PdfToTextPdfjsProcessor implements ToolProcessor {
  readonly toolId = "pdf-to-text";
  readonly input = PDF_TO_TEXT_INPUT_RULES;

  async process(
    request: ProcessingRequest<Record<string, unknown>>,
    context: { limits: { maxConversionPages: number } },
  ): Promise<ProcessingSuccess> {
    const file = request.files[0];
    if (!file) {
      throw new ProcessingError("VALIDATION_ERROR", "No PDF was uploaded.");
    }

    const parsed = parsePdfToTextOptions(request.options ?? {});
    if (!parsed.ok) {
      throw new ProcessingError("VALIDATION_ERROR", parsed.issue.message);
    }
    const options = parsed.options;

    const { pageCount, texts } = await extractPdfjsTextPages(file.bytes, {
      maxPages: context.limits.maxConversionPages,
    });

    const targetPages = resolvePdfToTextPages(options.pages, pageCount);
    const pageOutputs: string[] = [];

    for (const pageNumber of targetPages) {
      const rawText = texts[pageNumber - 1] ?? "";
      const cleanedText = rawText
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
        .trim();

      const header = `--- Page ${pageNumber} ---`;
      if (cleanedText.length > 0) {
        pageOutputs.push(`${header}\n${cleanedText}`);
      } else {
        pageOutputs.push(`${header}\n[Page ${pageNumber} contains no extractable text]`);
      }
    }

    const fullText = pageOutputs.join("\n\n");
    const bytes = new TextEncoder().encode(fullText);

    return {
      status: "succeeded",
      artifacts: [
        {
          name: `${baseDocumentName(file.name)}-text.txt`,
          mimeType: "text/plain; charset=utf-8",
          size: bytes.length,
          bytes,
        },
      ],
      meta: {
        pages: pageCount,
        outputPages: targetPages.length,
        extractedPages: targetPages.length,
      },
    };
  }
}

export const pdfToTextPdfjsProcessor = new PdfToTextPdfjsProcessor();
