// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { getDefaultEngineRegistry } from "@/lib/engines/registry";
import { selectEngine } from "@/lib/engines/router";
import { getProcessor } from "@/lib/processing/registry";

/**
 * Phase 71 production-isolation proofs (Phase 71 §16), extended for
 * Phase 72 (§23–§24) and Phase 73.
 *
 * Phase 73 legitimately ships a production pdfjs engine: pdfjs-dist is a
 * real dependency now, imported by exactly ONE designated production
 * module. Everything else the earlier phases guaranteed still holds: the
 * benchmark harness stays unreachable from production, the native canvas
 * stays unimported, defaults stay defaults, and benchmark candidates stay
 * out of the registry.
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

describe("production isolation (Phase 71 §16, Phase 73 revision)", () => {
  it("no production module imports the benchmark harness", () => {
    const offenders: string[] = [];
    for (const root of PRODUCTION_ROOTS) {
      for (const file of collectFiles(root)) {
        const source = readFileSync(file, "utf8");
        // Test files colocated with production code are not production
        // modules; engine tests may import test-only benchmark utilities.
        if (file.endsWith(".test.ts")) continue;
        if (source.includes("@/lib/benchmarks")) {
          offenders.push(file);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("pdfjs-dist is imported by exactly ONE designated production module (the shared core)", () => {
    // Phase 73: the production pdfjs engine legitimately depends on
    // pdfjs-dist — but only through the single shared core module, so the
    // dependency surface stays auditable. Comments may mention pdfjs-dist;
    // imports are what is constrained.
    const allowlist = new Set([
      join("src", "lib", "processing", "pdfjs", "positioned-text.ts"),
    ]);
    const importPattern =
      /(?:from\s+|require\(\s*|import\(\s*)["']pdfjs-dist(?:\/[^"']*)?["']/;
    const offenders: string[] = [];
    for (const root of PRODUCTION_ROOTS) {
      for (const file of collectFiles(root)) {
        if (allowlist.has(file)) continue;
        const source = readFileSync(file, "utf8");
        if (importPattern.test(source)) offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
    // And the allowlisted module exists (the allowlist must not rot).
    expect(allowlist.size).toBe(1);
    for (const file of allowlist) {
      expect(() => readFileSync(file, "utf8")).not.toThrow();
    }
  });

  it("the live registry holds the 11 current defaults plus exactly one declared alternative", () => {
    const registry = getDefaultEngineRegistry();
    const ids = registry.list().map((engine) => engine.descriptor.id).sort();
    expect(ids).toEqual([
      // 11 defaults (unchanged):
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
      // 1 alternative (Phase 73), declared for pdf-to-text only:
      "pdfjs-text",
    ]);
    expect(registry.list()).toHaveLength(12);
    // Benchmark candidates are still nowhere near the registry.
    expect(registry.byId("candidate-pdfjs-text")).toBeUndefined();
    expect(registry.byId("candidate-pdfjs-table-signal")).toBeUndefined();
    // The alternative is registered as an ALTERNATIVE, not a default:
    expect(registry.alternativesFor("pdf-to-text").map((e) => e.descriptor.id)).toEqual([
      "pdfjs-text",
    ]);
    expect(
      registry.byConversion("pdf-to-text").map((e) => e.descriptor.id),
    ).toEqual(["current-pdfium-text"]);
    // Every other conversion has NO alternative.
    for (const engine of registry.list()) {
      if (engine.descriptor.conversionType !== "pdf-to-text") {
        expect(registry.alternativesFor(engine.descriptor.conversionType)).toEqual([]);
      }
    }
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
    // Environment hygiene: even with the alternative ENABLED in the
    // environment, the default-signature call must return the defaults.
    const previous = process.env.PDFKIT_PDF_TO_TEXT_ENGINE;
    process.env.PDFKIT_PDF_TO_TEXT_ENGINE = "pdfjs";
    try {
      for (const [conversion, engineId] of Object.entries(expected)) {
        expect(selectEngine(conversion as never).descriptor.id).toBe(engineId);
      }
    } finally {
      if (previous === undefined) delete process.env.PDFKIT_PDF_TO_TEXT_ENGINE;
      else process.env.PDFKIT_PDF_TO_TEXT_ENGINE = previous;
    }
  });

  it("the processing registry still serves engine-backed processors with current engine ids", async () => {
    // Feature-disabled baseline (Phase 73 §33): with the alternative not
    // enabled, the live path must behave exactly as in Phase 72.
    const previous = process.env.PDFKIT_PDF_TO_TEXT_ENGINE;
    delete process.env.PDFKIT_PDF_TO_TEXT_ENGINE;
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
    if (previous !== undefined) process.env.PDFKIT_PDF_TO_TEXT_ENGINE = previous;
  });

  it("pdfjs-dist is an audited production dependency (Phase 73 promotion); the native canvas is not", () => {
    // Phase 73 §31: the alternative engine is production-capable, so its
    // dependency is correctly classified in `dependencies` (Apache-2.0,
    // zero transitive dependencies, audited — see docs/pdfjs-text-engine.md).
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.dependencies["pdfjs-dist"]).toBeDefined();
    expect(pkg.devDependencies["pdfjs-dist"]).toBeUndefined();
    // The optional native canvas must NEVER be a direct dependency.
    expect(pkg.dependencies["@napi-rs/canvas"]).toBeUndefined();
  });
});

describe("production isolation (Phase 72 §23–§24)", () => {
  it("no source file imports the optional native canvas (rendering stays un-benchmarked and un-shipped)", () => {
    // The repository DISCUSSES @napi-rs/canvas in comments (the pdfium
    // rationale in thumbnails/renderer.ts) — what is forbidden is an IMPORT.
    const offenders = collectFiles("src")
      .filter((file) => !file.includes(join("src", "lib", "benchmarks")))
      .filter((file) => {
        const source = readFileSync(file, "utf8");
        return (
          /from\s+["']@napi-rs\/canvas["']/.test(source) ||
          /require\(\s*["']@napi-rs\/canvas["']\s*\)/.test(source) ||
          /import\(\s*["']@napi-rs\/canvas["']\s*\)/.test(source)
        );
      });
    expect(offenders).toEqual([]);
  });

  it("benchmark code never imports the router, the registry or processing routes", () => {
    // Isolation TESTS import the router to assert its behavior — only the
    // harness itself (non-test files) is forbidden from importing it.
    const benchmarkFiles = collectFiles(join("src", "lib", "benchmarks")).filter(
      (file) => !file.endsWith(".test.ts"),
    );
    expect(benchmarkFiles.length).toBeGreaterThan(5);
    const offenders = benchmarkFiles.filter((file) => {
      const source = readFileSync(file, "utf8");
      return (
        source.includes("@/lib/engines/router") ||
        source.includes("@/lib/engines/registry") ||
        source.includes("@/lib/processing/registry") ||
        source.includes("@/lib/processing/http")
      );
    });
    expect(offenders).toEqual([]);
  });

  it("the candidate table-signal engine is benchmark-only and absent from the live registry", () => {
    const registry = getDefaultEngineRegistry();
    expect(registry.byId("candidate-pdfjs-table-signal")).toBeUndefined();
    expect(registry.byId("candidate-pdfjs-text")).toBeUndefined();
    // 11 defaults + the 1 declared alternative (checked in detail above).
    expect(registry.list()).toHaveLength(12);
  });

  it("the native canvas stays an optional transitive of pdfjs-dist only — never a direct dependency", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.dependencies["@napi-rs/canvas"]).toBeUndefined();
    expect(pkg.devDependencies["@napi-rs/canvas"]).toBeUndefined();
    const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
    const canvasEntry = lock.packages["node_modules/@napi-rs/canvas"];
    expect(canvasEntry?.optional).toBe(true);
  });

  it("benchmark fixtures and results never persist to the repository working tree", () => {
    // The evidence artifact is committed deliberately as documentation; the
    // HARNESS itself writes only to the system temp directory. This test
    // keeps benchmark code from growing filesystem side effects inside the
    // repository: no benchmark module may import a repo-relative writer.
    const offenders = collectFiles(join("src", "lib", "benchmarks"))
      .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
      .filter((file) => {
        const source = readFileSync(file, "utf8");
        return /writeFile|appendFile|mkdirSync\(|rmSync\(/.test(source);
      });
    expect(offenders).toEqual([]);
  });
});

describe("production isolation (Phase 73 §32, §46)", () => {
  it("client/UI code never imports the engine layer or pdfjs", () => {
    const offenders = [...collectFiles("src/app"), ...collectFiles("src/components")]
      .filter((file) => {
        const source = readFileSync(file, "utf8");
        return (
          /from\s+["']@\/lib\/engines\//.test(source) ||
          /from\s+["']pdfjs-dist/.test(source) ||
          /import\(\s*["']pdfjs-dist/.test(source) ||
          /require\(\s*["']pdfjs-dist/.test(source)
        );
      });
    expect(offenders).toEqual([]);
  });

  it("production engine code contains no benchmark fixture ids or anchor tokens (no benchmark gaming)", () => {
    // §46: the production algorithm must be general — no fixture ids
    // (F-01…), no synthetic anchor tokens (PDFKIT-*) may appear in any
    // non-test engine/processing source file.
    const offenders = [...collectFiles("src/lib/engines"), ...collectFiles("src/lib/processing")]
      .filter((file) => !file.endsWith(".test.ts"))
      .filter((file) => {
        const source = readFileSync(file, "utf8");
        return /PDFKIT-[A-Za-z0-9-]+/.test(source) || /\bF-\d{2}\b/.test(source);
      });
    expect(offenders).toEqual([]);
  });
});
