import "server-only";

import { CURRENT_ENGINES } from "@/lib/engines/adapters/current";
import type { ConversionEngine, ConversionType } from "@/lib/engines/types";

/**
 * Registry of conversion engines.
 *
 * Stage 1 rules:
 *
 * - exactly **one** engine per conversion type — registering a second engine
 *   for a type is rejected (multi-engine registration is PLANNED and will
 *   arrive with an explicit ranking, not by accident);
 * - engine ids are unique;
 * - ordering is deterministic (registration order; the default set is sorted
 *   by conversion type);
 * - an engine marked unavailable stays registered for inspection but is
 *   never returned for routing.
 */

export interface EngineRegistry {
  /** Register an engine. Throws on duplicate id or duplicate conversion. */
  register(engine: ConversionEngine): void;
  /**
   * Engines available for a conversion type, in deterministic order.
   * Stage 1: at most one entry. Empty when the type is unknown or its only
   * engine is unavailable.
   */
  byConversion(conversionType: ConversionType): readonly ConversionEngine[];
  /** Look an engine up by id (available or not). */
  byId(engineId: string): ConversionEngine | undefined;
  /** Whether any engine is registered for the type (available or not). */
  hasConversion(conversionType: ConversionType): boolean;
  /** Every registered conversion type, in registration order. */
  conversionTypes(): readonly ConversionType[];
  /** Every registered engine, in registration order. */
  list(): readonly ConversionEngine[];
}

/** A fresh, empty registry (used by the default set and by tests). */
export function createEngineRegistry(): EngineRegistry {
  const byIdMap = new Map<string, ConversionEngine>();
  const byConversionMap = new Map<ConversionType, ConversionEngine>();
  const order: ConversionEngine[] = [];

  return {
    register(engine) {
      const id = engine?.descriptor?.id;
      if (typeof id !== "string" || id.length === 0) {
        throw new Error(
          "An engine must carry a descriptor with a non-empty id.",
        );
      }
      if (byIdMap.has(id)) {
        throw new Error(`Engine id "${id}" is already registered.`);
      }
      const conversionType = engine.descriptor.conversionType;
      const existing = byConversionMap.get(conversionType);
      if (existing) {
        throw new Error(
          `Conversion "${conversionType}" already has a primary engine ` +
            `("${existing.descriptor.id}"). Stage 1 registers exactly one ` +
            "engine per conversion type; multi-engine registration is PLANNED.",
        );
      }
      byIdMap.set(id, engine);
      byConversionMap.set(conversionType, engine);
      order.push(engine);
    },

    byConversion(conversionType) {
      const engine = byConversionMap.get(conversionType);
      // Unavailable engines are registered but never routed to.
      return engine && engine.descriptor.available ? [engine] : [];
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
