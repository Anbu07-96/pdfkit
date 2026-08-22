/**
 * PDF metadata model.
 *
 * Shared by the browser (the Edit Metadata workspace shows and edits fields)
 * and the server (inspection reads them, the edit processor writes them).
 * Like `pages.ts` and `compression.ts`, this module must stay free of PDF
 * libraries and `server-only` so both sides can import it.
 *
 * Field semantics, stated honestly:
 *
 * - **Editable**: title, author, subject, keywords, creator. These map onto
 *   the document's Info dictionary and are written with pdf-lib's setters.
 * - **Read-only**: producer, creation date, modification date. pdf-lib always
 *   stamps its own Producer string and re-stamps both dates whenever a
 *   document is saved, so accepting edits for them would silently lose the
 *   user's input — they are displayed, never edited.
 * - An empty edit **removes** the Info entry entirely (verified by re-reading
 *   the output), and a missing form field means **leave unchanged**.
 */

/** Fields the Edit Metadata tool may change. */
export const EDITABLE_METADATA_FIELDS = [
  "title",
  "author",
  "subject",
  "keywords",
  "creator",
] as const;

export type EditableMetadataField = (typeof EDITABLE_METADATA_FIELDS)[number];

/** Maximum characters accepted for any single metadata field. */
export const MAX_METADATA_FIELD_LENGTH = 2000;

/** Maximum number of keywords accepted. */
export const MAX_KEYWORDS = 50;

/** Maximum characters per keyword. */
export const MAX_KEYWORD_LENGTH = 200;

/**
 * What inspection reports. `null` means "not present in the document" — never
 * an invented or default value. Dates are ISO strings so they can travel as
 * JSON; the browser formats them for display.
 */
export interface DocumentMetadata {
  title: string | null;
  author: string | null;
  subject: string | null;
  keywords: string[] | null;
  creator: string | null;
  producer: string | null;
  creationDate: string | null;
  modificationDate: string | null;
}

/** Editable values as they arrive from a multipart form (all optional). */
export interface MetadataEditInput {
  title?: string;
  author?: string;
  subject?: string;
  /** Comma-separated, e.g. `"finance, 2026, report"`. */
  keywords?: string;
  creator?: string;
}

/** Split a keywords input into clean keywords; `"a, b,, c"` → `["a","b","c"]`. */
export function parseKeywordsInput(raw: string): string[] {
  return raw
    .split(",")
    .map((keyword) => keyword.trim())
    .filter((keyword) => keyword.length > 0);
}

/** Join stored keywords back into an input-friendly string. */
export function formatKeywords(keywords: string[] | null): string {
  return keywords?.join(", ") ?? "";
}

/** Human-friendly, deterministic rendering of an ISO date (UTC). */
export function formatMetadataDate(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 16)} UTC`;
}

export type MetadataFieldIssue =
  | { field: EditableMetadataField; message: string };

/**
 * Validate one field's raw form value: it must be a string within the length
 * budget, and keywords are additionally bounded in count and per-entry size.
 * Returns the first problem found, or `null` when the value is acceptable.
 */
export function validateMetadataField(
  field: EditableMetadataField,
  value: unknown,
): MetadataFieldIssue | null {
  if (typeof value !== "string") {
    return { field, message: `The ${field} must be text.` };
  }
  if (value.length > MAX_METADATA_FIELD_LENGTH) {
    return {
      field,
      message: `The ${field} must be ${MAX_METADATA_FIELD_LENGTH} characters or fewer.`,
    };
  }
  if (field === "keywords") {
    const keywords = parseKeywordsInput(value);
    if (keywords.length > MAX_KEYWORDS) {
      return {
        field,
        message: `No more than ${MAX_KEYWORDS} keywords are allowed.`,
      };
    }
    const tooLong = keywords.find(
      (keyword) => keyword.length > MAX_KEYWORD_LENGTH,
    );
    if (tooLong) {
      return {
        field,
        message: `Each keyword must be ${MAX_KEYWORD_LENGTH} characters or fewer.`,
      };
    }
  }
  return null;
}
