// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pdfjsTextEngine } from "@/lib/engines/adapters/pdfjs-text";
import { currentPdfToTextEngine } from "@/lib/engines/adapters/current";
import { getDefaultEngineRegistry } from "@/lib/engines/registry";
import { selectEngine } from "@/lib/engines/router";
import {
  extractPdfjsTextPages,
  MAX_TEXT_ITEMS_PER_PAGE,
  type PdfjsDocumentHandle,
  type PdfjsLoadingTask,
} from "@/lib/processing/pdfjs/positioned-text";
import { DEFAULT_PROCESSING_LIMITS } from "@/lib/processing/limits";
import { makeBrokenPdf, makePdf, makeScannedPdf } from "@/test/pdf-fixtures";
import { CONVERSION_TYPES } from "@/lib/engines/types";

/**
 * Phase 73 engine tests: the alternative "pdfjs-text" engine through the
 * SAME contract as the current engine — validation, QualityGate, typed
 * errors, limits, privacy, complexity, gating, no fallback.
 *
 * No benchmark imports here: every fixture is built in-file or via the
 * repository's own test helpers (the isolation tests forbid @/lib/benchmarks
 * under production roots).
 */

const ENV_VARIABLE = "PDFKIT_PDF_TO_TEXT_ENGINE";

function pdfRequest(bytes: Uint8Array, options: Record<string, unknown> = {}) {
  return {
    toolId: "pdf-to-text",
    files: [
      { id: "f1", name: "doc.pdf", size: bytes.length, mimeType: "application/pdf", bytes },
    ],
    options,
  } as Parameters<typeof pdfjsTextEngine.run>[0];
}

async function runPdfjsText(bytes: Uint8Array, options: Record<string, unknown> = { pages: "all" }) {
  return pdfjsTextEngine.run(pdfRequest(bytes, options), {
    limits: DEFAULT_PROCESSING_LIMITS,
  });
}

async function runCurrentText(
  bytes: Uint8Array,
  options: Record<string, unknown> = { pages: "all" },
) {
  return currentPdfToTextEngine.run(pdfRequest(bytes, options), {
    limits: DEFAULT_PROCESSING_LIMITS,
  });
}

/** Inline PDF builders (Phase 73-specific shapes, no benchmark imports). */
async function buildPdf(
  draw: (page: import("pdf-lib").PDFPage, fonts: Record<string, import("pdf-lib").PDFFont>) => void,
  pageSize: [number, number] = [500, 400],
): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage(pageSize);
  draw(page, { helvetica: font });
  return document.save();
}

