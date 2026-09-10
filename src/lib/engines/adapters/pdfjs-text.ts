import "server-only";

import { processorEngineAdapter } from "@/lib/engines/adapters/processor-engine";
import { pdfToTextPdfjsProcessor } from "@/lib/processing/processors/pdf-to-text-pdfjs";
import type { ConversionEngine } from "@/lib/engines/types";

/**
 * The Phase 73 ALTERNATIVE PDF → text engine: "pdfjs-text".
 *
 * It is registered in the live engine registry as an EXPLICIT ALTERNATIVE
 * for `pdf-to-text` — never as a default. `selectEngine("pdf-to-text")`
 * keeps returning `current-pdfium-text`; this engine is reachable only
 * through the server-controlled configuration gate
 * (`PDFKIT_PDF_TO_TEXT_ENGINE=pdfjs`, see `src/lib/engines/engine-config.ts`),
 * which is the Phase 73 manual-gating and kill-switch mechanism.
 *
 * The adapter itself is the SAME shared wrapping as every current engine
 * (`processorEngineAdapter`): identical OutputValidator treatment,
 * identical QualityGate policy, identical profile, `attempt: 1` always,
 * typed error propagation, no fallback. There is no engine-specific
 * validation or quality path (Phase 73 §14/§15).
 */
export const pdfjsTextEngine: ConversionEngine = processorEngineAdapter({
  descriptor: {
    id: "pdfjs-text",
    name: "PDF.js positioned-text extraction",
    conversionType: "pdf-to-text",
    toolId: "pdf-to-text",
    capabilities: ["text-extraction"],
    executionClass: "in-process",
    costClass: "local",
    license: "Apache-2.0 (pdfjs-dist)",
    version: "0.1.0",
    available: true,
  },
  processor: pdfToTextPdfjsProcessor,
});
