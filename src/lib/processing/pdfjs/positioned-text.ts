import "server-only";

import { ProcessingError } from "@/lib/processing/errors";

/**
 * PDF.js positioned-text extraction — the shared core of the Phase 73
 * alternative PDF → text engine (`pdfjs-text`).
 *
 * This module is the ONE place that talks to `pdfjs-dist` in production.
 * The Phase 72 benchmark-only candidate adapter now delegates here as well,
 * so the benchmark measures the production algorithm (dependency direction
 * stays benchmarks → production; an isolation test enforces that nothing
 * else in production imports pdfjs-dist).
 *
 * Server-side, in-process discipline (Phase 73 §4, §18–§20):
 *
 * - **No network, no CDN, no dynamic external resources.** The loading call
 *   passes only the copied byte buffer; PDF.js's bundled local `cmaps/`
 *   and `standard_fonts/` directories are NOT configured, so PDF.js never
 *   fetches anything. Consequences, documented honestly: PDFs whose fonts
 *   rely on *predefined* CMaps without an embedded ToUnicode map (some CJK
 *   producers) may extract partially or degrade; documents with a ToUnicode
 *   CMap (what pdf-lib and most modern producers embed) extract normally.
 * - **No worker processes.** Under Node, the pdfjs legacy build runs its
 *   "fake worker" on the main thread of this process — there is no separate
 *   worker process, thread pool or child process, and none is created.
 * - **Cleanup is guaranteed on every completion path** — including a
 *   rejected loading promise (the Phase 72 cleanup bug, fixed there and
 *   regression-tested here): `task.destroy()` runs in a `finally` block.
 * - **Bounded processing**: the input buffer is copied (PDF.js detaches the
 *   buffer it is given), the page count is checked against the caller's
 *   limit, and a defensive per-page text-item cap bounds reconstruction
 *   memory.
 * - **Deterministic reconstruction** (Phase 72 algorithm, productionized):
 *   y-bucket grouping (2-unit buckets), x-sort per line, column split on a
 *   documented 60-unit gap. Complexity is O(N log N) for N text items
 *   (Map bucketing O(N); sorting each bucket; no quadratic scans) — see
 *   `reconstructPdfjsLines`.
 * - **No content leaves this module except the extracted text artifacts'
 *   bytes**: errors are typed `ProcessingError`s with static messages — no
 *   PDF.js stack traces, no source text, no filenames, no metadata.
 */

/** Y-bucket granularity in PDF units: baselines within 2 units are one line. */
export const Y_BUCKET_UNITS = 2;

/**
 * Horizontal gap (PDF units) above which two text runs on the same visual
 * line are treated as separate columns. Calibrated in Phase 72: a single
 * space at 12 pt Helvetica spans ~3.3 units; table cell separators ~10;
 * column gutters 60+. This is a general geometric constant, NOT tuned to
 * any benchmark fixture id or marker.
 */
export const COLUMN_GAP_UNITS = 60;

/**
 * Defensive per-page text-item cap. The upload size limit and conversion
 * page limit already bound the input; this cap bounds the in-memory item
 * array a single adversarial page may force into reconstruction. A page
 * with a quarter-million positioned text items is beyond any real document
 * shape within the upload envelope; exceeding it fails with a typed error
 * instead of unbounded allocation.
 */
export const MAX_TEXT_ITEMS_PER_PAGE = 250_000;

/** A positioned text item as the reconstruction algorithm consumes it. */
export interface PositionedTextItem {
  readonly str: string;
  readonly x: number;
  readonly y: number;
  /** Reported run width in PDF units, when PDF.js provides it. */
  readonly width?: number;
}

/** The minimal PDF.js page surface this module relies on. */
interface PdfjsPage {
  getTextContent(): Promise<{ items: readonly unknown[] }>;
  cleanup(): void;
}

/** The minimal PDF.js document surface this module relies on. */
export interface PdfjsDocumentHandle {
  readonly numPages: number;
  getPage(pageNumber: number): Promise<PdfjsPage>;
}