describe("pdfjs-text engine — the full battery (§44)", () => {
  it("extracts a valid PDF with the same artifact contract as the current engine", async () => {
    const bytes = await makePdf(["phase73-valid-page"]);
    const result = await runPdfjsText(bytes, { pages: "all" });
    expect(result.engineId).toBe("pdfjs-text");
    expect(result.attempt).toBe(1); // §36: selection ≠ retry attempt
    expect(result.warnings).toEqual([]);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.validation.status).not.toBe("not-evaluated"); // validator ran
    expect(result.quality?.state).toBe("healthy");
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0].mimeType).toBe("text/plain; charset=utf-8");
    expect(result.artifacts[0].name).toBe("doc-text.txt");
    const text = new TextDecoder().decode(result.artifacts[0].bytes);
    expect(text).toContain("--- Page 1 ---");
    expect(text).toContain("phase73-valid-page");
    expect(result.meta).toMatchObject({ pages: 1, outputPages: 1, extractedPages: 1 });
  });

  it("rejects an invalid PDF with the SAME typed error as the current engine", async () => {
    const bytes = makeBrokenPdf();
    const error = await runPdfjsText(bytes).catch((cause) => cause);
    expect(error.code).toBe("INVALID_PDF");
    expect(error.status).toBe(422);
    const currentError = await runCurrentText(bytes).catch((cause) => cause);
    expect(currentError.code).toBe("INVALID_PDF");
  });

  it("handles a blank PDF honestly (marker-only output, suspicious verdict)", async () => {
    const bytes = await buildPdf(() => {});
    const result = await runPdfjsText(bytes);
    const text = new TextDecoder().decode(result.artifacts[0].bytes);
    expect(text).toContain("[Page 1 contains no extractable text]");
    expect(result.quality?.state).toBe("suspicious");
    // The current engine behaves the same way on this input.
    const current = await runCurrentText(bytes);
    expect(current.quality?.state).toBe("suspicious");
  });

  it("handles an image-only (scanned-style) PDF honestly", async () => {
    const bytes = await makeScannedPdf(2);
    const result = await runPdfjsText(bytes);
    const text = new TextDecoder().decode(result.artifacts[0].bytes);
    expect(text).toContain("--- Page 1 ---");
    expect(text).toContain("[Page 1 contains no extractable text]");
    expect(text).toContain("[Page 2 contains no extractable text]");
    expect(result.quality?.state).toBe("suspicious");
  });

  it("extracts Unicode text with parity to the current engine", async () => {
    const bytes = await buildPdf((page, fonts) => {
      page.drawText("phase73 Café naïve Österreich Zürich ångström façade Straße", {
        x: 20,
        y: 300,
        size: 12,
        font: fonts.helvetica,
      });
    });
    const pdfjsTextResult = await runPdfjsText(bytes);
    const currentResult = await runCurrentText(bytes);
    const pdfjsOut = new TextDecoder().decode(pdfjsTextResult.artifacts[0].bytes);
    const currentOut = new TextDecoder().decode(currentResult.artifacts[0].bytes);
    for (const word of ["Café", "naïve", "Österreich", "Zürich", "ångström", "façade", "Straße"]) {
      expect(pdfjsOut, word).toContain(word);
      expect(currentOut, word).toContain(word);
    }
  });

  it("multi-column: reconstructs reading order (the Phase 72 advantage, now production)", async () => {
    const bytes = await buildPdf((page, fonts) => {
      const font = fonts.helvetica;
      for (let row = 1; row <= 4; row += 1) {
        page.drawText(`phase73-col-R-${row}`, { x: 300, y: 340 - row * 40, size: 12, font });
      }
      for (let row = 1; row <= 4; row += 1) {
        page.drawText(`phase73-col-L-${row}`, { x: 20, y: 340 - row * 40, size: 12, font });
      }
    });
    const result = await runPdfjsText(bytes);
    const text = new TextDecoder().decode(result.artifacts[0].bytes);
    // Reading order: every L anchor precedes its R partner on the same row.
    for (let row = 1; row <= 4; row += 1) {
      expect(text.indexOf(`phase73-col-L-${row}`)).toBeGreaterThan(-1);
      expect(text.indexOf(`phase73-col-L-${row}`)).toBeLessThan(
        text.indexOf(`phase73-col-R-${row}`),
      );
    }
  });

  it("multi-page documents keep page coverage", async () => {
    const bytes = await makePdf([
      "phase73-mp-1",
      "phase73-mp-2",
      "phase73-mp-3",
      "phase73-mp-4",
      "phase73-mp-5",
    ]);
    const result = await runPdfjsText(bytes, { pages: "all" });
    const text = new TextDecoder().decode(result.artifacts[0].bytes);
    for (let page = 1; page <= 5; page += 1) {
      expect(text).toContain(`--- Page ${page} ---`);
      expect(text).toContain(`phase73-mp-${page}`);
    }
    expect(result.meta).toMatchObject({ pages: 5, outputPages: 5 });
  });

  it("honors the page limit with the same typed error as the current engine", async () => {
    const bytes = await makePdf(Array.from({ length: 60 }, (_, i) => `p${i + 1}`));
    const error = await runPdfjsText(bytes).catch((cause) => cause);
    expect(error.code).toBe("TOO_MANY_OUTPUTS");
    const currentError = await runCurrentText(bytes).catch((cause) => cause);
    expect(currentError.code).toBe("TOO_MANY_OUTPUTS");
  });

  it("a 30-page bounded document completes under a generous safety ceiling (§45)", async () => {
    const bytes = await makePdf(Array.from({ length: 30 }, (_, i) => `phase73-large-${i + 1}`));
    const heapBefore = process.memoryUsage().heapUsed;
    const startedAt = Date.now();
    const result = await runPdfjsText(bytes, { pages: "all" });
    const elapsed = Date.now() - startedAt;
    // Broad regression guard only: pathological changes, not millisecond
    // precision (Phase 72 measured ~25ms median for 30 pages).
    expect(elapsed).toBeLessThan(10_000);
    expect(result.artifacts).toHaveLength(1);
    const heapDelta = process.memoryUsage().heapUsed - heapBefore;
    expect(heapDelta).toBeLessThan(150_000_000); // no runaway allocation
  });

  it("dense pages: ~5000 positioned items complete in bounded time (§22)", async () => {
    const bytes = await buildPdf((page, fonts) => {
      const font = fonts.helvetica;
      for (let index = 0; index < 5000; index += 1) {
        const col = index % 50;
        const row = Math.floor(index / 50);
        page.drawText(`d${index}`, { x: 5 + col * 9.5, y: 590 - row * 5, size: 4, font });
      }
    }, [842, 595]);
    const startedAt = Date.now();
    const result = await runPdfjsText(bytes);
    expect(Date.now() - startedAt).toBeLessThan(10_000);
    const text = new TextDecoder().decode(result.artifacts[0].bytes);
    expect(text).toContain("d0");
    expect(text).toContain("d4999");
    expect(result.quality?.state).toBe("healthy");
  });

  it("rejects a page exceeding the per-page item cap with a typed error (mock loader)", async () => {
    // RAW pdf.js items (str + transform), as getTextContent returns them.
    const tooMany = Array.from({ length: MAX_TEXT_ITEMS_PER_PAGE + 1 }, (_, index) => ({
      str: `x${index}`,
      transform: [1, 0, 0, 1, (index % 500) * 2, 100 + Math.floor(index / 500) * 5],
    }));
    const loader = async (): Promise<PdfjsLoadingTask> => ({
      promise: Promise.resolve({
        numPages: 1,
        async getPage() {
          return {
            async getTextContent() {
              return { items: tooMany };
            },
            cleanup() {},
          };
        },
      } satisfies PdfjsDocumentHandle),
      destroy: async () => {},
    });
    const error = await extractPdfjsTextPages(new Uint8Array([1]), {
      maxPages: 5,
      loadDocument: loader,
    }).catch((cause) => cause);
    expect(error.code).toBe("PROCESSING_ERROR");
  });

  it("truncated PDFs fail typed, like the current engine", async () => {
    const full = await makePdf(["t1", "t2", "t3"]);
    const truncated = full.slice(0, Math.floor(full.length * 0.5));
    const error = await runPdfjsText(truncated).catch((cause) => cause);
    expect(error.code).toBe("INVALID_PDF");
  });
});

