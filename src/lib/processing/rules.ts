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

/** Crop works on exactly one document. */
export const CROP_INPUT_RULES: ProcessorInputRules = {
  minFiles: 1,
  maxFiles: 1,
  extensions: [".pdf"],
  mimeTypes: ["application/pdf"],
};

/** Flatten works on exactly one document. */
export const FLATTEN_PDF_INPUT_RULES: ProcessorInputRules = {
  minFiles: 1,
  maxFiles: 1,
  extensions: [".pdf"],
  mimeTypes: ["application/pdf"],
};

/** Page Numbers stamps one document. */
export const PAGE_NUMBERS_INPUT_RULES: ProcessorInputRules = {
  minFiles: 1,
  maxFiles: 1,
  extensions: [".pdf"],
  mimeTypes: ["application/pdf"],
};

/** Watermark stamps one document. */
export const WATERMARK_INPUT_RULES: ProcessorInputRules = {
  minFiles: 1,
  maxFiles: 1,
  extensions: [".pdf"],
  mimeTypes: ["application/pdf"],
};

/** Add Text draws a text box on one document. */
export const ADD_TEXT_INPUT_RULES: ProcessorInputRules = {
  minFiles: 1,
  maxFiles: 1,
  extensions: [".pdf"],
  mimeTypes: ["application/pdf"],
};

/** Add Shapes draws vector shapes on one document. */
export const ADD_SHAPES_INPUT_RULES: ProcessorInputRules = {
  minFiles: 1,
  maxFiles: 1,
  extensions: [".pdf"],
  mimeTypes: ["application/pdf"],
};

/** Add Images inserts an image onto one PDF document. */
export const ADD_IMAGES_INPUT_RULES: ProcessorInputRules = {
  minFiles: 2,
  maxFiles: 2,
  extensions: [".pdf", ".jpg", ".jpeg", ".png"],
  mimeTypes: ["application/pdf", "image/jpeg", "image/png"],
  contentKind: "mixed",
};

/** Highlight marks areas on one document. */
export const HIGHLIGHT_INPUT_RULES: ProcessorInputRules = {
  minFiles: 1,
  maxFiles: 1,
  extensions: [".pdf"],
  mimeTypes: ["application/pdf"],
};

/** Draw adds vector drawings on one document. */
export const DRAW_INPUT_RULES: ProcessorInputRules = {
  minFiles: 1,
  maxFiles: 1,
  extensions: [".pdf"],
  mimeTypes: ["application/pdf"],
};

/** Annotations adds PDF annotations (comments, links) on one document. */
export const ANNOTATIONS_INPUT_RULES: ProcessorInputRules = {
  minFiles: 1,
  maxFiles: 1,
  extensions: [".pdf"],
  mimeTypes: ["application/pdf"],
};

/** Organize PDF combines reordering, rotation, and deletion on one document. */
export const ORGANIZE_PDF_INPUT_RULES: ProcessorInputRules = {
  minFiles: 1,
  maxFiles: 1,
  extensions: [".pdf"],
  mimeTypes: ["application/pdf"],
};

/** Extract Images extracts embedded raster images from one document. */
export const EXTRACT_IMAGES_INPUT_RULES: ProcessorInputRules = {
  minFiles: 1,
  maxFiles: 1,
  extensions: [".pdf"],
  mimeTypes: ["application/pdf"],
};

/** PDF to Text extracts plain searchable text from one document. */
export const PDF_TO_TEXT_INPUT_RULES: ProcessorInputRules = {
  minFiles: 1,
  maxFiles: 1,
  extensions: [".pdf"],
  mimeTypes: ["application/pdf"],
};

/** PNG → PDF accepts PNG images only, in upload order. */
export const PNG_TO_PDF_INPUT_RULES: ProcessorInputRules = {
  minFiles: 1,
  extensions: [".png"],
  mimeTypes: ["image/png"],
  contentKind: "image",
};

/** PDF → image export works on exactly one document at a time. */
export const SINGLE_PDF_TO_IMAGE_RULES: ProcessorInputRules = {
  minFiles: 1,
  maxFiles: 1,
  extensions: [".pdf"],
  mimeTypes: ["application/pdf"],
};

/** PDF to Word (text only) works on exactly one document. */
export const PDF_TO_WORD_INPUT_RULES: ProcessorInputRules = {
  minFiles: 1,
  maxFiles: 1,
  extensions: [".pdf"],
  mimeTypes: ["application/pdf"],
};

/** Unlock PDF decrypts exactly one protected document. */
export const UNLOCK_PDF_INPUT_RULES: ProcessorInputRules = {
  minFiles: 1,
  maxFiles: 1,
  extensions: [".pdf"],
  mimeTypes: ["application/pdf"],
};

/** Password Protect encrypts exactly one document. */
export const PASSWORD_PROTECT_INPUT_RULES: ProcessorInputRules = {
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

/** Redact Information works on exactly one document. */
export const REDACT_INFORMATION_INPUT_RULES: ProcessorInputRules = {
  minFiles: 1,
  maxFiles: 1,
  extensions: [".pdf"],
  mimeTypes: ["application/pdf"],
};

/** Extract Tables works on exactly one document. */
export const EXTRACT_TABLES_INPUT_RULES: ProcessorInputRules = {
  minFiles: 1,
  maxFiles: 1,
  extensions: [".pdf"],
  mimeTypes: ["application/pdf"],
};

/** PDF to Excel works on exactly one document. */
export const PDF_TO_EXCEL_INPUT_RULES: ProcessorInputRules = {
  minFiles: 1,
  maxFiles: 1,
  extensions: [".pdf"],
  mimeTypes: ["application/pdf"],
};

/** Compare Documents requires exactly two PDF documents. */
export const COMPARE_DOCUMENTS_INPUT_RULES: ProcessorInputRules = {
  minFiles: 2,
  maxFiles: 2,
  extensions: [".pdf"],
  mimeTypes: ["application/pdf"],
};

export const INPUT_RULES_BY_TOOL: Record<string, ProcessorInputRules> = {
  "compare-documents": COMPARE_DOCUMENTS_INPUT_RULES,
  "extract-tables": EXTRACT_TABLES_INPUT_RULES,
  "pdf-to-excel": PDF_TO_EXCEL_INPUT_RULES,
  "redact-information": REDACT_INFORMATION_INPUT_RULES,
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
  "pdf-to-word": PDF_TO_WORD_INPUT_RULES,
  "png-to-pdf": PNG_TO_PDF_INPUT_RULES,
  "watermark": WATERMARK_INPUT_RULES,
  "add-text": ADD_TEXT_INPUT_RULES,
  "add-shapes": ADD_SHAPES_INPUT_RULES,
  "add-images": ADD_IMAGES_INPUT_RULES,
  "highlight": HIGHLIGHT_INPUT_RULES,
  "draw": DRAW_INPUT_RULES,
  "annotations": ANNOTATIONS_INPUT_RULES,
  "organize-pdf": ORGANIZE_PDF_INPUT_RULES,
  "extract-images": EXTRACT_IMAGES_INPUT_RULES,
  "pdf-to-text": PDF_TO_TEXT_INPUT_RULES,
  "page-numbers": PAGE_NUMBERS_INPUT_RULES,
  "crop": CROP_INPUT_RULES,
  "flatten-pdf": FLATTEN_PDF_INPUT_RULES,
  "password-protect": PASSWORD_PROTECT_INPUT_RULES,
  "unlock-pdf": UNLOCK_PDF_INPUT_RULES,
};

export function getInputRules(toolId: string): ProcessorInputRules | undefined {
  return INPUT_RULES_BY_TOOL[toolId];
}
