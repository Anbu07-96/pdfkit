import "server-only";

import { EncryptedPDFError, PDFDocument } from "pdf-lib";
import type {
  ProcessingRequest,
  ProcessingSuccess,
  ToolProcessor,
} from "@/lib/processing/contract";
import { ProcessingError } from "@/lib/processing/errors";
import { MERGE_PDF_INPUT_RULES } from "@/lib/processing/rules";

export interface MergePdfOptions {
  /** File name offered to the browser. Sanitised by the API layer. */
  outputFileName?: string;
}

const DEFAULT_OUTPUT_NAME = "merged.pdf";

/**
 * Merge several PDFs into one, preserving the order the caller supplies.
 *
 * Runs entirely in memory: documents are parsed, their pages copied into a new
 * document, and the result serialised straight back to the caller. Nothing is
 * written to disk and nothing is retained after the request.
 */
export class MergePdfProcessor implements ToolProcessor<MergePdfOptions> {
  readonly toolId = "merge-pdf";
  // Merging needs at least two documents to be meaningful.
  readonly input = MERGE_PDF_INPUT_RULES;

  async process(
    request: ProcessingRequest<MergePdfOptions>,
  ): Promise<ProcessingSuccess> {
    const { files, options } = request;

    const merged = await PDFDocument.create();
    let totalPages = 0;

    // Order matters: iterate exactly in the order the user arranged the files.
    for (const file of files) {
      const source = await loadDocument(file.name, file.bytes);

      // pdf-lib parses lazily: a damaged document often loads fine and only
      // fails when its page tree is touched, so this is guarded too.
      let pageCount: number;
      let pageIndices: number[];
      try {
        pageCount = source.getPageCount();
        pageIndices = source.getPageIndices();
      } catch (cause) {
        throw new ProcessingError("INVALID_PDF", "A PDF could not be read.", {
          details: [`${file.name} could not be read — the file may be damaged.`],
          cause,
        });
      }

      if (pageCount === 0) {
        throw new ProcessingError("INVALID_PDF", "A PDF contains no pages.", {
          details: [`${file.name} has no pages to merge.`],
        });
      }

      let copied;
      try {
        copied = await merged.copyPages(source, pageIndices);
      } catch (cause) {
        throw new ProcessingError(
          "INVALID_PDF",
          "A PDF could not be read completely.",
          {
            details: [`${file.name} could not be merged — the file may be damaged.`],
            cause,
          },
        );
      }

      for (const page of copied) merged.addPage(page);
      totalPages += pageCount;
    }

    // pdf-lib always stamps its own Producer on save, so only Creator is set.
    merged.setCreator("PDFKit");
    merged.setCreationDate(new Date());
    merged.setModificationDate(new Date());

    let bytes: Uint8Array;
    try {
      bytes = await merged.save({ useObjectStreams: true });
    } catch (cause) {
      throw new ProcessingError(
        "PROCESSING_ERROR",
        "The merged PDF could not be created.",
        { cause },
      );
    }

    return {
      status: "succeeded",
      artifacts: [
        {
          name: options?.outputFileName?.trim() || DEFAULT_OUTPUT_NAME,
          mimeType: "application/pdf",
          size: bytes.length,
          bytes,
        },
      ],
      meta: {
        inputFiles: files.length,
        pages: totalPages,
      },
    };
  }
}

/** Parse one document, mapping library failures onto the PDFKit error model. */
async function loadDocument(name: string, bytes: Uint8Array): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes, {
      // Encrypted documents must be reported, not silently mangled.
      ignoreEncryption: false,
      updateMetadata: false,
    });
  } catch (cause) {
    if (isEncryptedPdfError(cause)) {
      throw new ProcessingError(
        "ENCRYPTED_PDF",
        "Password-protected PDFs cannot be merged yet.",
        {
          details: [`${name} is password protected. Unlock it and try again.`],
          cause,
        },
      );
    }

    throw new ProcessingError("INVALID_PDF", "A PDF could not be opened.", {
      details: [`${name} is not a readable PDF document.`],
      cause,
    });
  }
}

/**
 * pdf-lib's error classes are transpiled in a way that breaks `instanceof`
 * across module boundaries, so the message is checked as well.
 */
function isEncryptedPdfError(error: unknown): boolean {
  if (error instanceof EncryptedPDFError) return true;
  const message = error instanceof Error ? error.message : "";
  return /is encrypted/i.test(message);
}

export const mergePdfProcessor = new MergePdfProcessor();
