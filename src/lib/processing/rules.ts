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

/** Split works on exactly one document at a time. */
export const SPLIT_PDF_INPUT_RULES: ProcessorInputRules = {
  minFiles: 1,
  maxFiles: 1,
  extensions: [".pdf"],
  mimeTypes: ["application/pdf"],
};

/** Extract keeps the selected pages of one document. */
export const EXTRACT_PDF_PAGES_INPUT_RULES: ProcessorInputRules = {
  minFiles: 1,
  maxFiles: 1,
  extensions: [".pdf"],
  mimeTypes: ["application/pdf"],
};

/** Delete removes the selected pages of one document. */
export const DELETE_PDF_PAGES_INPUT_RULES: ProcessorInputRules = {
  minFiles: 1,
  maxFiles: 1,
  extensions: [".pdf"],
  mimeTypes: ["application/pdf"],
};

/** Reorder rearranges the pages of one document. */
export const REORDER_PDF_PAGES_INPUT_RULES: ProcessorInputRules = {
  minFiles: 1,
  maxFiles: 1,
  extensions: [".pdf"],
  mimeTypes: ["application/pdf"],
};

/** Images → PDF accepts several JPG/JPEG/PNG files, in upload order. */
export const IMAGES_TO_PDF_INPUT_RULES: ProcessorInputRules = {
  minFiles: 1,
  extensions: [".jpg", ".jpeg", ".png"],
  mimeTypes: ["image/jpeg", "image/png"],
  // Content check: real JPEG/PNG signatures instead of the PDF header.
  contentKind: "image",
};

/** PDF → image export works on exactly one document at a time. */
export const SINGLE_PDF_TO_IMAGE_RULES: ProcessorInputRules = {
  minFiles: 1,
  maxFiles: 1,
  extensions: [".pdf"],
  mimeTypes: ["application/pdf"],
};

/** Remove Metadata works on exactly one document. */
export const REMOVE_METADATA_INPUT_RULES: ProcessorInputRules = {
  minFiles: 1,
  maxFiles: 1,
  extensions: [".pdf"],
  mimeTypes: ["application/pdf"],
};

/** Edit Metadata works on exactly one document. */
export const EDIT_PDF_METADATA_INPUT_RULES: ProcessorInputRules = {
  minFiles: 1,
  maxFiles: 1,
  extensions: [".pdf"],
  mimeTypes: ["application/pdf"],
};

/** Compress reduces the size of one document. */
export const COMPRESS_PDF_INPUT_RULES: ProcessorInputRules = {
  minFiles: 1,
  maxFiles: 1,
  extensions: [".pdf"],
  mimeTypes: ["application/pdf"],
};

/** Rotate changes the orientation of pages in one document. */
export const ROTATE_PDF_INPUT_RULES: ProcessorInputRules = {
  minFiles: 1,
  maxFiles: 1,
  extensions: [".pdf"],
  mimeTypes: ["application/pdf"],
};

/** Generic rules for reading a single PDF (page inspection). */
export const SINGLE_PDF_INPUT_RULES: ProcessorInputRules = {
  minFiles: 1,
  maxFiles: 1,
  extensions: [".pdf"],
  mimeTypes: ["application/pdf"],
};

export const INPUT_RULES_BY_TOOL: Record<string, ProcessorInputRules> = {
  "merge-pdf": MERGE_PDF_INPUT_RULES,
  "split-pdf": SPLIT_PDF_INPUT_RULES,
  "extract-pdf-pages": EXTRACT_PDF_PAGES_INPUT_RULES,
  "delete-pdf-pages": DELETE_PDF_PAGES_INPUT_RULES,
  "reorder-pdf-pages": REORDER_PDF_PAGES_INPUT_RULES,
  "rotate-pdf": ROTATE_PDF_INPUT_RULES,
  "compress-pdf": COMPRESS_PDF_INPUT_RULES,
  "images-to-pdf": IMAGES_TO_PDF_INPUT_RULES,
  "pdf-to-jpg": SINGLE_PDF_TO_IMAGE_RULES,
  "pdf-to-png": SINGLE_PDF_TO_IMAGE_RULES,
  "edit-pdf-metadata": EDIT_PDF_METADATA_INPUT_RULES,
  "remove-metadata": REMOVE_METADATA_INPUT_RULES,
};

export function getInputRules(toolId: string): ProcessorInputRules | undefined {
  return INPUT_RULES_BY_TOOL[toolId];
}
