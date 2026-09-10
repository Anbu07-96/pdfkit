import "server-only";

import { CURRENT_ENGINES } from "@/lib/engines/adapters/current";
import { pdfjsTextEngine } from "@/lib/engines/adapters/pdfjs-text";
import type { ConversionEngine, ConversionType } from "@/lib/engines/types";

/**
 * Registry of conversion engines.
 *
 * Phase 73 model (superseding the Stage 1 single-engine rule — narrowly):
 *
 * - every conversion has exactly ONE **default** engine, registered through
 *   `register()` exactly as before — a second default for a conversion is
 *   still rejected;
 * - a conversion MAY additionally have explicitly declared **alternative**
 *   engines, registered through `registerAlternative()` — the Phase 73
 *   reality is ONE alternative for ONE conversion (`pdf-to-text` →
 *   `pdfjs-text`); every other conversion remains one-engine-only;
 * - alternatives NEVER change routing by themselves: `byConversion()`
 *   returns the default engine only, and registration order can never
 *   decide (or become) the default. An alternative is reachable only via
 *   the explicit, typed selection path in the router (see
 *   `resolveConfiguredAlternativeEngine`);
 * - engine ids remain globally unique across defaults and alternatives;
 * - an engine marked unavailable stays registered for inspection but is
 *   never returned for routing.
 *
 * Alternatives do NOT imply fallback: Phase 73 has no retry, no automatic
 * engine switching and no ranking.
 */

export interface EngineRegistry {
  /**
   * Register the DEFAULT engine for a conversion. Throws on duplicate id
   * or a second default for the same conversion.
   */
  register(engine: ConversionEngine): void;
  /**
   * Register an ALTERNATIVE engine for a conversion (Phase 73). Throws on
   * duplicate id, when no default exists for the conversion, or when the
   * engine does not serve that conversion. Never affects default routing.
   */
  registerAlternative(engine: ConversionEngine): void;
  /**
   * Engines available for ROUTING for a conversion type: exactly the
   * DEFAULT engine (available ones), in deterministic order. Alternatives
   * are deliberately absent — they never change routing by existing.
   */
  byConversion(conversionType: ConversionType): readonly ConversionEngine[];
  /**
   * The explicitly declared ALTERNATIVE engines for a conversion, in
   * deterministic registration order (available and unavailable ones —
   * availability is the selector's concern).
   */
  alternativesFor(conversionType: ConversionType): readonly ConversionEngine[];
  /** Look an engine up by id (default or alternative, available or not). */
  byId(engineId: string): ConversionEngine | undefined;
  /** Whether any engine is registered for the type (available or not). */
  hasConversion(conversionType: ConversionType): boolean;
  /** Every registered conversion type, in registration order. */
  conversionTypes(): readonly ConversionType[];
  /** Every registered engine (defaults and alternatives), in registration order. */
  list(): readonly ConversionEngine[];
}

/** A fresh, empty registry (used by the default set and by tests). */
export function createEngineRegistry(): EngineRegistry {
  const byIdMap = new Map<string, ConversionEngine>();
  const byConversionMap = new Map<ConversionType, ConversionEngine>();
  const alternativesMap = new Map<ConversionType, ConversionEngine[]>();
  const order: ConversionEngine[] = [];

  const assertUsableDescriptor = (engine: ConversionEngine): void => {
    const id = engine?.descriptor?.id;
    if (typeof id !== "string" || id.length === 0) {
      throw new Error(
        "An engine must carry a descriptor with a non-empty id.",
      );
    }
    if (byIdMap.has(id)) {
      throw new Error(`Engine id "${id}" is already registered.`);
    }
  };

  return {
    register(engine) {
      assertUsableDescriptor(engine);
      const conversionType = engine.descriptor.conversionType;
      const existing = byConversionMap.get(conversionType);
      if (existing) {
        throw new Error(
          `Conversion "${conversionType}" already has a default engine ` +
            `("${existing.descriptor.id}"). Exactly one default engine per ` +
            "conversion is allowed; additional engines must be registered as " +
            "explicit alternatives via registerAlternative().",
        );
      }
      byIdMap.set(engine.descriptor.id, engine);
      byConversionMap.set(conversionType, engine);
      order.push(engine);
    },

    registerAlternative(engine) {
      assertUsableDescriptor(engine);
      const conversionType = engine.descriptor.conversionType;
      const defaultEngine = byConversionMap.get(conversionType);
      if (!defaultEngine) {
        throw new Error(
          `Cannot register an alternative for "${conversionType}": the ` +
            "conversion has no default engine. Alternatives attach to a " +
            "conversion that already has a default, and can never become " +
            "the default by registration order.",
        );
      }
      if (defaultEngine.descriptor.id === engine.descriptor.id) {
        throw new Error(
          `Engine id "${engine.descriptor.id}" is already the default for ` +
            `"${conversionType}".`,
        );
      }
      byIdMap.set(engine.descriptor.id, engine);
      const alternatives = alternativesMap.get(conversionType) ?? [];
      alternatives.push(engine);
      alternativesMap.set(conversionType, alternatives);
      order.push(engine);
    },

    byConversion(conversionType) {
      const engine = byConversionMap.get(conversionType);
      // Unavailable engines are registered but never routed to.
      return engine && engine.descriptor.available ? [engine] : [];
    },

    alternativesFor(conversionType) {
      return [...(alternativesMap.get(conversionType) ?? [])];
    },

    byId(engineId) {
      return byIdMap.get(engineId);
    },

    hasConversion(conversionType) {
      return byConversionMap.has(conversionType);
    },

    conversionTypes() {
      return [...byConversionMap.keys()];
    },

    list() {
      return [...order];
    },
  };
}

function buildDefaultEngineRegistry(): EngineRegistry {
  const registry = createEngineRegistry();
  for (const engine of CURRENT_ENGINES) {
    registry.register(engine);
  }
  // Phase 73: the single, explicitly declared alternative — pdf-to-text
  // only. Every other conversion stays one-engine-only.
  registry.registerAlternative(pdfjsTextEngine);
  return registry;
}

/**
 * The process-wide default registry, built once at module load with the
 * engines PDFKit ships today. Building eagerly means a misconfigured engine
 * set fails loudly at startup (import time), never on the first request.
 */
const DEFAULT_ENGINE_REGISTRY: EngineRegistry = buildDefaultEngineRegistry();

export function getDefaultEngineRegistry(): EngineRegistry {
  return DEFAULT_ENGINE_REGISTRY;
}
