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

  it("holds no engines beyond the current set", () => {
    expect(getDefaultEngineRegistry().list()).toHaveLength(
      CONVERSION_TYPES.length,
    );
  });

  it("exposes the current engines in a deterministic order", () => {
    const registry = getDefaultEngineRegistry();
    expect(registry.list()).toEqual(CURRENT_ENGINES);
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
    ).toThrow(/primary engine/);
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
