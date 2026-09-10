import "server-only";

import type {
  ConversionEngine,
  EngineDescriptor,
  EngineResult,
} from "@/lib/engines/types";
import { describeInputFile } from "@/lib/engines/profile";
import { assessConversionQuality } from "@/lib/engines/quality";
import { validateEngineResult } from "@/lib/engines/validation";
import type { ProcessingArtifact, ToolProcessor } from "@/lib/processing/contract";

/**
 * The shared processor→engine adapter (extracted from
 * `adapters/current.ts` in Phase 73 so the alternative pdfjs engine goes
 * through the IDENTICAL wrapping, validation and quality path as the
 * current engines — Phase 73 §14/§15).
 *
 * The adapter:
 *
 * - borrows `input` rules from the processor (never redefined), so request
 *   validation is identical for every engine;
 * - calls `processor.process()` with the untouched request and context
 *   exactly once per run;
 * - wraps a success with engine-layer facts (`engineId`, `attempt` —
 *   always 1 in Phase 73: selection and retry attempts are different
 *   concepts — `durationMs`, empty `warnings`, the signature-tier input
 *   `profile`);
 * - passes the wrapped result through the structural OutputValidator
 *   (Phase 68) — diagnostic only, never a failure path;
 * - attaches the QualityGate v1 verdict (Phase 69) — observe and record
 *   only, never a routing or retry input;
 * - lets the original `ProcessingError` propagate on failure: no catching,
 *   no wrapping, no classification, NO fallback to another engine.
 */

export interface ProcessorEngineSpec<TOptions = Record<string, unknown>> {
  descriptor: EngineDescriptor;
  processor: ToolProcessor<TOptions>;
}

/**
 * Upper bound for the marker-only scan: text artifacts above this size are
 * certainly not marker-only (a 50-page marker-only output is a few KiB).
 */
export const MARKER_SCAN_MAX_BYTES = 1024 * 1024;

const PAGE_MARKER_PATTERNS = [
  /--- Page \d+ ---/g,
  /\[Page \d+ contains no extractable text\]/g,
];

/**
 * Derive (without retaining anything) whether every text artifact consists
 * entirely of the current processors' page markers — the honest signal that
 * a PDF → text conversion extracted no source text. Boolean only: no
 * content leaves this function.
 */
export function textArtifactsMarkerOnly(
  artifacts: readonly ProcessingArtifact[],
): boolean | undefined {
  let sawTextArtifact = false;
  for (const artifact of artifacts) {
    if (!artifact.mimeType.toLowerCase().startsWith("text/")) continue;
    sawTextArtifact = true;
    if (artifact.bytes.length === 0 || artifact.bytes.length > MARKER_SCAN_MAX_BYTES) {
      return false;
    }
    let text = new TextDecoder().decode(artifact.bytes);
    for (const pattern of PAGE_MARKER_PATTERNS) {
      text = text.replace(pattern, "");
    }
    if (text.trim().length > 0) return false;
  }
  return sawTextArtifact ? true : undefined;
}

/** Wrap a tool processor as a conversion engine. */
export function processorEngineAdapter<TOptions>(
  spec: ProcessorEngineSpec<TOptions>,
): ConversionEngine<TOptions> {
  const { descriptor, processor } = spec;
  return {
    descriptor,
    input: processor.input,
    async run(request, context) {
      const startedAt = Date.now();
      const success = await processor.process(request, context);
      const result: EngineResult = {
        ...success,
        engineId: descriptor.id,
        attempt: 1,
        durationMs: Date.now() - startedAt,
        warnings: [],
        validation: { status: "not-evaluated" },
        // Signature-tier input description (Phase 68): one scan of the
        // first KiB, no parsing, never a routing input. Present whenever
        // the request carried a file.
        ...(request.files[0]
          ? { profile: describeInputFile(request.files[0]) }
          : {}),
      };
      // Structural validation (Phase 68) — records the verdict on the
      // result and returns it unchanged either way. Diagnostic only.
      const validated = validateEngineResult(result);

      // QualityGate v1 (Phase 69, Stage 3) — a conservative, diagnostic-only
      // quality verdict from signals the request already produced (profile
      // tier, validation verdict, processor meta, artifact facts). It adds
      // no parsing and never changes the outcome. Phase 73 keeps it strictly
      // observe-and-record: it cannot choose, reject, retry or fall back an
      // engine (test-enforced).
      const outputBytes = validated.artifacts.reduce(
        (total, artifact) => total + artifact.size,
        0,
      );
      return {
        ...validated,
        quality: assessConversionQuality(descriptor.conversionType, {
          profile: validated.profile,
          validation: validated.validation,
          meta: validated.meta,
          artifactCount: validated.artifacts.length,
          outputBytes,
          inputFileCount: request.files.length,
          outputTextMarkerOnly: textArtifactsMarkerOnly(validated.artifacts),
        }),
      };
    },
  };
}