/** A PDF.js loading task (destroy() releases the parsed document). */
export interface PdfjsLoadingTask {
  readonly promise: Promise<PdfjsDocumentHandle>;
  destroy(): Promise<void>;
}

/** Injectable document loader — tests substitute a mock here. */
export type PdfjsDocumentLoader = (data: Uint8Array) => Promise<PdfjsLoadingTask>;

/**
 * Default loader: the real pdfjs-dist legacy Node build. Configuration is
 * deliberately minimal and offline: no worker options (Node fake worker),
 * no font face machinery, no verbosity output, no CMap/standard-font URLs.
 */
async function defaultLoadDocument(data: Uint8Array): Promise<PdfjsLoadingTask> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfjs.getDocument({
    data,
    disableFontFace: true,
    verbosity: 0,
  });
}

/** Map any thrown value onto the typed processing error taxonomy (§27). */
export function mapPdfjsError(error: unknown): ProcessingError {
  const name =
    error && typeof error === "object" && "name" in error
      ? String((error as { name?: unknown }).name)
      : "";
  switch (name) {
    case "InvalidPDFException":
    case "MissingPDFException":
      return new ProcessingError(
        "INVALID_PDF",
        "This PDF could not be read for text extraction.",
        { cause: error },
      );
    case "PasswordException":
      return new ProcessingError(
        "ENCRYPTED_PDF",
        "Password-protected PDFs cannot be converted to text yet.",
        { cause: error },
      );
    default:
      return new ProcessingError(
        "PROCESSING_ERROR",
        "The text of this PDF could not be extracted.",
        { cause: error },
      );
  }
}

/** Normalize raw PDF.js text items into positioned items (skips empties). */
function toPositionedItems(items: readonly unknown[]): PositionedTextItem[] {
  const positioned: PositionedTextItem[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object" || !("str" in item) || !("transform" in item)) {
      continue;
    }
    const str = (item as { str?: unknown }).str;
    const transform = (item as { transform?: unknown }).transform;
    const width = (item as { width?: unknown }).width;
    if (typeof str !== "string" || str.trim().length === 0 || !Array.isArray(transform)) {
      continue;
    }
    const x = transform[4];
    const y = transform[5];
    if (typeof x !== "number" || typeof y !== "number") continue;
    positioned.push({
      str: str.trim(),
      x,
      y,
      ...(typeof width === "number" && width >= 0 ? { width } : {}),
    });
  }
  return positioned;
}

/** Estimated run width when PDF.js does not report one (Helvetica-ish). */
function widthOf(piece: PositionedTextItem): number {
  return piece.width ?? piece.str.length * 6;
}

/**
 * Reconstruct reading-order lines from positioned text items.
 *
 * Algorithm (deterministic, general — no fixture-specific logic):
 *
 * 1. group items into visual lines by rounded y (Y_BUCKET_UNITS buckets);
 * 2. sort each line by x;
 * 3. join runs on a line, splitting into separate output segments where the
 *    horizontal gap to the previous run exceeds COLUMN_GAP_UNITS (column
 *    detection).
 *
 * Complexity for N items: O(N) bucketing + O(L·k·log k) sorting across L
 * lines of k items each = **O(N log N)** overall; joining is linear. There
 * are no quadratic pairwise scans.
 */
export function reconstructPdfjsLines(
  items: readonly PositionedTextItem[],
): string {
  if (items.length === 0) return "";

  const lines = new Map<number, PositionedTextItem[]>();
  for (const piece of items) {
    const key = Math.round(piece.y / Y_BUCKET_UNITS) * Y_BUCKET_UNITS;
    const bucket = lines.get(key);
    if (bucket) bucket.push(piece);
    else lines.set(key, [piece]);
  }

  // PDF origin is bottom-left: higher y first (top of page first).
  const sortedKeys = [...lines.keys()].sort((a, b) => b - a);
  const output: string[] = [];
  for (const key of sortedKeys) {
    const line = lines.get(key)!.sort((a, b) => a.x - b.x);
    let current = "";
    let previousEnd: number | null = null;
    for (const piece of line) {
      if (previousEnd !== null && piece.x - previousEnd > COLUMN_GAP_UNITS) {
        if (current.length > 0) output.push(current);
        current = piece.str;
      } else {
        current = current.length === 0 ? piece.str : `${current} ${piece.str}`;
      }
      previousEnd = piece.x + widthOf(piece);
    }
    if (current.length > 0) output.push(current);
  }
  return output.join("\n");
}

