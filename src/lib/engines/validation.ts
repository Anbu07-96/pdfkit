import "server-only";

import type { ProcessingArtifact } from "@/lib/processing/contract";
import { hasPdfSignature } from "@/lib/processing/validation/pdf-input";
import type { EngineResult, OutputValidationState } from "@/lib/engines/types";

/**
 * Structural output validation (Phase 68, Stage 2).
 *
 * Answers ONE question per produced artifact: *is this structurally valid?*
 * It does NOT answer "is this a good conversion of the source?" — fidelity,
 * text-yield, layout and OCR-quality judgements are the Stage 3 QualityGate
 * and are deliberately absent here.
 *
 * ## What it checks
 *
 * | Output class | Checks                                            |
 * | ------------ | ------------------------------------------------- |
 * | PDF          | `%PDF-` signature, `%%EOF` trailer                |
 * | DOCX         | ZIP container, required Office parts              |
 * | XLSX         | ZIP container, required Office parts              |
 * | ZIP          | ZIP container (central directory readable)        |
 * | PNG          | signature + IHDR-first, chunk walk reaches IEND   |
 * | JPEG         | SOI signature, EOI marker                         |
 * | text/*       | non-empty bytes                                   |
 * | unknown      | non-empty + name sanity only → `not-evaluated`    |
 *
 * All checks read bytes that are already in memory and never decompress,
 * re-render or re-parse documents through pdfium/pdf-lib — a full PDF
 * re-parse is a deliberate deferral (see ARCHITECTURE.md §5z).
 *
 * ## Diagnostic only — never a gate
 *
 * `validateEngineResult` records its verdict on `EngineResult.validation`
 * and NEVER throws and never fails a job: if a check fails, the conversion
 * result is returned exactly as the processor produced it. Existing
 * tool-local validators (pdf-to-word's throwing DOCX check, unlock-pdf's
 * re-open verification, password-protect's encryption verification) remain
 * the authoritative, behavior-defining checks and are untouched. This layer
 * observes; Stage 3 will decide.
 */

/** Structural check identifiers — safe to log (never content-bearing). */
export type OutputCheckId =
  | "output-count-valid"
  | "non-empty"
  | "artifact-name-valid"
  | "pdf-signature"
  | "pdf-eof"
  | "zip-container"
  | "zip-required-parts"
  | "png-signature"
  | "png-chunk-structure"
  | "jpeg-signature"
  | "jpeg-eoi"
  | "text-non-empty";

/** Output classes the validator understands, by artifact MIME type. */
export type OutputClass =
  | "pdf"
  | "docx"
  | "xlsx"
  | "zip"
  | "png"
  | "jpeg"
  | "text"
  | "unknown";

const DOCX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Office parts required in each container (mirrors the tool-local rules). */
const REQUIRED_PARTS: Partial<Record<OutputClass, readonly string[]>> = {
  docx: ["[Content_Types].xml", "word/document.xml"],
  xlsx: ["[Content_Types].xml", "xl/workbook.xml"],
};

/** Classify an artifact by its (server-generated, trusted) MIME type. */
export function detectOutputClass(artifact: ProcessingArtifact): OutputClass {
  const mimeType = artifact.mimeType.toLowerCase();
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType === DOCX_MIME_TYPE) return "docx";
  if (mimeType === XLSX_MIME_TYPE) return "xlsx";
  if (mimeType === "application/zip") return "zip";
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/jpeg") return "jpeg";
  if (mimeType.startsWith("text/")) return "text";
  return "unknown";
}

/* ------------------------------------------------------------------ */
/* Byte-reading helpers (all bounded, no allocation of document-sized  */
/* buffers beyond a small decode window for ZIP entry names).          */
/* ------------------------------------------------------------------ */

function hasPrefix(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  for (let index = 0; index < signature.length; index += 1) {
    if (bytes[index] !== signature[index]) return false;
  }
  return true;
}

const ASCII_EOF = [0x25, 0x25, 0x45, 0x4f, 0x46]; // %%EOF
const PDF_EOF_SEARCH_WINDOW = 2048;

/** `%%EOF` within the trailing bytes (pdf-lib may append a newline). */
function hasPdfEofMarker(bytes: Uint8Array): boolean {
  const start = Math.max(0, bytes.length - PDF_EOF_SEARCH_WINDOW);
  outer: for (let offset = start; offset + ASCII_EOF.length <= bytes.length; offset += 1) {
    for (let index = 0; index < ASCII_EOF.length; index += 1) {
      if (bytes[offset + index] !== ASCII_EOF[index]) continue outer;
    }
    return true;
  }
  return false;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SOI = [0xff, 0xd8, 0xff];
const MAX_PNG_CHUNKS = 100_000;

/** PNG structure: signature, IHDR first, and a chunk walk that reaches IEND. */
function isPngStructurallyValid(bytes: Uint8Array): boolean {
  if (!hasPrefix(bytes, PNG_SIGNATURE)) return false;
  // The first chunk must be the 13-byte IHDR header.
  if (bytes.length < 8 + 8 + 13) return false;
  if (
    bytes[12] !== 0x49 || bytes[13] !== 0x48 ||
    bytes[14] !== 0x44 || bytes[15] !== 0x52
  ) {
    return false; // "IHDR"
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let chunks = 0;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) return false;
    const dataLength = view.getUint32(offset);
    const isIend =
      bytes[offset + 4] === 0x49 && bytes[offset + 5] === 0x45 &&
      bytes[offset + 6] === 0x4e && bytes[offset + 7] === 0x44; // "IEND"
    if (isIend) return true;
    if (dataLength > 0x7fffffff) return false;
    offset += 12 + dataLength;
    chunks += 1;
    if (chunks > MAX_PNG_CHUNKS) return false;
  }
  return false; // ran out of bytes without an IEND
}

