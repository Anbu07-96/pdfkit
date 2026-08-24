import "server-only";

import { PDFDocument, PDFHexString, PDFName, PDFRef } from "pdf-lib";
import type {
  ProcessingRequest,
  ProcessingSuccess,
  ToolProcessor,
} from "@/lib/processing/contract";
import { ProcessingError } from "@/lib/processing/errors";
import { derivedDocumentName } from "@/lib/processing/file-names";
import { readDocumentMetadata } from "@/lib/processing/inspect";
import {
  loadPdfDocument,
  readPageCount,
  savePdfDocument,
} from "@/lib/processing/pdf-document";
import { REMOVE_METADATA_INPUT_RULES } from "@/lib/processing/rules";

/**
 * Remove Metadata.
 *
 * Deletes the five editable Info fields (Title, Author, Subject, Keywords,
 * Creator) and the catalog's XMP metadata stream — the same primitive the
 * compress pass has used since Phase 7, so no new dependency and no page
 * rasterising: pages, order, dimensions and content are never touched.
 *
 * Honesty rules this processor enforces on itself:
 *
 * - **The removal is verified.** The saved bytes are re-opened with pdf-lib
 *   and every targeted field is checked to be empty or gone; only then does
 *   the job succeed. A failed verification is a `PROCESSING_ERROR`, never a
 *   quiet "success" with data still inside.
 * - **Creator is emptied, not deleted.** pdf-lib's `updateInfoDict` re-inserts
 *   its own default string whenever the `/Creator` key is missing, so a true
 *   deletion would come back with library text in it. Writing an empty value
 *   instead keeps the key present (no re-stamp) while the data is verifiably
 *   gone — reported as `creatorEmptied` and stated in the interface.
 * - **The result is never claimed to be metadata-free.** pdf-lib overwrites
 *   the Producer string and the modification date on every save, so those
 *   remain — the response and the interface both say so.
 */
export class RemoveMetadataProcessor implements ToolProcessor {
  readonly toolId = "remove-metadata";
  readonly input = REMOVE_METADATA_INPUT_RULES;

  async process(
    request: ProcessingRequest,
  ): Promise<ProcessingSuccess> {
    const file = request.files[0];
    if (!file) {
      throw new ProcessingError("VALIDATION_ERROR", "No PDF was uploaded.");
    }

    const document = await loadPdfDocument(file.name, file.bytes);
    const pageCount = readPageCount(document, file.name);

    // Report what was actually found before removing anything.
    const before = readDocumentMetadata(document);
    const infoFields: (keyof Pick<
      typeof before,
      "title" | "author" | "subject" | "keywords" | "creator"
    >)[] = ["title", "author", "subject", "keywords", "creator"];
    const foundFields = infoFields.filter(
      (field) => before[field] !== null,
    ).length;
    const xmpPresent = before.xmpPresent;

    // 1. Remove the four deletable Info entries; Creator is emptied instead
    //    (see the honesty rules above).
    const info = (document as unknown as {
      getInfoDict(): {
        delete(name: unknown): void;
        set(name: unknown, value: unknown): void;
      };
    }).getInfoDict();
    for (const key of ["Title", "Author", "Subject", "Keywords"]) {
      info.delete(PDFName.of(key));
    }
    info.set(PDFName.of("Creator"), PDFHexString.fromText(""));

    // 2. Remove the XMP metadata stream. Two steps matter: dropping the
    //    catalog reference alone would leave the stream as an orphaned object
    //    that pdf-lib still serialises — the private bytes would physically
    //    remain in the file. The object is therefore also deleted from the
    //    context, so nothing of it is written.
    if (xmpPresent) {
      const xmpRef = document.catalog.get(PDFName.of("Metadata"));
      document.catalog.delete(PDFName.of("Metadata"));
      if (xmpRef instanceof PDFRef) {
        (document.context as unknown as { delete(ref: PDFRef): void }).delete(xmpRef);
      }
    }

    const bytes = await savePdfDocument(document);

    // 3. Verify by re-opening the produced bytes — never claim without proof.
    let verified: boolean;
    try {
      const reloaded = await PDFDocument.load(bytes);
      verified =
        reloaded.getTitle() === undefined &&
        reloaded.getAuthor() === undefined &&
        reloaded.getSubject() === undefined &&
        reloaded.getKeywords() === undefined &&
        // Creator: emptied (pdf-lib re-stamps a deleted key), not absent.
        reloaded.getCreator() === "" &&
        reloaded.catalog.get(PDFName.of("Metadata")) === undefined;
    } catch (cause) {
      throw new ProcessingError(
        "PROCESSING_ERROR",
        "The cleaned PDF could not be verified.",
        { cause },
      );
    }
    if (!verified) {
      throw new ProcessingError(
        "PROCESSING_ERROR",
        "The metadata could not be fully removed. Nothing was returned.",
      );
    }

    return {
      status: "succeeded",
      artifacts: [
        {
          name: derivedDocumentName(file.name, "metadata-removed"),
          mimeType: "application/pdf",
          size: bytes.length,
          bytes,
        },
      ],
      meta: {
        pages: pageCount,
        outputPages: pageCount,
        removedFields: foundFields,
        xmpRemoved: xmpPresent ? "yes" : "not-present",
        verification: "verified",
        creatorEmptied: "yes",
        // pdf-lib re-stamps these; they are NOT removed.
        producerStamped: "yes",
      },
    };
  }
}

export const removeMetadataProcessor = new RemoveMetadataProcessor();
