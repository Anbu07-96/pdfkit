import "server-only";

import { zipSync } from "fflate";
import { ProcessingError } from "@/lib/processing/errors";

/**
 * ZIP bundling for jobs that produce several documents.
 *
 * Delivery concern only: processors return artifacts, and the HTTP layer
 * decides whether to stream one file or bundle many. Entry names are
 * sanitised here so a document name can never become a path.
 */

export interface ZipEntry {
  name: string;
  bytes: Uint8Array;
}

/**
 * Reduce a name to a single safe file name: no directories, no traversal, no
 * control characters, no leading dots, no drive letters.
 */
export function sanitizeZipEntryName(name: string, fallback: string): string {
  const withoutPath = name
    // Drop everything before the last separator: `../a/b.pdf` → `b.pdf`,
    // `C:\server\x.pdf` → `x.pdf`.
    .split(/[/\\]/)
    .pop()!
    // Strip control characters.
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/^\.+/, "")
    .trim();

  const safe = withoutPath.replace(/[^A-Za-z0-9._()\-\u00c0-\u024f]/g, "_");
  if (safe.length === 0 || safe === "." || safe === "..") return fallback;
  return safe.slice(0, 120);
}

/** Append `-2`, `-3`, … when a sanitised name is already taken. */
function uniqueName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) {
    taken.add(name);
    return name;
  }

  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : "";

  let counter = 2;
  let candidate = `${base}-${counter}${extension}`;
  while (taken.has(candidate)) {
    counter += 1;
    candidate = `${base}-${counter}${extension}`;
  }
  taken.add(candidate);
  return candidate;
}

/**
 * Build a ZIP archive in memory.
 *
 * Stored (level 0) rather than deflated: the entries are PDFs that pdf-lib has
 * already compressed, so deflating them again costs CPU and memory for almost
 * no size benefit.
 */
export function createZipArchive(entries: readonly ZipEntry[]): Uint8Array {
  if (entries.length === 0) {
    throw new ProcessingError("PROCESSING_ERROR", "No documents were produced.");
  }

  const taken = new Set<string>();
  const files: Record<string, Uint8Array> = {};

  entries.forEach((entry, index) => {
    const safe = uniqueName(
      sanitizeZipEntryName(entry.name, `document-${index + 1}.pdf`),
      taken,
    );
    files[safe] = entry.bytes;
  });

  try {
    return zipSync(files, { level: 0, mtime: new Date() });
  } catch (cause) {
    throw new ProcessingError(
      "PROCESSING_ERROR",
      "The download archive could not be created.",
      { cause },
    );
  }
}
