// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { getDefaultEngineRegistry } from "@/lib/engines/registry";
import { selectEngine } from "@/lib/engines/router";
import { getProcessor } from "@/lib/processing/registry";

/**
 * Phase 71 production-isolation proofs (Phase 71 §16).
 *
 * The candidate engine and the benchmark harness must be unreachable from
 * production. These tests enforce it statically and behaviorally.
 */

/** Recursively collect source files under a directory. */
function collectFiles(root: string, extension = ".ts"): string[] {
  const files: string[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      const stats = statSync(path);
      if (stats.isDirectory()) {
        if (entry === "benchmarks") continue; // benchmarks never import themselves from prod
        visit(path);
      } else if (entry.endsWith(extension) || entry.endsWith(".tsx")) {
        files.push(path);
      }
    }
  };
  visit(root);
  return files;
}

const PRODUCTION_ROOTS = [
  "src/lib/processing",
  "src/lib/engines",
  "src/lib/hardening",
  "src/lib/tools",
  "src/lib/upload",
  "src/lib/usage",
  "src/lib/auth",
  "src/lib/billing",
  "src/lib/bulk",
  "src/app",
  "src/components",
];

describe("production isolation (Phase 71 §16)", () => {
  it("no production module imports the benchmark harness", () => {
    const offenders: string[] = [];
    for (const root of PRODUCTION_ROOTS) {
      for (const file of collectFiles(root)) {
        const source = readFileSync(file, "utf8");
        if (source.includes("@/lib/benchmarks") || source.includes("pdfjs-dist")) {
          offenders.push(file);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the live registry contains exactly the 11 current engines — no candidate", () => {
    const registry = getDefaultEngineRegistry();
    const ids = registry.list().map((engine) => engine.descriptor.id).sort();
    expect(ids).toEqual([
      "current-pdf-lib-compress",
      "current-pdf-lib-extract-images",
      "current-pdf-lib-images",
      "current-pdf-lib-png",
      "current-pdfium-compare",
      "current-pdfium-docx",
      "current-pdfium-exceljs",
      "current-pdfium-jpeg",
      "current-pdfium-png",
      "current-pdfium-tables",
      "current-pdfium-text",
    ]);
    expect(registry.list()).toHaveLength(11);
    // The candidate is nowhere near the registry.
    expect(registry.byId("candidate-pdfjs-text")).toBeUndefined();
  });

  it("the router resolves every conversion to its current engine only", () => {
    const expected: Record<string, string> = {
      "compare-documents": "current-pdfium-compare",
      "compress-pdf": "current-pdf-lib-compress",
      "extract-images": "current-pdf-lib-extract-images",
      "extract-tables": "current-pdfium-tables",
      "images-to-pdf": "current-pdf-lib-images",
      "pdf-to-excel": "current-pdfium-exceljs",
      "pdf-to-jpg": "current-pdfium-jpeg",
      "pdf-to-png": "current-pdfium-png",
      "pdf-to-text": "current-pdfium-text",
      "pdf-to-word": "current-pdfium-docx",
      "png-to-pdf": "current-pdf-lib-png",
    };
    for (const [conversion, engineId] of Object.entries(expected)) {
      expect(selectEngine(conversion as never).descriptor.id).toBe(engineId);
    }
  });

  it("the processing registry still serves engine-backed processors with current engine ids", async () => {
    const processor = getProcessor<Record<string, unknown>>("pdf-to-text");
    expect(processor.toolId).toBe("pdf-to-text");
    // The meta contract is unchanged from Phase 67-70: processor meta plus
    // engineId/attempt, and the engineId is the CURRENT engine.
    const { PDFDocument, StandardFonts } = await import("pdf-lib");
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);
    const page = document.addPage([300, 300]);
    page.drawText("isolation", { x: 20, y: 150, size: 12, font });
    const bytes = await document.save();

    const service = await import("@/lib/processing/service");
    const result = await service.runProcessingJob({
      toolId: "pdf-to-text",
      files: [
        {
          id: "f1",
          name: "doc.pdf",
          size: bytes.length,
          mimeType: "application/pdf",
          bytes,
        },
      ],
      options: { pages: "all" },
    });
    expect(result.status).toBe("succeeded");
    if (result.status === "succeeded") {
      expect(result.meta?.engineId).toBe("current-pdfium-text");
      expect(result.meta?.attempt).toBe(1);
    }
  });

  it("pdfjs-dist is a devDependency only — never a production dependency", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.dependencies["pdfjs-dist"]).toBeUndefined();
    expect(pkg.devDependencies["pdfjs-dist"]).toBeDefined();
  });
});
