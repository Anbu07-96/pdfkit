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
/** `FF D8 FF` — every JPEG file starts with these three bytes. */
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
/** `89 50 4E 47 0D 0A 1A 0A` — the eight-byte PNG header. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

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

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  for (let index = 0; index < signature.length; index += 1) {
    if (bytes[index] !== signature[index]) return false;
  }
  return true;
}

/** True when the bytes carry a real JPEG (JFIF/Exif/spiff) or PNG header. */
export function hasImageSignature(bytes: Uint8Array): boolean {
  return startsWith(bytes, JPEG_SIGNATURE) || startsWith(bytes, PNG_SIGNATURE);
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

  // A tool may accept fewer files than the global cap (Split PDF takes one).
  const maxFiles = Math.min(limits.maxFiles, rules.maxFiles ?? Number.POSITIVE_INFINITY);
  if (files.length > maxFiles) {
    throw new ProcessingError(
      "TOO_MANY_FILES",
      maxFiles === 1
        ? `This tool works on one file at a time. You sent ${files.length}.`
        : `You can process up to ${maxFiles} files at once. You sent ${files.length}.`,
    );
  }

  const unsupported: string[] = [];
  const oversized: string[] = [];
  const empty: string[] = [];
  const notPdf: string[] = [];
  const checkContent = rules.contentKind === "image" ? hasImageSignature : hasPdfSignature;
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

    // Content check: the bytes must actually look like the declared kind.
    if (!checkContent(file.bytes)) {
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
    if (rules.contentKind === "image") {
      throw new ProcessingError(
        "INVALID_IMAGE",
        "Some files are not valid JPG or PNG images.",
        {
          details: notPdf.map(
            (name) => `${name} does not contain a JPEG or PNG file signature.`,
          ),
        },
      );
    }
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
