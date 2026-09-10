// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  parsePdfToTextEngineChoice,
  resolveConfiguredAlternativeEngine,
  PDF_TO_TEXT_ALTERNATIVE_ENGINE_ID,
  PDF_TO_TEXT_ENGINE_VARIABLE,
} from "@/lib/engines/engine-config";
import { getDefaultEngineRegistry } from "@/lib/engines/registry";
import { CURRENT_ENGINES } from "@/lib/engines/adapters/current";
import { createEngineRegistry } from "@/lib/engines/registry";
import type { ConversionEngine } from "@/lib/engines/types";

/**
 * Phase 73 engine configuration tests (§9–§11, §43).
 *
 * Fail-closed gating: only the exact approved value selects the
 * alternative; everything else — including hostile values — resolves to
 * the default engine. The configuration names a mode, never an engine id.
 */

describe("parsePdfToTextEngineChoice", () => {
  it("selects the alternative only for the exact approved mode", () => {
    expect(parsePdfToTextEngineChoice("pdfjs")).toBe("pdfjs");
    expect(parsePdfToTextEngineChoice("PDFJS")).toBe("pdfjs"); // case-normalized
    expect(parsePdfToTextEngineChoice(" pdfjs ")).toBe("pdfjs"); // whitespace-normalized
  });

  it("fails closed to the current engine for everything else", () => {
    for (const raw of [
      undefined,
      "",
      "current",
      "off",
      "false",
      "0",
      "no",
      "true",
      "yes",
      " pdfjs-x",
      "qpdf",
      "ghostscript",
      "mupdf",
      "current-pdfium-text", // engine IDs are not modes
      "pdfjs-text", // not even the real alternative's id is accepted
      "<script>",
      "pdfjs;rm -rf /",
    ]) {
      expect(parsePdfToTextEngineChoice(raw), JSON.stringify(raw)).toBe("current");
    }
  });
});

/** A minimal fake engine for registry-level resolution tests. */
function fakeEngine(id: string, conversionType: string, available = true): ConversionEngine {
  return {
    descriptor: {
      id,
      name: id,
      conversionType: conversionType as ConversionEngine["descriptor"]["conversionType"],
      toolId: "pdf-to-text",
      capabilities: ["text-extraction"],
      executionClass: "in-process",
      costClass: "local",
      license: "test",
      version: "1.0.0",
      available,
    },
    input: { maxFiles: 1, acceptedMimeTypes: [] } as never,
    async run() {
      throw new Error("never run");
    },
  };
}

describe("resolveConfiguredAlternativeEngine", () => {
  it("returns the declared alternative only when every gate holds", () => {
    const registry = getDefaultEngineRegistry();
    const engine = resolveConfiguredAlternativeEngine("pdf-to-text", registry, {
      [PDF_TO_TEXT_ENGINE_VARIABLE]: "pdfjs",
    });
    expect(engine?.descriptor.id).toBe(PDF_TO_TEXT_ALTERNATIVE_ENGINE_ID);
    expect(engine?.descriptor.id).toBe("pdfjs-text");
  });

  it("resolves to undefined (default) for every non-approved configuration value", () => {
    const registry = getDefaultEngineRegistry();
    for (const value of [
      undefined,
      "",
      "current",
      "false",
      "off",
      "pdfjs-text",
      "arbitrary",
      "PDFJS-TEXT",
    ]) {
      const resolved = resolveConfiguredAlternativeEngine("pdf-to-text", registry, {
        [PDF_TO_TEXT_ENGINE_VARIABLE]: value,
      });
      expect(resolved, `value ${JSON.stringify(value)}`).toBeUndefined();
    }
  });

  it("applies to pdf-to-text ONLY — never to any other conversion", () => {
    const registry = getDefaultEngineRegistry();
    const env = { [PDF_TO_TEXT_ENGINE_VARIABLE]: "pdfjs" };
    for (const engine of CURRENT_ENGINES) {
      if (engine.descriptor.conversionType === "pdf-to-text") continue;
      expect(
        resolveConfiguredAlternativeEngine(engine.descriptor.conversionType, registry, env),
        engine.descriptor.conversionType,
      ).toBeUndefined();
    }
  });

  it("fails closed when the alternative is not registered as an alternative", () => {
    // A registry with the engine id present but NOT declared as an
    // alternative must not hand it out.
    const registry = createEngineRegistry();
    const current = CURRENT_ENGINES.find(
      (engine) => engine.descriptor.conversionType === "pdf-to-text",
    )!;
    registry.register(current);
    // pdfjs-text is NOT registered here — resolution must fail closed.
    expect(
      resolveConfiguredAlternativeEngine("pdf-to-text", registry, {
        [PDF_TO_TEXT_ENGINE_VARIABLE]: "pdfjs",
      }),
    ).toBeUndefined();
  });

  it("fails closed when the alternative engine is unavailable (kill switch)", () => {
    const registry = createEngineRegistry();
    registry.register(
      CURRENT_ENGINES.find((e) => e.descriptor.conversionType === "pdf-to-text")!,
    );
    registry.registerAlternative(fakeEngine(PDF_TO_TEXT_ALTERNATIVE_ENGINE_ID, "pdf-to-text", false));
    expect(
      resolveConfiguredAlternativeEngine("pdf-to-text", registry, {
        [PDF_TO_TEXT_ENGINE_VARIABLE]: "pdfjs",
      }),
    ).toBeUndefined();
  });

  it("fails closed when a DIFFERENT engine id sits behind the alternative registration", () => {
    const registry = createEngineRegistry();
    registry.register(
      CURRENT_ENGINES.find((e) => e.descriptor.conversionType === "pdf-to-text")!,
    );
    registry.registerAlternative(fakeEngine("some-other-alternative", "pdf-to-text"));
    expect(
      resolveConfiguredAlternativeEngine("pdf-to-text", registry, {
        [PDF_TO_TEXT_ENGINE_VARIABLE]: "pdfjs",
      }),
    ).toBeUndefined();
  });
});
