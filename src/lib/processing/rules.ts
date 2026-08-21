import type { ProcessorInputRules } from "@/lib/processing/contract";

/**
 * Input rules shared by processors and the interface.
 *
 * Kept in its own module (with no `server-only` marker and no PDF library
 * import) so a server component can render accurate hints — "at least 2 PDFs" —
 * without pulling the processing implementation into its bundle.
 */

export const MERGE_PDF_INPUT_RULES: ProcessorInputRules = {
  minFiles: 2,
  extensions: [".pdf"],
  mimeTypes: ["application/pdf"],
};

export const INPUT_RULES_BY_TOOL: Record<string, ProcessorInputRules> = {
  "merge-pdf": MERGE_PDF_INPUT_RULES,
};

export function getInputRules(toolId: string): ProcessorInputRules | undefined {
  return INPUT_RULES_BY_TOOL[toolId];
}
