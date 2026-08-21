import "server-only";

import { ProcessingError } from "@/lib/processing/errors";
import type { ProcessingLimits } from "@/lib/processing/limits";
import type { ProcessingInputFile, ProcessorInputRules } from "@/lib/processing/contract";
import { formatBytes } from "@/lib/utils/format";

/**
 * Server-side input validation.
 *
 * Everything here runs **before** a single byte reaches the PDF parser: counts,
 * sizes, extensions and the actual file signature. Nothing the browser claims
 * about a file (its name, extension or MIME type) is trusted on its own.
 */

/** `%PDF-` — the header every PDF must contain. */
const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d]; // % P D F -

/**
 * Some real-world PDFs carry a small amount of leading junk before the header,
 * and readers tolerate it, so the signature is searched for in the first KiB
 * rather than only at offset 0.
 */
const SIGNATURE_SEARCH_WINDOW = 1024;

export function hasPdfSignature(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length, SIGNATURE_SEARCH_WINDOW);
  outer: for (let offset = 0; offset + PDF_SIGNATURE.length <= limit; offset += 1) {
    for (let index = 0; index < PDF_SIGNATURE.length; index += 1) {
      if (bytes[offset + index] !== PDF_SIGNATURE[index]) continue outer;
    }
    return true;
  }
  return false;
}

function extensionOf(name: string): string {
  const index = name.lastIndexOf(".");
  return index > 0 ? name.slice(index).toLowerCase() : "";
}

export interface ValidateInputOptions {
  files: ProcessingInputFile[];
  rules: ProcessorInputRules;
  limits: ProcessingLimits;
}

/**
 * Validate a job's input files, throwing the first problem found as a
 * `ProcessingError`. Invalid files are never silently skipped.
 */
export function validateProcessingInput({
  files,
  rules,
  limits,
}: ValidateInputOptions): void {
  if (files.length === 0) {
    throw new ProcessingError("VALIDATION_ERROR", "No files were uploaded.");
  }

  if (files.length < rules.minFiles) {
    throw new ProcessingError(
      "VALIDATION_ERROR",
      `This tool needs at least ${rules.minFiles} files. You sent ${files.length}.`,
    );
  }

  if (files.length > limits.maxFiles) {
    throw new ProcessingError(
      "TOO_MANY_FILES",
      `You can process up to ${limits.maxFiles} files at once. You sent ${files.length}.`,
    );
  }

  const unsupported: string[] = [];
  const oversized: string[] = [];
  const empty: string[] = [];
  const notPdf: string[] = [];
  let totalSize = 0;

  for (const file of files) {
    const extension = extensionOf(file.name);
    const extensionAllowed = rules.extensions.includes(extension);
    const mimeAllowed =
      file.mimeType === "" || rules.mimeTypes.includes(file.mimeType.toLowerCase());

    if (!extensionAllowed || !mimeAllowed) {
      unsupported.push(file.name);
      continue;
    }

    if (file.size === 0 || file.bytes.length === 0) {
      empty.push(file.name);
      continue;
    }

    if (file.bytes.length > limits.maxFileSize) {
      oversized.push(file.name);
      continue;
    }

    // Content check: the bytes must actually look like a PDF.
    if (!hasPdfSignature(file.bytes)) {
      notPdf.push(file.name);
      continue;
    }

    totalSize += file.bytes.length;
  }

  if (unsupported.length > 0) {
    throw new ProcessingError(
      "UNSUPPORTED_FILE",
      `Only ${rules.extensions.join(", ")} files are supported.`,
      { details: unsupported.map((name) => `${name} is not a supported file type.`) },
    );
  }

  if (empty.length > 0) {
    throw new ProcessingError("VALIDATION_ERROR", "Some files are empty.", {
      details: empty.map((name) => `${name} is empty.`),
    });
  }

  if (oversized.length > 0) {
    throw new ProcessingError(
      "FILE_TOO_LARGE",
      `Each file must be ${formatBytes(limits.maxFileSize, 0)} or smaller.`,
      {
        details: oversized.map(
          (name) => `${name} is larger than ${formatBytes(limits.maxFileSize, 0)}.`,
        ),
      },
    );
  }

  if (notPdf.length > 0) {
    throw new ProcessingError(
      "INVALID_PDF",
      "Some files are not valid PDF documents.",
      {
        details: notPdf.map(
          (name) => `${name} does not contain a PDF file signature.`,
        ),
      },
    );
  }

  if (totalSize > limits.maxTotalSize) {
    throw new ProcessingError(
      "TOTAL_SIZE_EXCEEDED",
      `The total upload must be ${formatBytes(limits.maxTotalSize, 0)} or smaller. Yours is ${formatBytes(totalSize)}.`,
    );
  }
}