describe("behavioral compatibility rules (§3, Rule A and Rule B)", () => {
  it("Rule A — micro sign: pdfjs normalizes µ to Greek mu; the engines are NOT forced identical", async () => {
    const bytes = await buildPdf((page, fonts) => {
      page.drawText("phase73-mu 10 µF capacitor", {
        x: 20,
        y: 300,
        size: 12,
        font: fonts.helvetica,
      });
    });
    const pdfjsOut = new TextDecoder().decode((await runPdfjsText(bytes)).artifacts[0].bytes);
    const currentOut = new TextDecoder().decode((await runCurrentText(bytes)).artifacts[0].bytes);
    // The current engine preserves the micro sign (compatibility baseline).
    expect(currentOut).toContain("µF");
    // The pdfjs engine normalizes to Greek mu (documented engine difference).
    expect(pdfjsOut).toContain("μF");
    // Rule A: the difference is ACCEPTED and recorded — never silently
    // claimed as byte-identical extraction.
    expect(pdfjsOut).not.toBe(currentOut);
  });

  it("Rule B — off-page text: pdfium (baseline) keeps it; pdfjs clips at the page boundary", async () => {
    const bytes = await buildPdf((page, fonts) => {
      page.drawText("phase73-onpage-anchor", { x: 20, y: 300, size: 12, font: fonts.helvetica });
      // Glyphs of this run extend past the 500-unit page width.
      page.drawText("phase73-offpage-anchor", { x: 430, y: 260, size: 12, font: fonts.helvetica });
    });
    const currentOut = new TextDecoder().decode((await runCurrentText(bytes)).artifacts[0].bytes);
    const pdfjsOut = new TextDecoder().decode((await runPdfjsText(bytes)).artifacts[0].bytes);
    // Baseline: the current engine returns the full run.
    expect(currentOut).toContain("phase73-onpage-anchor");
    expect(currentOut).toContain("phase73-offpage-anchor");
    // Documented pdfjs behavior: only the on-page part is returned — the
    // token is clipped mid-run at the page boundary (Phase 72 F-39 shape).
    expect(pdfjsOut).toContain("phase73-onpage-anchor");
    expect(pdfjsOut).not.toContain("phase73-offpage-anchor");
    expect(pdfjsOut).toContain("phase73-offp"); // the on-page prefix
  });
});

