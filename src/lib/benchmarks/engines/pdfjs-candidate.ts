import "server-only";

import { createRequire } from "node:module";
import { pdfjsTextEngine } from "@/lib/engines/adapters/pdfjs-text";
import { DEFAULT_PROCESSING_LIMITS } from "@/lib/processing/limits";
import type { BenchmarkEngine } from "@/lib/benchmarks/types";

/**
 * BENCHMARK-ONLY wrapper for the PRODUCTION pdfjs-text engine (Phase 73).
 *
 * Phase 72 ran a standalone benchmark adapter; Phase 73 promoted its
 * extraction core into the production alternative engine
 * (`src/lib/processing/pdfjs/positioned-text.ts`, wrapped by
 * `src/lib/engines/adapters/pdfjs-text.ts`). This wrapper now measures the
 * PRODUCTION engine through the exact same wrapping discipline the current
 * engines get (`engines/current-adapter.ts`): a direct engine-adapter call,
 * no router, no registry mutation — so benchmark evidence and production
 * behavior cannot drift apart. The parity is by construction and proven by
 * the Phase 73 differential test (pdfjs-engine-parity.test.ts).
 *
 * Isolation is unchanged: this module is imported only by benchmark code,
 * never registers anything, and never enters the production bundle through
 * any route.
 */

const require_ = createRequire(import.meta.url);
const PDFJS_VERSION = require_("pdfjs-dist/package.json").version as string;

/** The PDF.js candidate: the production pdfjs-text engine, benchmark-wrapped. */
export function createPdfjsTextCandidate(): BenchmarkEngine {
  return {
    id: "candidate-pdfjs-text",
    version: `0.3.0 (production pdfjs-text core; pdfjs-dist ${PDFJS_VERSION})`,
    conversion: "pdf-to-text",
    async run(file) {
      const result = await pdfjsTextEngine.run(
        {
          toolId: "pdf-to-text",
          files: [
            {
              id: "benchmark-input-1",
              name: file.name,
              size: file.bytes.length,
              mimeType: "application/pdf",
              bytes: file.bytes,
            },
          ],
          options: { pages: "all" },
        },
        { limits: DEFAULT_PROCESSING_LIMITS },
      );
      return { artifacts: result.artifacts, meta: result.meta };
    },
  };
}
