// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { EngineRoutingError } from "@/lib/engines/errors";
import { getDefaultEngineRegistry } from "@/lib/engines/registry";
import { selectEngine } from "@/lib/engines/router";
import { CONVERSION_TYPES, type ConversionType } from "@/lib/engines/types";
import { TOOLS } from "@/lib/tools";

/**
 * The Stage 1 routing contract: every supported conversion maps to exactly
 * the current engine — the implementation the tool already uses today.
 */
const EXPECTED_ENGINE: Record<ConversionType, string> = {
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

describe("conversion router (Stage 1)", () => {
  it("selects the expected current engine for every supported conversion", () => {
    for (const type of CONVERSION_TYPES) {
      const engine = selectEngine(type);
      expect(engine.descriptor.id, type).toBe(EXPECTED_ENGINE[type]);
      expect(engine.descriptor.conversionType).toBe(type);
      expect(engine.descriptor.toolId).toBe(type);
      expect(engine.descriptor.available).toBe(true);
    }
  });

  it("is deterministic: the same engine instance is selected every time", () => {
    for (const type of CONVERSION_TYPES) {
      expect(selectEngine(type)).toBe(selectEngine(type));
    }
  });

  it("selects exactly one engine per conversion type — no multi-engine routing", () => {
    const registry = getDefaultEngineRegistry();
    for (const type of CONVERSION_TYPES) {
      expect(registry.byConversion(type)).toHaveLength(1);
    }
  });

  it("never selects an engine outside the current set", () => {
    // The router cannot invent, guess or default to an unknown engine.
    const currentIds = new Set(
      getDefaultEngineRegistry().list().map((engine) => engine.descriptor.id),
    );
    for (const type of CONVERSION_TYPES) {
      expect(currentIds.has(selectEngine(type).descriptor.id)).toBe(true);
    }
  });

  it("fails loudly for unsupported conversions instead of guessing", () => {
    const unsupported = [
      "word-to-pdf",
      "pdf-to-html",
      "definitely-not-a-conversion",
    ] as unknown as ConversionType[];
    for (const type of unsupported) {
      expect(() => selectEngine(type)).toThrow(EngineRoutingError);
    }
  });

  it("only serves conversion types that are AVAILABLE catalog tools", () => {
    for (const type of CONVERSION_TYPES) {
      const tool = TOOLS.find((candidate) => candidate.id === type);
      expect(tool, `${type} must exist in the catalog`).toBeDefined();
      expect(tool?.status, `${type} must be AVAILABLE`).toBe("AVAILABLE");
    }
  });

  it("covers every AVAILABLE convert-category tool", () => {
    const convertTools = TOOLS.filter(
      (tool) => tool.category === "convert" && tool.status === "AVAILABLE",
    ).map((tool) => tool.id);
    expect(convertTools.length).toBeGreaterThan(0);
    for (const id of convertTools) {
      expect(
        (CONVERSION_TYPES as readonly string[]).includes(id),
        `${id} should be a registered conversion type`,
      ).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Phase 73 — default purity + explicit alternative selection            */
/* ------------------------------------------------------------------ */

describe("conversion router (Phase 73 manual gating)", () => {
  const VARIABLE = "PDFKIT_PDF_TO_TEXT_ENGINE";

  afterEach(() => {
    delete process.env[VARIABLE];
  });

  it("the default-signature call NEVER consults the configuration", () => {
    process.env[VARIABLE] = "pdfjs";
    try {
      for (const type of CONVERSION_TYPES) {
        // Pure default routing, even with the alternative enabled.
        expect(selectEngine(type).descriptor.id, type).toBe(EXPECTED_ENGINE[type]);
      }
    } finally {
      delete process.env[VARIABLE];
    }
  });

  it("honors the approved configuration ONLY for pdf-to-text", () => {
    process.env[VARIABLE] = "pdfjs";
    try {
      expect(selectEngine("pdf-to-text", { honorConfiguredAlternative: true }).descriptor.id).toBe(
        "pdfjs-text",
      );
      // Every other conversion: identity-equivalent routing with the flag.
      for (const type of CONVERSION_TYPES) {
        if (type === "pdf-to-text") continue;
        expect(
          selectEngine(type, { honorConfiguredAlternative: true }).descriptor.id,
          type,
        ).toBe(EXPECTED_ENGINE[type]);
      }
    } finally {
      delete process.env[VARIABLE];
    }
  });

  it("fails closed to the default engine for every non-approved configuration value", () => {
    for (const value of ["", "current", "off", "false", "bogus", "pdfjs-text", "qpdf"]) {
      process.env[VARIABLE] = value;
      expect(
        selectEngine("pdf-to-text", { honorConfiguredAlternative: true }).descriptor.id,
        `value ${JSON.stringify(value)}`,
      ).toBe("current-pdfium-text");
    }
    delete process.env[VARIABLE];
    expect(
      selectEngine("pdf-to-text", { honorConfiguredAlternative: true }).descriptor.id,
    ).toBe("current-pdfium-text");
  });

  it("alternative selection is deterministic and returns the same instance", () => {
    process.env[VARIABLE] = "pdfjs";
    const first = selectEngine("pdf-to-text", { honorConfiguredAlternative: true });
    const second = selectEngine("pdf-to-text", { honorConfiguredAlternative: true });
    expect(first).toBe(second);
    expect(first.descriptor.id).toBe("pdfjs-text");
  });
});