/** JPEG structure: SOI at the start, EOI marker as the final two bytes. */
function isJpegStructurallyValid(bytes: Uint8Array): boolean {
  if (!hasPrefix(bytes, JPEG_SOI)) return false;
  if (bytes.length < 4) return false;
  return (
    bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9
  );
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_ENTRY_SIGNATURE = 0x02014b50;
const MAX_ZIP_COMMENT = 65_535;

/**
 * Read ZIP entry names from the central directory — container validation
 * WITHOUT decompressing anything (unlike `unzipSync`, this cannot be made
 * to allocate decompressed data). Returns `undefined` when the container is
 * not a readable ZIP.
 */
export function readZipEntryNames(bytes: Uint8Array): string[] | undefined {
  if (bytes.length < 22) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = bytes.length;

  // Find the End-Of-Central-Directory record (scan backwards, bounded by
  // the maximum ZIP comment length).
  const minStart = Math.max(0, length - 22 - MAX_ZIP_COMMENT);
  let eocd = -1;
  for (let offset = length - 22; offset >= minStart; offset -= 1) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) return undefined;

  const entryCount = view.getUint16(eocd + 10, true);
  let position = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const names: string[] = [];

  for (let index = 0; index < entryCount; index += 1) {
    if (position + 46 > length) return undefined;
    if (view.getUint32(position, true) !== CENTRAL_ENTRY_SIGNATURE) {
      return undefined;
    }
    const nameLength = view.getUint16(position + 28, true);
    const extraLength = view.getUint16(position + 30, true);
    const commentLength = view.getUint16(position + 32, true);
    if (position + 46 + nameLength > length) return undefined;
    names.push(
      decoder.decode(bytes.subarray(position + 46, position + 46 + nameLength)),
    );
    position += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

/** Artifact names must be non-empty, path-free and control-character-free. */
function isArtifactNameValid(name: string): boolean {
  if (typeof name !== "string" || name.length === 0 || name.length > 500) {
    return false;
  }
  if (name.includes("/") || name.includes("\\")) return false;
  for (let index = 0; index < name.length; index += 1) {
    const code = name.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}

export interface ArtifactValidation {
  /** False when at least one structural check failed. */
  readonly valid: boolean;
  /**
   * True when the artifact passed every check we can perform but its output
   * class has no structural checks (unknown MIME) — honest "not-evaluated".
   */
  readonly indeterminate: boolean;
  /** Every check performed, in order (passed and failed alike). */
  readonly checks: readonly OutputCheckId[];
}

/** Structurally validate one produced artifact. Never throws. */
export function validateArtifact(artifact: ProcessingArtifact): ArtifactValidation {
  const checks: OutputCheckId[] = [];
  let valid = true;

  checks.push("non-empty");
  const hasBytes = artifact.bytes.length > 0;
  if (!hasBytes) valid = false;

  checks.push("artifact-name-valid");
  if (!isArtifactNameValid(artifact.name)) valid = false;

  const outputClass = detectOutputClass(artifact);
  const bytes = artifact.bytes;

  switch (outputClass) {
    case "pdf": {
      checks.push("pdf-signature", "pdf-eof");
      if (!hasPdfSignature(bytes) || !hasPdfEofMarker(bytes)) valid = false;
      break;
    }
    case "docx":
    case "xlsx": {
      checks.push("zip-container", "zip-required-parts");
      const names = readZipEntryNames(bytes);
      if (names === undefined) {
        valid = false;
      } else {
        const required = REQUIRED_PARTS[outputClass] ?? [];
        if (!required.every((part) => names.includes(part))) valid = false;
      }
      break;
    }
    case "zip": {
      checks.push("zip-container");
      const names = readZipEntryNames(bytes);
      if (names === undefined || names.length === 0) valid = false;
      break;
    }
    case "png": {
      checks.push("png-signature", "png-chunk-structure");
      if (!isPngStructurallyValid(bytes)) valid = false;
      break;
    }
    case "jpeg": {
      checks.push("jpeg-signature", "jpeg-eoi");
      if (!isJpegStructurallyValid(bytes)) valid = false;
      break;
    }
    case "text": {
      checks.push("text-non-empty");
      if (!hasBytes) valid = false;
      break;
    }
    case "unknown": {
      // No structural checks exist for this output class. If the basic
      // checks passed, report "not-evaluated" rather than a hollow pass.
      return { valid, indeterminate: valid, checks };
    }
  }

  return { valid, indeterminate: false, checks };
}

/**
 * Validate an engine outcome and return the same result with
 * `validation` filled in. Diagnostic only: a `failed` verdict NEVER throws
 * and never changes the artifacts — the caller returns the result as-is.
 */
export function validateEngineResult(result: EngineResult): EngineResult {
  if (result.artifacts.length === 0) {
    return {
      ...result,
      validation: { status: "failed", checks: ["output-count-valid"] },
    };
  }

  const checks: OutputCheckId[] = ["output-count-valid"];
  let failed = false;
  let indeterminate = false;

  for (const artifact of result.artifacts) {
    const validation = validateArtifact(artifact);
    checks.push(...validation.checks);
    if (!validation.valid) failed = true;
    else if (validation.indeterminate) indeterminate = true;
  }

  let validation: OutputValidationState;
  if (failed) {
    validation = { status: "failed", checks };
  } else if (indeterminate) {
    validation = { status: "not-evaluated" };
  } else {
    validation = { status: "passed", checks };
  }

  return { ...result, validation };
}
