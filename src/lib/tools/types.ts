/**
 * Tool domain types.
 *
 * This module is the type contract for the PDFKit tool catalog. It is a pure
 * data layer: it contains no React, no browser APIs and no document
 * processing. UI (presentation) and, later, processing services both read from
 * it, which keeps tool metadata in exactly one place.
 */

/**
 * Availability state of a tool.
 *
 * - `AVAILABLE`   – the tool is genuinely implemented and usable today.
 * - `COMING_SOON` – the tool is planned; the page exists but does no work.
 * - `PRO`         – implemented, but reserved for a future paid plan.
 * - `DISABLED`    – temporarily turned off (e.g. incident, deprecation).
 *
 * Only tools that really work may ever be marked `AVAILABLE` or `PRO`: the
 * status must be backed by a registered processor (`lib/processing/registry`).
 */
export type ToolStatus = "AVAILABLE" | "COMING_SOON" | "PRO" | "DISABLED";

/** Plan a tool is expected to belong to once it ships. Purely informational. */
export type ToolTier = "free" | "pro";

export type ToolCategoryId =
  | "organize"
  | "convert"
  | "edit"
  | "security"
  | "ocr"
  | "ai";

/**
 * Icon key. Resolved to a concrete icon component by the presentation layer
 * (`components/tools/tool-icon.tsx`) so that the catalog stays serializable and
 * free of React imports.
 */
export type ToolIconName =
  | "ai-compare"
  | "ai-notes"
  | "ai-summarize"
  | "annotate"
  | "ask"
  | "calendar"
  | "compress"
  | "crop"
  | "draw"
  | "excel"
  | "extract"
  | "highlight"
  | "image"
  | "key-points"
  | "list-checks"
  | "lock"
  | "merge"
  | "metadata"
  | "page-numbers"
  | "pdf"
  | "powerpoint"
  | "redact"
  | "reorder"
  | "rotate"
  | "scan"
  | "shapes"
  | "signature"
  | "split"
  | "table"
  | "text"
  | "translate"
  | "trash"
  | "unlock"
  | "watermark"
  | "word";

export interface ToolCategory {
  id: ToolCategoryId;
  name: string;
  /** Short label used in dense UI such as the desktop navigation. */
  shortName: string;
  description: string;
  icon: ToolIconName;
  route: string;
}

export interface Tool {
  id: string;
  name: string;
  description: string;
  category: ToolCategoryId;
  icon: ToolIconName;
  route: string;
  status: ToolStatus;
  /** Plan the tool is expected to ship on. Never implies availability. */
  plannedTier: ToolTier;
  /** File extensions the tool is designed to accept, e.g. `[".pdf"]`. */
  supportedFileTypes: string[];
  /** MIME types matching {@link supportedFileTypes}, for input `accept`. */
  acceptedMimeTypes: string[];
  /** Extra search terms that are not present in the name or description. */
  keywords: string[];
  /** Short, honest explanation of the planned steps, used on tool pages. */
  howItWorks: string[];
}
