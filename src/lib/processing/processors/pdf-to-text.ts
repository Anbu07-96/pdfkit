import "server-only";

import type {
  ProcessingRequest,
  ProcessingSuccess,
  ToolProcessor,
} from "@/lib/processing/contract";
import { ProcessingError } from "@/lib/processing/errors";
import { baseDocumentName } from "@/lib/processing/file-names";
import { PDF_TO_TEXT_INPUT_RULES } from "@/lib/processing/rules";
import { extractPdfPageTexts } from "@/lib/thumbnails/renderer";
import {
  parsePdfToTextOptions,
  resolvePdfToTextPages,
} from "@/lib/processing/pdf-to-text";

export class PdfToTextProcessor implements ToolProcessor {
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

    const { pageCount, texts } = await extractPdfPageTexts(file.bytes, {
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

export const pdfToTextProcessor = new PdfToTextProcessor();