describe("CID-font extraction (§25 — Type0/Identity-H + ToUnicode + embedded TTF)", () => {
  it("both engines extract text from a genuine CID font via ToUnicode", async () => {
    const { makeCidFontPdf } = await import("@/test/pdf-fixtures");
    const bytes = makeCidFontPdf("phase73-cid-anchor");

    const pdfjsOut = new TextDecoder().decode((await runPdfjsText(bytes)).artifacts[0].bytes);
    const currentOut = new TextDecoder().decode((await runCurrentText(bytes)).artifacts[0].bytes);
    // The embedded font carries a ToUnicode CMap, so BOTH engines decode it.
    expect(pdfjsOut).toContain("phase73-cid-anchor");
    expect(currentOut).toContain("phase73-cid-anchor");
  });

  it("unverified shapes stay unverified: no predefined-CMap (non-ToUnicode) fixture exists", () => {
    // Documented limitation (docs/pdfjs-text-engine.md): PDFs whose fonts
    // rely on PREDEFINED CMaps without an embedded ToUnicode map (some CJK
    // producers) are NOT covered — pdfjs's bundled cmaps/ directory is
    // deliberately not configured, and the repository cannot author such a
    // PDF with existing tooling. This test is the honest record of that
    // boundary: extraction of those documents may degrade.
    expect(true).toBe(true);
  });
});

describe("privacy (§29) — PII tokens never leave through metadata, diagnostics or errors", () => {
  const PII_TOKENS = [
    "Zephyr Wohlken", // fake name
    "42 Quiet Lane, Kerala", // fake address
    "zephyr.wohlken@example.test", // fake email
    "+91 55555 00000", // fake phone
    "INV-2073-XYZ", // invoice id
    "PHASE73-PRIVACY-MARKER", // unique marker
  ];

  it("a successful run exposes tokens ONLY in the requested text artifact", async () => {
    const bytes = await buildPdf((page, fonts) => {
      let y = 350;
      for (const token of PII_TOKENS) {
        page.drawText(token, { x: 20, y, size: 11, font: fonts.helvetica });
        y -= 20;
      }
    });
    const result = await runPdfjsText(bytes);
    const artifactText = new TextDecoder().decode(result.artifacts[0].bytes);
    for (const token of PII_TOKENS) {
      expect(artifactText, token).toContain(token); // the requested output — permitted
    }
    // Everything EXCEPT the artifact bytes must be token-free.
    const diagnostics = JSON.stringify({
      quality: result.quality,
      profile: result.profile,
      meta: result.meta,
      validation: result.validation,
      warnings: result.warnings,
      engineId: result.engineId,
    });
    for (const token of PII_TOKENS) {
      expect(diagnostics, token).not.toContain(token);
    }
  });

  it("a failing run's typed error carries no content or filename", async () => {
    const bytes = makeBrokenPdf();
    const error = await runPdfjsText(bytes).catch((cause) => cause);
    const serialized = JSON.stringify({
      code: error.code,
      message: error.message,
      status: error.status,
    });
    for (const token of [...PII_TOKENS, "doc.pdf"]) {
      expect(serialized, token).not.toContain(token);
    }
  });
});

