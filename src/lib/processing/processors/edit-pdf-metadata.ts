import "server-only";

import { PDFDict, PDFHexString, PDFName } from "pdf-lib";
import type {
  ProcessingRequest,
  ProcessingSuccess,
  ToolProcessor,
} from "@/lib/processing/contract";
import { ProcessingError } from "@/lib/processing/errors";
import { derivedDocumentName } from "@/lib/processing/file-names";
import {
  EDITABLE_METADATA_FIELDS,
  parseKeywordsInput,
  validateMetadataField,
  type EditableMetadataField,
} from "@/lib/processing/metadata";
import {
  loadPdfDocument,
  readPageCount,
  savePdfDocument,
} from "@/lib/processing/pdf-document";
import { SINGLE_PDF_INPUT_RULES } from "@/lib/processing/rules";

/**
 * Options accepted by the Edit Metadata API.
 *
 * Each field arrives as a raw form string. Semantics per field:
 * - **absent** → leave the document's value unchanged;
 * - **empty string** → remove the Info entry entirely;
 * - **anything else** → set the value (keywords are comma-separated).
 *
 * The server validates types and lengths itself; the browser's checks are a
 * convenience, never a source of truth.
 */
export interface EditPdfMetadataOptions extends Record<string, unknown> {
  title?: unknown;
  author?: unknown;
  subject?: unknown;
  keywords?: unknown;
  creator?: unknown;
}

/** Info-dictionary key for each editable field. */
const INFO_KEYS: Record<EditableMetadataField, string> = {
  title: "Title",
  author: "Author",
  subject: "Subject",
  keywords: "Keywords",
  creator: "Creator",
};

/**
 * Edit PDF Metadata.
 *
 * Changes only the document's Info dictionary — pages, content and structure
 * are never touched, and only the five supported fields may be written (no
 * arbitrary PDF object manipulation). Producer and the dates are not editable
 * because pdf-lib re-stamps them on every save; that is stated in the
 * interface rather than silently losing the input. Removed fields are deleted
 * from the dictionary, and tests re-read the output to prove the removal.
 */
export class EditPdfMetadataProcessor implements ToolProcessor<EditPdfMetadataOptions> {
  readonly toolId = "edit-pdf-metadata";
  readonly input = SINGLE_PDF_INPUT_RULES;

  async process(
    request: ProcessingRequest<EditPdfMetadataOptions>,
  ): Promise<ProcessingSuccess> {
    const file = request.files[0];
    if (!file) {
      throw new ProcessingError("VALIDATION_ERROR", "No PDF was uploaded.");
    }

    // Validate every supplied field before touching the document.
    const updates: Partial<
      Record<EditableMetadataField, string | string[]>
    > = {};
    for (const field of EDITABLE_METADATA_FIELDS) {
      const raw = request.options?.[field];
      if (raw === undefined) continue;

      const issue = validateMetadataField(field, raw);
      if (issue) {
        throw new ProcessingError("VALIDATION_ERROR", issue.message, {
          details: [`Check the ${issue.field} field.`],
        });
      }

      updates[field] =
        field === "keywords" ? parseKeywordsInput(raw as string) : (raw as string);
    }

    const document = await loadPdfDocument(file.name, file.bytes);
    const pageCount = readPageCount(document, file.name);

    // `getInfoDict` is pdf-lib's own accessor and creates the dictionary when
    // a document has none, so writes work even for spartan hand-built PDFs.
    // It is private in the typings only; this is the same path every
    // `set*`/`get*` metadata method takes.
    const info = (document as unknown as { getInfoDict(): PDFDict }).getInfoDict();

    let updated = 0;
    for (const [field, value] of Object.entries(updates) as [
      EditableMetadataField,
      string | string[],
    ][]) {
      const key = PDFName.of(INFO_KEYS[field]);

      if (Array.isArray(value)) {
        // Keywords: written as one comma-joined string, because pdf-lib's
        // array setter joins with spaces and would lose the separation.
        if (value.length === 0) {
          info.delete(key);
        } else {
          info.set(key, PDFHexString.fromText(value.join(", ")));
        }
      } else if (value === "") {
        // An empty edit removes the entry entirely.
        info.delete(key);
      } else {
        info.set(key, PDFHexString.fromText(value));
      }
      updated += 1;
    }

    const bytes = await savePdfDocument(document);

    return {
      status: "succeeded",
      artifacts: [
        {
          name: derivedDocumentName(file.name, "metadata"),
          mimeType: "application/pdf",
          size: bytes.length,
          bytes,
        },
      ],
      meta: {
        pages: pageCount,
        outputPages: pageCount,
        updatedFields: updated,
      },
    };
  }
}

export const editPdfMetadataProcessor = new EditPdfMetadataProcessor();
