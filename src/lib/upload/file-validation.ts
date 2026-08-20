/**
 * Pure, framework-free validation helpers for file selection.
 *
 * This module deliberately knows nothing about React or about document
 * processing: it only answers "may this file be selected for this tool?".
 * Keeping it separate makes it easy to unit test and lets the future
 * processing layer reuse the same rules on the server.
 */

/** Structural subset of the DOM `File` that validation needs. */
export interface FileLike {
  name: string;
  size: number;
  type: string;
}

export type FileRejectionReason =
  | "unsupported-type"
  | "too-large"
  | "empty-file"
  | "too-many-files"
  | "duplicate";

export interface FileConstraints {
  /** Allowed extensions, lower-case and dot-prefixed, e.g. `[".pdf"]`. */
  extensions?: readonly string[];
  /** Allowed MIME types. Used in addition to {@link extensions}. */
  mimeTypes?: readonly string[];
  /** Maximum size of a single file, in bytes. */
  maxFileSize?: number;
  /** Maximum number of files that may be selected in total. */
  maxFiles?: number;
}

export interface FileRejection {
  file: FileLike;
  reason: FileRejectionReason;
  message: string;
}

export interface ValidationResult<T extends FileLike = FileLike> {
  accepted: T[];
  rejected: FileRejection[];
}

/** `"Report.FINAL.pdf"` → `".pdf"`. Returns `""` when there is no extension. */
export function getFileExtension(fileName: string): string {
  const index = fileName.lastIndexOf(".");
  if (index <= 0 || index === fileName.length - 1) return "";
  return fileName.slice(index).toLowerCase();
}

/** Build the `accept` attribute value for an `<input type="file">`. */
export function buildAcceptAttribute(constraints: FileConstraints): string {
  const values = [
    ...(constraints.mimeTypes ?? []),
    ...(constraints.extensions ?? []),
  ];
  return values.join(",");
}

export function isFileTypeAllowed(
  file: FileLike,
  constraints: FileConstraints,
): boolean {
  const { extensions, mimeTypes } = constraints;
  const hasExtensionRule = Boolean(extensions?.length);
  const hasMimeRule = Boolean(mimeTypes?.length);
  if (!hasExtensionRule && !hasMimeRule) return true;

  const extension = getFileExtension(file.name);
  const extensionMatches = hasExtensionRule
    ? extensions!.some((allowed) => allowed.toLowerCase() === extension)
    : false;
  const mimeMatches = hasMimeRule
    ? mimeTypes!.some((allowed) => allowed.toLowerCase() === file.type.toLowerCase())
    : false;

  return extensionMatches || mimeMatches;
}

function fileKey(file: FileLike): string {
  return `${file.name}:${file.size}`;
}

/**
 * Validate a batch of newly selected files against the tool constraints and
 * the files that are already selected.
 */
export function validateFiles<T extends FileLike>(
  files: readonly T[],
  constraints: FileConstraints = {},
  existingFiles: readonly FileLike[] = [],
): ValidationResult<T> {
  const accepted: T[] = [];
  const rejected: FileRejection[] = [];
  const seen = new Set(existingFiles.map(fileKey));

  for (const file of files) {
    if (!isFileTypeAllowed(file, constraints)) {
      rejected.push({
        file,
        reason: "unsupported-type",
        message: `${file.name} is not a supported file type.`,
      });
      continue;
    }

    if (file.size === 0) {
      rejected.push({
        file,
        reason: "empty-file",
        message: `${file.name} is empty.`,
      });
      continue;
    }

    if (
      typeof constraints.maxFileSize === "number" &&
      file.size > constraints.maxFileSize
    ) {
      rejected.push({
        file,
        reason: "too-large",
        message: `${file.name} is larger than the maximum file size.`,
      });
      continue;
    }

    if (seen.has(fileKey(file))) {
      rejected.push({
        file,
        reason: "duplicate",
        message: `${file.name} has already been added.`,
      });
      continue;
    }

    if (
      typeof constraints.maxFiles === "number" &&
      existingFiles.length + accepted.length >= constraints.maxFiles
    ) {
      rejected.push({
        file,
        reason: "too-many-files",
        message: `Only ${constraints.maxFiles} file${
          constraints.maxFiles === 1 ? "" : "s"
        } can be selected.`,
      });
      continue;
    }

    seen.add(fileKey(file));
    accepted.push(file);
  }

  return { accepted, rejected };
}