describe("manual gating, kill switch and no-fallback (§12, §33, §34, §43)", () => {
  const service = async () => import("@/lib/processing/service");

  beforeEach(() => {
    delete process.env[ENV_VARIABLE];
  });

  afterEach(() => {
    delete process.env[ENV_VARIABLE];
    vi.restoreAllMocks();
  });

  it("§33 disabled baseline: production behavior is exactly the Phase 72 default", async () => {
    const bytes = await makePdf(["phase73-baseline"]);
    const runProcessingJob = (await service()).runProcessingJob;
    const result = await runProcessingJob({
      toolId: "pdf-to-text",
      files: [
        { id: "f1", name: "doc.pdf", size: bytes.length, mimeType: "application/pdf", bytes },
      ],
      options: { pages: "all" },
    });
    expect(result.status).toBe("succeeded");
    if (result.status !== "succeeded") return;
    expect(result.meta?.engineId).toBe("current-pdfium-text");
    expect(result.meta?.attempt).toBe(1);
    // Byte-identical output to the direct current-engine run.
    const direct = await runCurrentText(bytes, { pages: "all" });
    expect(result.artifacts[0].bytes).toEqual(direct.artifacts[0].bytes);
    expect(result.artifacts[0].name).toBe(direct.artifacts[0].name);
  });

  it("§34 enabled: ONLY pdf-to-text selects pdfjs; the other 10 stay on their current engines", async () => {
    process.env[ENV_VARIABLE] = "pdfjs";
    for (const type of CONVERSION_TYPES) {
      const engine = selectEngine(type, { honorConfiguredAlternative: true });
      if (type === "pdf-to-text") {
        expect(engine.descriptor.id).toBe("pdfjs-text");
      } else {
        expect(engine.descriptor.id, type).not.toBe("pdfjs-text");
        expect(engine.descriptor.id, type).toMatch(/^current-/);
      }
    }
  });

  it("§43 enabled: the live pipeline serves pdfjs-text for pdf-to-text", async () => {
    process.env[ENV_VARIABLE] = "pdfjs";
    const bytes = await makePdf(["phase73-enabled"]);
    const result = await (await service()).runProcessingJob({
      toolId: "pdf-to-text",
      files: [
        { id: "f1", name: "doc.pdf", size: bytes.length, mimeType: "application/pdf", bytes },
      ],
      options: { pages: "all" },
    });
    expect(result.status).toBe("succeeded");
    if (result.status === "succeeded") {
      expect(result.meta?.engineId).toBe("pdfjs-text");
      expect(result.meta?.attempt).toBe(1); // §36: alternative ≠ attempt 2
    }
  });

  it("§43 disabled (explicit current): the default engine serves pdf-to-text", async () => {
    process.env[ENV_VARIABLE] = "current";
    const bytes = await makePdf(["phase73-disabled"]);
    const result = await (await service()).runProcessingJob({
      toolId: "pdf-to-text",
      files: [
        { id: "f1", name: "doc.pdf", size: bytes.length, mimeType: "application/pdf", bytes },
      ],
      options: { pages: "all" },
    });
    expect(result.status).toBe("succeeded");
    if (result.status === "succeeded") {
      expect(result.meta?.engineId).toBe("current-pdfium-text");
    }
  });

  it("§12 no fallback: pdfjs selected → pdfjs failure → current engine NOT invoked", async () => {
    process.env[ENV_VARIABLE] = "pdfjs";
    const currentEngine = getDefaultEngineRegistry().byId("current-pdfium-text")!;
    const currentSpy = vi.spyOn(currentEngine, "run");

    const bytes = makeBrokenPdf();
    const result = await (await service()).runProcessingJob({
      toolId: "pdf-to-text",
      files: [
        { id: "f1", name: "doc.pdf", size: bytes.length, mimeType: "application/pdf", bytes },
      ],
      options: { pages: "all" },
    });

    // The operation FAILS per the existing error model — no silent retry.
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.error.code).toBe("INVALID_PDF");
    }
    // And the current engine was never invoked.
    expect(currentSpy).not.toHaveBeenCalled();
  });

  it("§13 no QualityGate switching: verdicts never alter engine selection", async () => {
    process.env[ENV_VARIABLE] = "pdfjs";
    // healthy verdict (real text), suspicious verdict (marker-only output).
    const healthyBytes = await makePdf(["phase73-qg-healthy"]);
    const suspiciousBytes = await buildPdf(() => {}); // blank page

    for (const [bytes, expectedState] of [
      [healthyBytes, "healthy"],
      [suspiciousBytes, "suspicious"],
    ] as const) {
      const result = await runPdfjsText(bytes);
      expect(result.quality?.state).toBe(expectedState);
      // The selection is unaffected — before AND after any verdict.
      expect(selectEngine("pdf-to-text", { honorConfiguredAlternative: true }).descriptor.id).toBe(
        "pdfjs-text",
      );
    }

    // Structural proof: the router has no quality dependency at all.
    const routerSource = readFileSync(
      join(process.cwd(), "src/lib/engines/router.ts"),
      "utf8",
    );
    expect(routerSource).not.toContain("quality");
    expect(routerSource).not.toContain("Quality");
  });

  it("§38 no public engine-selection surface: the variable is server-side only", () => {
    // The processing HTTP layer maps only the whitelisted x-pdfkit-* meta
    // headers; engineId is not among them (asserted since Phase 67).
    const httpSource = readFileSync(
      join(process.cwd(), "src/lib/processing/http.ts"),
      "utf8",
    );
    expect(httpSource).not.toContain("PDFKIT_PDF_TO_TEXT_ENGINE");
    expect(httpSource).not.toContain("engineId");
    // No query/cookie/header parsing for engine selection anywhere.
    const offenders = ["src/lib/processing/http.ts", "src/lib/processing/service.ts"].map(
      (file) => readFileSync(join(process.cwd(), file), "utf8"),
    );
    for (const source of offenders) {
      expect(source).not.toMatch(/searchParams.*engine|engine.*searchParams/i);
    }
  });
});