export interface LoadPositionedTextPagesOptions {
  /** Injectable loader (tests). Defaults to the real pdfjs-dist build. */
  loadDocument?: PdfjsDocumentLoader;
}

/**
 * Run a job with a PDF.js document, owning the task lifecycle: the input
 * buffer is copied (PDF.js detaches the buffer it is given) and the loading
 * task is ALWAYS destroyed — on success, on page failure, and when the
 * loading promise itself rejects (the Phase 72 cleanup bug class).
 */
async function withPdfjsDocument<T>(
  bytes: Uint8Array,
  loadDocument: PdfjsDocumentLoader | undefined,
  job: (document: PdfjsDocumentHandle) => Promise<T>,
): Promise<T> {
  const load = loadDocument ?? defaultLoadDocument;
  const task = await load(bytes.slice());
  try {
    const document = await task.promise;
    return await job(document);
  } finally {
    // Runs on EVERY path, including a rejected loading promise.
    await task.destroy();
  }
}

/**
 * Load a PDF and return the positioned text items of every page.
 *
 * Mechanics-only core shared with the benchmark adapters: no product limits
 * are enforced here (the benchmark corpus is bounded by construction).
 */
export async function loadPositionedTextPages(
  bytes: Uint8Array,
  options: LoadPositionedTextPagesOptions = {},
): Promise<{ numPages: number; pages: PositionedTextItem[][] }> {
  return withPdfjsDocument(bytes, options.loadDocument, async (document) => {
    const pages: PositionedTextItem[][] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(toPositionedItems(content.items));
      page.cleanup();
    }
    return { numPages: document.numPages, pages };
  });
}

/**
 * Extract the reconstructed text of every page — the product-level entry
 * point used by the pdfjs PDF → text processor. Mirrors the pdfium
 * component's contract (`extractPdfPageTexts`): page-count sanity checked
 * BEFORE any page is processed, the caller's page limit enforced, per-page
 * text in page order, and a defensive per-page item cap. All failures map
 * onto the typed processing error taxonomy.
 */
export async function extractPdfjsTextPages(
  bytes: Uint8Array,
  options: { maxPages: number } & LoadPositionedTextPagesOptions,
): Promise<{ pageCount: number; texts: string[] }> {
  const { maxPages, ...loaderOptions } = options;
  try {
    return await extractWithLimits(bytes, loaderOptions.loadDocument, maxPages);
  } catch (error) {
    // Typed product errors propagate unchanged; everything a PDF.js or a
    // mock loader threw maps onto the processing taxonomy (§27) — no raw
    // library exceptions, stack traces or content ever escape.
    if (error instanceof ProcessingError) throw error;
    throw mapPdfjsError(error);
  }
}

async function extractWithLimits(
  bytes: Uint8Array,
  loadDocument: PdfjsDocumentLoader | undefined,
  maxPages: number,
): Promise<{ pageCount: number; texts: string[] }> {
  return withPdfjsDocument(bytes, loadDocument, async (document) => {
    if (!Number.isInteger(document.numPages) || document.numPages < 1) {
      throw new ProcessingError("INVALID_PDF", "This PDF contains no pages.");
    }
    if (document.numPages > maxPages) {
      throw new ProcessingError(
        "TOO_MANY_OUTPUTS",
        `This PDF has ${document.numPages} pages; the limit for text export is ${maxPages}.`,
      );
    }

    const texts: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const items = toPositionedItems(content.items);
      page.cleanup();
      if (items.length > MAX_TEXT_ITEMS_PER_PAGE) {
        throw new ProcessingError(
          "PROCESSING_ERROR",
          "A page of this PDF is too dense for text extraction.",
        );
      }
      texts.push(reconstructPdfjsLines(items));
    }
    return { pageCount: document.numPages, texts };
  });
}
