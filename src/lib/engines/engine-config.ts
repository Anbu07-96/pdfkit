import "server-only";

import type { ConversionEngine, ConversionType } from "@/lib/engines/types";
import type { EngineRegistry } from "@/lib/engines/registry";

/**
 * Phase 73 manual engine gating — the smallest safe mechanism.
 *
 * ONE server-side environment variable selects the PDF → text engine:
 *
 * ```text
 * PDFKIT_PDF_TO_TEXT_ENGINE=current   (default; also when unset/invalid)
 * PDFKIT_PDF_TO_TEXT_ENGINE=pdfjs     (the alternative engine)
 * ```
 *
 * Safety properties (Phase 73 §9–§11, test-enforced):
 *
 * - **Fail-closed**: only the exact approved value `pdfjs` (case- and
 *   whitespace-normalized) selects the alternative. Missing, `current`,
 *   false-ish, malformed or unrecognized values ALWAYS mean the default
 *   engine. No request, header, query string or cookie can influence this.
 * - **Closed set**: the configuration names a MODE, not an engine id — it
 *   is impossible to select an arbitrary engine by string.
 * - **Kill switch**: setting the variable to `current` (or removing it)
 *   disables the alternative without code changes, affecting ONLY
 *   `pdf-to-text` (the variable names that conversion; no other conversion
 *   has a registered alternative).
 * - **Pure default routing**: `selectEngine(type)` WITHOUT options never
 *   consults this configuration — the explicit `honorConfiguredAlternative`
 *   option is the only approved opt-in, and it is passed solely by the
 *   engine processor in the live path.
 *
 * The value is read per resolution, so a configuration change (including a
 * kill-switch flip) takes effect for subsequent requests after an
 * environment change is applied to the server process (restart or env
 * reload) — deterministic within a process.
 */

/** The environment variable name (names only, never values, in messages). */
export const PDF_TO_TEXT_ENGINE_VARIABLE = "PDFKIT_PDF_TO_TEXT_ENGINE";

/** The closed set of selectable modes. */
export type PdfToTextEngineChoice = "current" | "pdfjs";

/**
 * The engine id the `pdfjs` mode maps to. Hard-coded and typed — the
 * configuration cannot name engine ids.
 */
export const PDF_TO_TEXT_ALTERNATIVE_ENGINE_ID = "pdfjs-text";

/**
 * Parse a raw configuration value into a choice. Anything that is not the
 * exact approved `pdfjs` mode fails closed to `current`. Pure function.
 */
export function parsePdfToTextEngineChoice(
  raw: string | undefined,
): PdfToTextEngineChoice {
  const normalized = raw?.trim().toLowerCase();
  return normalized === "pdfjs" ? "pdfjs" : "current";
}

/**
 * The configured alternative engine for a conversion, if — and only if —
 * every gate holds:
 *
 * 1. the conversion is `pdf-to-text` (the only conversion with an
 *    alternative in Phase 73);
 * 2. the configuration explicitly selects the `pdfjs` mode;
 * 3. the alternative engine is registered AS AN ALTERNATIVE (not merely
 *    present by id), matches the conversion, and is available.
 *
 * Any failure returns `undefined` and the caller falls back to the DEFAULT
 * engine — never to an arbitrary one.
 */
export function resolveConfiguredAlternativeEngine(
  conversionType: ConversionType,
  registry: EngineRegistry,
  env: Record<string, string | undefined> = process.env,
): ConversionEngine | undefined {
  if (conversionType !== "pdf-to-text") return undefined;
  if (parsePdfToTextEngineChoice(env[PDF_TO_TEXT_ENGINE_VARIABLE]) !== "pdfjs") {
    return undefined;
  }
  const engine = registry.byId(PDF_TO_TEXT_ALTERNATIVE_ENGINE_ID);
  if (!engine) return undefined;
  if (engine.descriptor.conversionType !== "pdf-to-text") return undefined;
  if (!engine.descriptor.available) return undefined;
  const isDeclaredAlternative = registry
    .alternativesFor("pdf-to-text")
    .some((candidate) => candidate.descriptor.id === PDF_TO_TEXT_ALTERNATIVE_ENGINE_ID);
  if (!isDeclaredAlternative) return undefined;
  return engine;
}
