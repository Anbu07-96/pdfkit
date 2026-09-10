import "server-only";

import { CURRENT_ENGINES } from "@/lib/engines/adapters/current";
import type { ConversionType } from "@/lib/engines/types";
import { DEFAULT_PROCESSING_LIMITS } from "@/lib/processing/limits";
import type { BenchmarkEngine } from "@/lib/benchmarks/types";

/**
 * Benchmark wrapper for the CURRENT production engines (Phase 71).
 *
 * Wraps the existing engine adapter objects — the very code the live
 * pipeline runs — without going through the router or the registry. This is
 * read-only reuse: nothing here can change production routing.
 */

/** Options the current processors require for a representative run. */
const DEFAULT_OPTIONS: Partial<Record<ConversionType, Record<string, unknown>>> = {
  "pdf-to-text": { pages: "all" },
  "extract-images": { pages: "all" },
  "extract-tables": { format: "csv" },
  "compress-pdf": { level: "medium" },
};

export function currentEngineBenchmarkAdapter(
  conversion: ConversionType,
): BenchmarkEngine {
  const engine = CURRENT_ENGINES.find(
    (candidate) => candidate.descriptor.conversionType === conversion,
  );
  if (!engine) {
    throw new Error(`No current engine for conversion "${conversion}".`);
  }

  return {
    id: engine.descriptor.id,
    version: engine.descriptor.version,
    conversion,
    async run(file) {
      const result = await engine.run(
        {
          toolId: engine.descriptor.toolId,
          files: [
            {
              id: "benchmark-input-1",
              name: file.name,
              size: file.bytes.length,
              mimeType: "application/pdf",
              bytes: file.bytes,
            },
          ],
          ...(DEFAULT_OPTIONS[conversion]
            ? { options: DEFAULT_OPTIONS[conversion] }
            : {}),
        },
        { limits: DEFAULT_PROCESSING_LIMITS },
      );
      return { artifacts: result.artifacts, meta: result.meta };
    },
  };
}
