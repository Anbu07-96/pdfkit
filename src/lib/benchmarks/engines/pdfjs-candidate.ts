import "server-only";

import { createRequire } from "node:module";
import type { BenchmarkEngine } from "@/lib/benchmarks/types";

/**
 * BENCHMARK-ONLY candidate engine (Phase 71): Mozilla PDF.js text
 * extraction (`pdfjs-dist`, Apache-2.0, devDependency).
 *
 * IMPORTANT: this adapter is NOT registered in the live engine registry,
 * NOT reachable from any route, and NOT part of the production bundle —
 * `pdfjs-dist` is a devDependency and this module is imported only by
 * benchmark code. An isolation test enforces all of that.
 *
 * Why PDF.js is the Phase 71 primary candidate (see
 * docs/engine-candidates.md for the full audit): permissive license, pure
 * JavaScript (no child process, no native binary — the same in-process
 * security model as the current pdfium WASM stack), huge maintenance
 * ecosystem, and — the quality hypothesis under test — POSITIONED text
 * output (per-item x/y transforms) that can reconstruct reading order and
 * columns, which the current engine's plain line text cannot.
 */

const require_ = createRequire(import.meta.url);
const PDFJS_VERSION = require_("pdfjs-dist/package.json").version as string;

/** Horizontal gap (PDF units) above which two text runs on the same visual
 * line are treated as separate columns. Part of the candidate algorithm. */
const COLUMN_GAP_UNITS = 60;

interface PositionedText {
  str: string;
  x: number;
  y: number;
}

/**
 * Reconstruct lines from positioned text items: group by y (rounded to
 * tolerate sub-point jitter), sort each line by x, and break into segments
 * where the horizontal gap exceeds COLUMN_GAP_UNITS (column detection).
 */
function reconstructLines(items: readonly unknown[]): string {
  const positioned: PositionedText[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object" || !("str" in item) || !("transform" in item)) {
      continue;
    }
    const str = (item as { str?: unknown }).str;
    const transform = (item as { transform?: unknown }).transform;
    if (typeof str !== "string" || str.trim().length === 0 || !Array.isArray(transform)) {
      continue;
    }
    const x = transform[4];
    const y = transform[5];
    if (typeof x !== "number" || typeof y !== "number") continue;
    positioned.push({ str: str.trim(), x, y });
  }
  if (positioned.length === 0) return "";

  // Group by rounded y (2-unit buckets absorb fractional baselines).
  const lines = new Map<number, PositionedText[]>();
  for (const piece of positioned) {
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
      // Approximate run width when the item does not carry one.
      previousEnd = piece.x + piece.str.length * 6;
    }
    if (current.length > 0) output.push(current);
  }
  return output.join("\n");
}

/** The PDF.js candidate engine: PDF → text, positioned-item reconstruction. */
export function createPdfjsTextCandidate(): BenchmarkEngine {
  return {
    id: "candidate-pdfjs-text",
    version: `0.1.0 (pdfjs-dist ${PDFJS_VERSION})`,
    conversion: "pdf-to-text",
    async run(file) {
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      // Copy the bytes: PDF.js transfers (detaches) the buffer it is given.
      const data = file.bytes.slice();
      const task = pdfjs.getDocument({
        data,
        disableFontFace: true,
        verbosity: 0,
      });
      const document = await task.promise;
      try {
        const pages: string[] = [];
        for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
          const page = await document.getPage(pageNumber);
          const content = await page.getTextContent();
          pages.push(reconstructLines(content.items));
          page.cleanup();
        }
        const text = pages
          .map((pageText, index) => `--- Page ${index + 1} ---\n${pageText}`)
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
            pages: document.numPages,
            outputPages: document.numPages,
          },
        };
      } finally {
        await task.destroy();
      }
    },
  };
}
