// @vitest-environment node
import { describe, expect, it } from "vitest";
import { CURRENT_ENGINES } from "@/lib/engines/adapters/current";
import {
  createEngineRegistry,
  getDefaultEngineRegistry,
} from "@/lib/engines/registry";
import {
  CONVERSION_TYPES,
  type ConversionEngine,
  type ConversionType,
} from "@/lib/engines/types";

function fakeEngine(
  id: string,
  conversionType: ConversionType,
  available = true,
): ConversionEngine {
  return {
    descriptor: {
      id,
      name: `fake ${id}`,
      conversionType,
      toolId: conversionType,
      capabilities: [],
      executionClass: "in-process",
      costClass: "local",
      license: "test-only",
      version: "0",
      available,
      ...(available ? {} : { unavailableReason: "test" }),
    },
    input: {
      minFiles: 1,
      extensions: [".pdf"],
      mimeTypes: ["application/pdf"],
    },
    run: async () => {
      throw new Error("fake engine is never run");
    },
  };
}

describe("engine registry — default set", () => {
  it("registers exactly one engine for every conversion type", () => {
    const registry = getDefaultEngineRegistry();
    expect([...registry.conversionTypes()].sort()).toEqual(
      [...CONVERSION_TYPES].sort(),
    );
    for (const type of CONVERSION_TYPES) {
      const engines = registry.byConversion(type);
      expect(engines, type).toHaveLength(1);
      expect(engines[0].descriptor.conversionType).toBe(type);
      expect(engines[0].descriptor.available).toBe(true);
    }
  });

  it("keeps engine ids unique", () => {
    const ids = getDefaultEngineRegistry()
      .list()
      .map((engine) => engine.descriptor.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("holds the current defaults plus exactly one declared alternative (Phase 73)", () => {
    const registry = getDefaultEngineRegistry();
    expect(registry.list()).toHaveLength(CURRENT_ENGINES.length + 1);
    // The defaults come first, in the exact previous order.
    expect(registry.list().slice(0, CURRENT_ENGINES.length)).toEqual(CURRENT_ENGINES);
    // The single addition is the pdf-to-text alternative.
    const alternatives = registry.list().slice(CURRENT_ENGINES.length);
    expect(alternatives.map((engine) => engine.descriptor.id)).toEqual(["pdfjs-text"]);
    expect(alternatives[0].descriptor.conversionType).toBe("pdf-to-text");
  });

  it("exposes the current engines in a deterministic order", () => {
    const registry = getDefaultEngineRegistry();
    expect(registry.list().slice(0, CURRENT_ENGINES.length)).toEqual(CURRENT_ENGINES);
    expect(registry.list()).toEqual(registry.list());
  });

  it("finds every current engine by id", () => {
    const registry = getDefaultEngineRegistry();
    for (const engine of CURRENT_ENGINES) {
      expect(registry.byId(engine.descriptor.id)).toBe(engine);
    }
    expect(registry.byId("does-not-exist")).toBeUndefined();
  });
});

describe("engine registry — registration rules", () => {
  it("registers and looks up an engine", () => {
    const registry = createEngineRegistry();
    const engine = fakeEngine("test-engine", "pdf-to-word");
    registry.register(engine);

    expect(registry.byConversion("pdf-to-word")).toEqual([engine]);
    expect(registry.byId("test-engine")).toBe(engine);
    expect(registry.hasConversion("pdf-to-word")).toBe(true);
    expect(registry.conversionTypes()).toEqual(["pdf-to-word"]);
  });

  it("rejects a duplicate engine id", () => {
    const registry = createEngineRegistry();
    registry.register(fakeEngine("duplicate", "pdf-to-word"));
    expect(() =>
      registry.register(fakeEngine("duplicate", "pdf-to-text")),
    ).toThrow(/already registered/);
  });

  it("rejects a second engine for the same conversion type", () => {
    const registry = createEngineRegistry();
    registry.register(fakeEngine("first", "pdf-to-word"));
    expect(() =>
      registry.register(fakeEngine("second", "pdf-to-word")),
    ).toThrow(/default engine/);
  });

  it("rejects an engine without a usable descriptor id", () => {
    const registry = createEngineRegistry();
    expect(() => registry.register(fakeEngine("", "pdf-to-word"))).toThrow(
      /non-empty id/,
    );
  });

  it("preserves registration order deterministically", () => {
    const registry = createEngineRegistry();
    const first = fakeEngine("engine-a", "pdf-to-text");
    const second = fakeEngine("engine-b", "pdf-to-jpg");
    registry.register(first);
    registry.register(second);

    expect(registry.list()).toEqual([first, second]);
    expect(registry.conversionTypes()).toEqual(["pdf-to-text", "pdf-to-jpg"]);
  });
});

describe("engine registry — availability", () => {
  it("never routes to an unavailable engine, but keeps it inspectable", () => {
    const registry = createEngineRegistry();
    registry.register(fakeEngine("down", "pdf-to-word", false));

    expect(registry.byConversion("pdf-to-word")).toEqual([]);
    expect(registry.hasConversion("pdf-to-word")).toBe(true);
    expect(registry.byId("down")).toBeDefined();
    expect(registry.list()).toHaveLength(1);
  });

  it("reports no engines for an unknown conversion type", () => {
    const registry = createEngineRegistry();
    expect(registry.byConversion("pdf-to-html" as ConversionType)).toEqual([]);
    expect(registry.hasConversion("pdf-to-html" as ConversionType)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Phase 73 — multi-engine registry invariants                          */
/* ------------------------------------------------------------------ */

describe("registry alternatives (Phase 73 §6–§7)", () => {
  it("registerAlternative attaches an alternative without touching the default", () => {
    const registry = createEngineRegistry();
    const defaultEngine = CURRENT_ENGINES.find(
      (engine) => engine.descriptor.conversionType === "pdf-to-text",
    )!;
    registry.register(defaultEngine);
    const alternative = fakeEngine("alt-text", "pdf-to-text");

    registry.registerAlternative(alternative);

    // Default routing is UNCHANGED by the alternative's existence.
    expect(registry.byConversion("pdf-to-text")).toEqual([defaultEngine]);
    expect(registry.conversionTypes()).toEqual(["pdf-to-text"]);
    expect(registry.list()).toEqual([defaultEngine, alternative]);
    expect(registry.alternativesFor("pdf-to-text")).toEqual([alternative]);
  });

  it("rejects an alternative without an existing default for the conversion", () => {
    const registry = createEngineRegistry();
    expect(() => registry.registerAlternative(fakeEngine("orphan-alt", "pdf-to-text"))).toThrow(
      /no default engine/,
    );
  });

  it("rejects a duplicate engine id across defaults and alternatives", () => {
    const registry = createEngineRegistry();
    const textEngine = CURRENT_ENGINES.find(
      (engine) => engine.descriptor.conversionType === "pdf-to-text",
    )!;
    const wordEngine = CURRENT_ENGINES.find(
      (engine) => engine.descriptor.conversionType === "pdf-to-word",
    )!;
    registry.register(textEngine);
    registry.register(wordEngine);

    // Same id as a default (even another conversion's default).
    expect(() =>
      registry.registerAlternative(fakeEngine("current-pdfium-text", "pdf-to-text")),
    ).toThrow(/already registered/);
    expect(() =>
      registry.registerAlternative(fakeEngine("current-pdfium-docx", "pdf-to-text")),
    ).toThrow(/already registered/);
    // Same id as an existing alternative.
    registry.registerAlternative(fakeEngine("alt-text", "pdf-to-text"));
    expect(() =>
      registry.registerAlternative(fakeEngine("alt-text", "pdf-to-text")),
    ).toThrow(/already registered/);
  });

  it("registering a default still rejects a second default for a conversion with alternatives", () => {
    const registry = createEngineRegistry();
    const textEngine = CURRENT_ENGINES.find(
      (engine) => engine.descriptor.conversionType === "pdf-to-text",
    )!;
    registry.register(textEngine);
    registry.registerAlternative(fakeEngine("alt-text", "pdf-to-text"));
    expect(() => registry.register(fakeEngine("second-default", "pdf-to-text"))).toThrow(
      /exactly one default engine/i,
    );
  });

  it("registration order never decides the default: the alternative stays an alternative", () => {
    const registry = createEngineRegistry();
    const textEngine = CURRENT_ENGINES.find(
      (engine) => engine.descriptor.conversionType === "pdf-to-text",
    )!;
    registry.register(textEngine);
    const first = fakeEngine("alt-a", "pdf-to-text");
    const second = fakeEngine("alt-b", "pdf-to-text");
    registry.registerAlternative(first);
    registry.registerAlternative(second);

    // However many alternatives exist, byConversion is the default only.
    expect(registry.byConversion("pdf-to-text")).toEqual([textEngine]);
    expect(registry.alternativesFor("pdf-to-text")).toEqual([first, second]);
  });

  it("conversions without alternatives behave exactly as before", () => {
    const registry = getDefaultEngineRegistry();
    for (const engine of CURRENT_ENGINES) {
      const type = engine.descriptor.conversionType;
      if (type === "pdf-to-text") continue;
      expect(registry.byConversion(type), type).toEqual([engine]);
      expect(registry.alternativesFor(type), type).toEqual([]);
    }
  });

  it("an unavailable alternative stays inspectable but is never handed out by id-based resolution", () => {
    const registry = createEngineRegistry();
    registry.register(
      CURRENT_ENGINES.find((e) => e.descriptor.conversionType === "pdf-to-text")!,
    );
    registry.registerAlternative(fakeEngine("alt-unavailable", "pdf-to-text", false));
    const alternative = registry.byId("alt-unavailable");
    expect(alternative).toBeDefined();
    expect(alternative!.descriptor.available).toBe(false);
    // Routing still returns only the default.
    expect(registry.byConversion("pdf-to-text")).toHaveLength(1);
  });
});
