import "server-only";

import type { ToolProcessor } from "@/lib/processing/contract";
import { selectEngine } from "@/lib/engines/router";
import type { ConversionEngine, ConversionType } from "@/lib/engines/types";

/**
 * Engine-backed ToolProcessor — the live integration point of the engine
 * abstraction (Phase 67).
 *
 * For a migrated conversion tool, the processing registry maps the tool id to
 * `createEngineProcessor("<conversion>")` instead of the direct processor.
 * The returned processor:
 *
 * - carries the SAME toolId and the SAME input rules as the underlying
 *   processor (borrowed through the engine adapter — never redefined), so
 *   `runProcessingJob`'s validation behaves identically;
 * - routes each request through the conversion router, which in Stage 1
 *   always selects the current engine — a thin adapter over that very same
 *   processor implementation;
 * - returns the underlying success with two additive `meta` keys:
 *   `engineId` and `attempt` (always the current engine's id and `1`).
 *
 * The two meta keys are type-compatible additions to the free-form
 * `ProcessingSuccess.meta` record. No HTTP response header maps them and no
 * UI renders them (the HTTP layer exposes meta only through explicitly
 * mapped `x-pdfkit-*` headers), so the API contract is unchanged. They exist
 * so engine attribution is observable server-side — and in tests — and can
 * feed engine metrics in later stages.
 *
 * Failures need no handling here: the adapter lets the original
 * `ProcessingError` propagate, preserving error semantics exactly.
 */
export function createEngineProcessor<TOptions = Record<string, unknown>>(
  conversionType: ConversionType,
): ToolProcessor<TOptions> {
  // Resolve once at construction so a misconfigured conversion fails loudly
  // at module load (import time), not on the first request.
  const initial = selectEngine(conversionType);

  const processor: ToolProcessor<TOptions> = {
    toolId: initial.descriptor.toolId,
    input: initial.input,

    async process(request, context) {
      // Route per request — the router stays in the live path for every
      // call, which is what later stages build on. The registry hands out
      // engines typed with the default options record; this processor serves
      // the very tool the underlying engine implementation was built for and
      // forwards the request untouched, so narrowing to `TOptions` is sound
      // and purely compile-time.
      const engine = selectEngine(conversionType) as ConversionEngine<TOptions>;
      const result = await engine.run(request, context);

      return {
        status: "succeeded" as const,
        artifacts: result.artifacts,
        ...(result.bundleName !== undefined
          ? { bundleName: result.bundleName }
          : {}),
        meta: {
          ...(result.meta ?? {}),
          engineId: result.engineId,
          attempt: result.attempt,
        },
      };
    },
  };

  return processor;
}
