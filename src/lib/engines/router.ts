import "server-only";

import { EngineRoutingError } from "@/lib/engines/errors";
import { getDefaultEngineRegistry } from "@/lib/engines/registry";
import { resolveConfiguredAlternativeEngine } from "@/lib/engines/engine-config";
import type { ConversionEngine, ConversionType } from "@/lib/engines/types";

/**
 * Conversion router — default selection (Phase 67) + the Phase 73 explicit
 * alternative-selection opt-in.
 *
 * `selectEngine(conversionType)` — the original signature — ALWAYS resolves
 * to the conversion's DEFAULT engine, exactly as before: it never consults
 * the engine configuration, so no environment state can change default
 * routing. The signature still takes **only** the conversion type on
 * purpose: nothing but the conversion type may influence the default
 * selection.
 *
 * `selectEngine(conversionType, { honorConfiguredAlternative: true })` is
 * the Phase 73 manual-gating path: the server-side configuration
 * (`PDFKIT_PDF_TO_TEXT_ENGINE`, see engine-config.ts) may select the
 * explicitly registered alternative for `pdf-to-text` — and nothing else.
 * This option is passed by exactly one production call site (the engine
 * processor); it is never derived from request input. When the
 * configuration does not approve an alternative (unset, `current`, invalid,
 * alternative unavailable), the default engine is selected — fail-closed.
 *
 * Failure mode: an unknown conversion type, or a conversion whose only
 * engine is unavailable, throws `EngineRoutingError`. That is an internal
 * invariant violation — it is never caught and silently worked around, and
 * the router never selects an engine it was not explicitly given.
 */

/** Phase 73 explicit alternative-selection opt-in. */
export interface EngineSelectionOptions {
  /**
   * Honor the server-side engine configuration for conversions with a
   * registered alternative. Default `false`: pure default routing,
   * identical to Phase 72 behavior.
   */
  readonly honorConfiguredAlternative?: boolean;
}

export function selectEngine(
  conversionType: ConversionType,
  options: EngineSelectionOptions = {},
): ConversionEngine {
  if (options.honorConfiguredAlternative) {
    // The ONLY way an alternative can be selected: an explicit typed
    // opt-in plus a configuration that approves exactly this alternative.
    // Fail-closed: any doubt resolves to the default path below.
    const configured = resolveConfiguredAlternativeEngine(
      conversionType,
      getDefaultEngineRegistry(),
    );
    if (configured) {
      return configured;
    }
  }

  const engines = getDefaultEngineRegistry().byConversion(conversionType);
  if (engines.length === 0) {
    throw new EngineRoutingError(
      `No available engine is registered for conversion "${conversionType}".`,
    );
  }
  // The default engine: exactly one per conversion type (registry
  // invariant), so the first (and only) entry is it. Alternatives are
  // never in this list — adding one cannot silently change routing.
  const [primary] = engines;
  return primary;
}
