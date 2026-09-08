import { unzipSync, zipSync } from "fflate";

/**
 * Client-side batch ZIP assembly (Phase 61).
 *
 * A bulk batch collects one result per file in the browser; "Download all"
 * bundles them into a single ZIP built right here with fflate (the same
 * library the server uses), so no result is ever uploaded back or written to
 * server disk.
 *
 * Entry naming mirrors the server's `sanitizeZipEntryName`: single-file
 * results become flat entries; archive results (a ZIP per source file, e.g.
 * PDF → JPG) are unpacked and flattened into one folder per source file.
 * Every name — including names that arrive inside a server-produced ZIP — is
 * re-sanitised here, so nothing can smuggle a path, traversal or control
 * character into the download.
 */

export interface BatchZipEntryInput {
  /** Original name of the uploaded source file (for archive folder names). */
  sourceName: string;
  /** Server-provided download name of the result. */
  resultName: string;
  /** Result bytes. */
  blob: Blob;
}

export interface SanitizedBatch {
  files: Record<string, Uint8Array>;
}

/**
 * Defense-in-depth entry caps (Phase 62). The server already bounds what one
 * result may contain (≤200 extracted images, ≤50 rendered pages/outputs), so
 * the legitimate maximum per batch is 100 × 200 = 20,000 entries. Anything
 * beyond these caps means a malformed or hostile archive response, and the
 * batch ZIP build fails loudly instead of trying to unpack it all.
 */
const MAX_ENTRIES_PER_ARCHIVE_RESULT = 2_000;
const MAX_TOTAL_BATCH_ENTRIES = 25_000;

/**
 * Reduce a name to a single safe file name: no directories, no traversal, no
 * control characters, no leading dots, no drive letters — the client-side
 * twin of the server's ZIP entry sanitiser.
 */
export function sanitizeBatchEntryName(name: string, fallback: string): string {
  const withoutPath = name
    .split(/[/\\]/)
    .pop()!
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/^\.+/, "")
    .trim();

  const safe = withoutPath.replace(
    // Unicode letters, numbers and combining marks are preserved (Phase 62:
    // CJK/Cyrillic/Greek filenames no longer degrade to underscores), while
    // path separators, control characters and everything else unsafe stays
    // replaced. Traversal is still impossible: separators are stripped before
    // this runs and leading dots are already gone.
    /[^._()\-\p{L}\p{N}\p{M}]/gu,
    "_",
  );
  if (safe.length === 0 || safe === "." || safe === "..") return fallback;
  return safe.slice(0, 120);
}

/** Strip the final extension: `report.pdf` → `report`. */
function baseName(name: string): string {
  const safe = sanitizeBatchEntryName(name, "document");
  const dot = safe.lastIndexOf(".");
  return dot > 0 ? safe.slice(0, dot) : safe;
}

/** Append `-2`, `-3`, … when a name is already taken. */
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

async function blobBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Flatten successful batch results into ZIP entries.
 *
 * @param flattenArchives when true, archive results are unpacked and their
 * entries placed under `<source>/…`; when false (fallback if unpacking a
 * result fails) the ZIP itself becomes a flat entry.
 */
export async function buildBatchEntries(
  results: readonly BatchZipEntryInput[],
  flattenArchives: boolean,
): Promise<SanitizedBatch> {
  const files: Record<string, Uint8Array> = {};
  const taken = new Set<string>();
  const takenFolders = new Set<string>([""]);

  for (const result of results) {
    if (!flattenArchives) {
      const name = uniqueName(
        sanitizeBatchEntryName(result.resultName, "document"),
        taken,
      );
      files[name] = await blobBytes(result.blob);
      continue;
    }

    // Archive result: unpack (the per-file ZIP the server produced) and put
    // its entries into a folder named after the source document.
    let unzipped: Record<string, Uint8Array>;
    try {
      unzipped = unzipSync(await blobBytes(result.blob));
    } catch {
      // Not a ZIP after all (e.g. a single-page export returns a bare JPG):
      // fall back to a flat entry named after the source.
      const extension = result.resultName.includes(".")
        ? result.resultName.slice(result.resultName.lastIndexOf("."))
        : "";
      const name = uniqueName(
        sanitizeBatchEntryName(`${baseName(result.sourceName)}${extension}`, "document"),
        taken,
      );
      files[name] = await blobBytes(result.blob);
      continue;
    }

    const folder = uniqueName(`${baseName(result.sourceName)}`, takenFolders);
    const inner = new Set<string>();
    const entryNames = Object.entries(unzipped);
    if (entryNames.length > MAX_ENTRIES_PER_ARCHIVE_RESULT) {
      throw new Error(
        `Archive result for ${result.sourceName} contains too many entries (${entryNames.length}).`,
      );
    }
    for (const [entryName, bytes] of entryNames) {
      const safeEntry = `${folder}/${uniqueName(
        sanitizeBatchEntryName(entryName, "file"),
        inner,
      )}`;
      files[safeEntry] = bytes;
    }

    if (Object.keys(files).length > MAX_TOTAL_BATCH_ENTRIES) {
      throw new Error("The batch contains too many result entries to bundle.");
    }
  }

  return { files };
}

/** Build the final "Download all" ZIP blob for a batch. */
export async function buildBatchZipBlob(
  results: readonly BatchZipEntryInput[],
  options: { flattenArchives: boolean; name: string },
): Promise<{ blob: Blob; fileName: string }> {
  const { files } = await buildBatchEntries(results, options.flattenArchives);
  const archive = zipSync(files, { level: 0, mtime: new Date() });
  return {
    blob: new Blob([archive as unknown as BlobPart], { type: "application/zip" }),
    fileName: options.name,
  };
}
