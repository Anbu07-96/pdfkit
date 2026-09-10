import "server-only";

import { createRequire } from "node:module";
import type { BenchmarkEngine } from "@/lib/benchmarks/types";

/**
 * BENCHMARK-ONLY candidate engine (Phases 71–72): Mozilla PDF.js text
 * extraction (`pdfjs-dist`, Apache-2.0, devDependency).
 *
 * IMPORTANT: this adapter is NOT registered in the live engine registry,
 * NOT reachable from any route, and NOT part of the production bundle —
 * `pdfjs-dist` is a devDependency and this module is imported only by
 * benchmark code. An isolation test enforces all of that.
 *
 * Why PDF.js is the primary candidate (see docs/engine-candidates.md for the
 * full audit): permissive license, pure JavaScript (no child process, no
 * native binary — the same in-process security model as the current pdfium
 * WASM stack), huge maintenance ecosystem, and — the quality hypothesis
 * under test — POSITIONED text output (per-item x/y transforms) that can
 * reconstruct reading order and columns, which the current engine's plain
 * line text cannot.
 *
 * Phase 72 additions:
 * - the loading task is ALWAYS destroyed (success and failure), verifiable
 *   through the injectable loader used by the cleanup tests;
 * - the positioned-item extraction is exported so the table-signal
 *   component benchmark reuses the exact same parsing discipline;
 * - item width, when PDF.js reports it, replaces the length-based width
 *   estimate in column detection (candidate adapter v0.2.0).
 */

const require_ = createRequire(import.meta.url);
const PDFJS_VERSION = require_("pdfjs-dist/package.json").version as string;

/** Horizontal gap (PDF units) above which two text runs on the same visual
 * line are treated as separate columns. Part of the candidate algorithm. */
const COLUMN_GAP_UNITS = 60;

/** A positioned text item as the candidate algorithms consume it. */
export interface PositionedTextItem {
  readonly str: string;
  readonly x: number;
  readonly y: number;
  /** Reported run width in PDF units, when PDF.js provides it. */
  readonly width?: number;
}

/** The minimal PDF.js page surface the benchmark relies on. */
interface PdfjsPage {
  getTextContent(): Promise<{ items: readonly unknown[] }>;
  cleanup(): void;
}

/** The minimal PDF.js document surface the benchmark relies on. */
export interface PdfjsDocumentHandle {
  readonly numPages: number;
  getPage(pageNumber: number): Promise<PdfjsPage>;
}

/** A PDF.js loading task (destroy() releases the parsed document). */
export interface PdfjsLoadingTask {
  readonly promise: Promise<PdfjsDocumentHandle>;
  destroy(): Promise<void>;
}

/** Injectable document loader — the cleanup tests substitute a mock here. */
export type PdfjsDocumentLoader = (data: Uint8Array) => Promise<PdfjsLoadingTask>;

/** Default loader: the real pdfjs-dist legacy build, offline discipline. */
async function defaultLoadDocument(data: Uint8Array): Promise<PdfjsLoadingTask> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfjs.getDocument({
    data,
    disableFontFace: true,
    verbosity: 0,
  });
}

/**
 * Extract positioned text items for every page. The loading task is ALWAYS
 * destroyed, on success and on failure. The input bytes are copied because
 * PDF.js transfers (detaches) the buffer it is given.
 */
export async function parsePdfTextPages(
  bytes: Uint8Array,
  options: { loadDocument?: PdfjsDocumentLoader } = {},
): Promise<{ numPages: number; pages: PositionedTextItem[][] }> {
  const load = options.loadDocument ?? defaultLoadDocument;
  const task = await load(bytes.slice());
  try {
    const document = await task.promise;
    const pages: PositionedTextItem[][] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(toPositionedItems(content.items));
      page.cleanup();
    }
    return { numPages: document.numPages, pages };
  } finally {
    // Destroy runs on EVERY path — including a rejected loading promise.
    await task.destroy();
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
 * Reconstruct lines from positioned text items: group by y (rounded to
 * tolerate sub-point jitter), sort each line by x, and break into segments
 * where the horizontal gap exceeds COLUMN_GAP_UNITS (column detection).
 */
export function reconstructLines(items: readonly PositionedTextItem[]): string {
  if (items.length === 0) return "";

  // Group by rounded y (2-unit buckets absorb fractional baselines).
  const lines = new Map<number, PositionedTextItem[]>();
  for (const piece of items) {
    const key = Math.round(piece.y / 2) * 2;
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
        // Column break: emit the segment and start a new one.
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

/** The PDF.js candidate engine: PDF → text, positioned-item reconstruction. */
export function createPdfjsTextCandidate(
  options: { loadDocument?: PdfjsDocumentLoader } = {},
): BenchmarkEngine {
  return {
    id: "candidate-pdfjs-text",
    version: `0.2.0 (pdfjs-dist ${PDFJS_VERSION})`,
    conversion: "pdf-to-text",
    async run(file) {
      const { numPages, pages } = await parsePdfTextPages(file.bytes, options);
      const text = pages
        .map((pageItems, index) => `--- Page ${index + 1} ---\n${reconstructLines(pageItems)}`)
        .join("\n\n");
      const bytes = new TextEncoder().encode(text);
      return {
        artifacts: [
          {
            name: "benchmark-output.txt",
            mimeType: "text/plain; charset=utf-8",
            size: bytes.length,
            bytes,
          },
        ],
        meta: {
          pages: numPages,
          outputPages: numPages,
        },
      };
    },
  };
}
