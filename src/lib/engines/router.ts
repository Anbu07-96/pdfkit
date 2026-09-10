import "server-only";

import { EngineRoutingError } from "@/lib/engines/errors";
import { getDefaultEngineRegistry } from "@/lib/engines/registry";
import type { ConversionEngine, ConversionType } from "@/lib/engines/types";

/**
 * Stage 1 conversion router — intentionally minimal.
 *
 * `selectEngine(conversionType)` always resolves to the one engine
 * registered for that type: the current implementation. The signature takes
 * **only** the conversion type on purpose: future routing inputs (document
 * profiles, tier, bulk mode, engine health, quality requirements) are
 * PLANNED and will be added as explicit, typed parameters — until then it is
 * impossible for anything but the conversion type to influence routing.
 *
 * Failure mode: an unknown conversion type, or a conversion whose only
 * engine is unavailable, throws `EngineRoutingError`. That is an internal
 * invariant violation — it is never caught and silently worked around, and
 * the router never selects an engine it was not explicitly given.
 */
export function selectEngine(conversionType: ConversionType): ConversionEngine {
  const engines = getDefaultEngineRegistry().byConversion(conversionType);
  if (engines.length === 0) {
    throw new EngineRoutingError(
      `No available engine is registered for conversion "${conversionType}".`,
    );
  }
  // Stage 1: exactly one engine per conversion type, so the first (and only)
  // entry is the current engine. Keeping an explicit selection here gives
  // future multi-engine ranking a single place to land.
  const [primary] = engines;
  return primary;
}
