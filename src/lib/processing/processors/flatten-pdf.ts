import "server-only";

import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFSignature,
  type PDFObject,
} from "pdf-lib";
import type {
  ProcessingRequest,
  ProcessingSuccess,
  ToolProcessor,
} from "@/lib/processing/contract";
import { ProcessingError } from "@/lib/processing/errors";
import {
  loadPdfDocument,
  readPageCount,
  savePdfDocument,
  stampPdfKitMetadata,
} from "@/lib/processing/pdf-document";
import { FLATTEN_PDF_INPUT_RULES } from "@/lib/processing/rules";

/**
 * Flatten PDF — vector form flattening, never rasterisation.
 *
 * Interactive AcroForm fields are converted into permanent page content with
 * pdf-lib's `PDFForm.flatten()`: the field appearance streams are drawn into
 * the page content and the fields are removed. Pages are never rebuilt as
 * images, so text stays selectable and extractable, and links and other
 * ordinary annotations survive. Page count, order and rotation are untouched
 * — the processor's own self-verification proves all of that on every run.
 *
 * Honesty contract, stated here and everywhere the tool is presented:
 *
 * - **Flattening is irreversible.** Field values become ordinary page content
 *   and can no longer be edited as form fields.
 * - **Signed PDFs are rejected before any mutation** (`SIGNED_PDF`).
 *   Flattening rewrites the file, which would invalidate a digital signature;
 *   silently destroying a signature is never acceptable.
 * - **Document-level JavaScript and OpenActions are NOT removed.** Flattening
 *   removes form fields only. This tool is not a sanitiser and must never be
 *   presented as a security feature.
 *
 * pdf-lib 1.17.1 issue handled here: `form.flatten()` empties the AcroForm's
 * `/Fields` but leaves the deleted widget references behind in each page's
 * `/Annots` array. Those dangling references are removed in a cleanup pass
 * that touches nothing else — annotations that still resolve (links, notes)
 * are preserved as they are. The now-empty AcroForm dictionary is dropped.
 */

const ACRO_FORM = PDFName.of("AcroForm");
const ANNOTS = PDFName.of("Annots");
const FIELDS = PDFName.of("Fields");
const FT = PDFName.of("FT");
const SIG = PDFName.of("Sig");
const SIG_FLAGS = PDFName.of("SigFlags");

/** Per-page facts captured before mutation, checked again on the output. */
interface PageFacts {
  rotation: number;
  mediaWidth: number;
  mediaHeight: number;
  /** Annotations that resolve to a real object (links, notes, widgets…). */
  resolvableAnnotations: number;
}

function readPageFacts(document: PDFDocument): PageFacts[] {
  return document.getPages().map((page) => {
    const media = page.getMediaBox();
    let resolvable = 0;
    const annots = page.node.lookup(ANNOTS);
    if (annots instanceof PDFArray) {
      for (let index = 0; index < annots.size(); index += 1) {
        const entry = annots.get(index);
        const resolved =
          entry instanceof PDFRef ? document.context.lookup(entry) : entry;
        if (resolved !== undefined) resolvable += 1;
      }
    }
    return {
      rotation: page.getRotation().angle,
      mediaWidth: media.width,
      mediaHeight: media.height,
      resolvableAnnotations: resolvable,
    };
  });
}

/**
 * Detect signature fields **before** any mutation.
 *
 * Two independent checks, belt and braces: pdf-lib's typed field model
 * (`PDFSignature`), and the raw `/FT /Sig` entry on each field dictionary.
 * The AcroForm's `SigFlags` bit 1 ("signatures exist") is honoured as well.
 */
function hasSignatureField(document: PDFDocument): boolean {
  const acroForm = document.catalog.lookup(ACRO_FORM);
  if (acroForm instanceof PDFDict) {
    const sigFlags = acroForm.lookup(SIG_FLAGS);
    if (sigFlags instanceof PDFNumber && (sigFlags.asNumber() & 1) === 1) {
      return true;
    }
  }

  const form = document.getForm();
  return form.getFields().some((field) => {
    if (field instanceof PDFSignature) return true;
    return field.acroField.dict.lookup(FT) === SIG;
  });
}

/**
 * Remove the widget references `form.flatten()` leaves dangling in each
 * page's `/Annots` array (pdf-lib 1.17.1). Only references that no longer
 * resolve to any object are dropped — annotations that still resolve (links,
 * text notes, and so on) are preserved untouched, never blindly removed.
 * Returns how many dangling references were removed.
 */
function removeDanglingAnnotationRefs(document: PDFDocument): number {
  let removed = 0;

  for (const page of document.getPages()) {
    const annots = page.node.lookup(ANNOTS);
    if (!(annots instanceof PDFArray)) continue;

    const kept: PDFObject[] = [];
    for (let index = 0; index < annots.size(); index += 1) {
      const entry = annots.get(index);
      if (entry instanceof PDFRef && document.context.lookup(entry) === undefined) {
        removed += 1; // Dangling: points at a deleted object.
        continue;
      }
      kept.push(entry);
    }

    if (kept.length === annots.size()) continue;
    if (kept.length === 0) {
      page.node.delete(ANNOTS);
    } else {
      page.node.set(ANNOTS, document.context.obj(kept));
    }
  }

  return removed;
}

/** Drop the AcroForm dictionary once it holds no fields at all. */
function removeEmptyAcroForm(document: PDFDocument): void {
  const raw = document.catalog.get(ACRO_FORM);
  if (raw === undefined) return;

  const acroForm = document.catalog.lookup(ACRO_FORM);
  if (!(acroForm instanceof PDFDict)) return;

  const fields = acroForm.lookup(FIELDS);
  const isEmpty =
    fields === undefined || (fields instanceof PDFArray && fields.size() === 0);
  if (!isEmpty) return;

  document.catalog.delete(ACRO_FORM);
  if (raw instanceof PDFRef) document.context.delete(raw);
}

export class FlattenPdfProcessor implements ToolProcessor {
  readonly toolId = "flatten-pdf";
  readonly input = FLATTEN_PDF_INPUT_RULES;

  async process(
    request: ProcessingRequest<Record<string, unknown>>,
  ): Promise<ProcessingSuccess> {
    const file = request.files[0];
    if (!file) {
      throw new ProcessingError("VALIDATION_ERROR", "No PDF was uploaded.");
    }

    const document = await loadPdfDocument(file.name, file.bytes);
    const pageCount = readPageCount(document, file.name);

    // Facts recorded before any mutation, for the output self-verification.
    const factsBefore = readPageFacts(document);

    // `getForm()` would create an AcroForm on documents that have none, so
    // the raw catalog entry is checked first — a form-free PDF passes through
    // with zero flattened fields and no fabricated structures.
    const hasAcroForm = document.catalog.get(ACRO_FORM) !== undefined;

    let fieldCount = 0;
    if (hasAcroForm) {
      let signed: boolean;
      try {
        signed = hasSignatureField(document);
        if (!signed) fieldCount = document.getForm().getFields().length;
      } catch (cause) {
        throw new ProcessingError("INVALID_PDF", "A PDF form could not be read.", {
          details: [`${file.name} has a form that could not be read — the file may be damaged.`],
          cause,
        });
      }

      // Signed PDFs are rejected BEFORE flatten() ever runs: flattening
      // rewrites the file and would invalidate the signature. Refusing is the
      // only honest behaviour — a signature must never be silently destroyed.
      if (signed) {
        throw new ProcessingError(
          "SIGNED_PDF",
          "This PDF contains a digital signature and cannot be flattened.",
          {
            details: [
              "Flattening rewrites the PDF, which would invalidate the signature.",
              "Remove or complete the signature workflow in the source application first.",
            ],
          },
        );
      }

      if (fieldCount > 0) {
        try {
          document.getForm().flatten();
        } catch (cause) {
          throw new ProcessingError(
            "PROCESSING_ERROR",
            "The form fields could not be flattened.",
            { cause },
          );
        }
      }

      // pdf-lib 1.17.1 cleanup: drop the dangling widget references flatten()
      // leaves in /Annots, then the now-empty AcroForm dictionary. Valid
      // annotations (links and the rest) are preserved exactly as they are.
      removeDanglingAnnotationRefs(document);
      removeEmptyAcroForm(document);
    }

    stampPdfKitMetadata(document);
    const bytes = await savePdfDocument(document);

    // Self-verification: reopen the output and prove that flattening changed
    // exactly what it claims to change and nothing else.
    let verified: boolean;
    try {
      const reloaded = await PDFDocument.load(bytes);
      const factsAfter = readPageFacts(reloaded);

      verified =
        // Page count and order preserved (order via per-page MediaBox size).
        reloaded.getPageCount() === pageCount &&
        factsAfter.length === factsBefore.length &&
        factsAfter.every(
          (facts, index) =>
            facts.rotation === factsBefore[index].rotation &&
            Math.abs(facts.mediaWidth - factsBefore[index].mediaWidth) < 0.01 &&
            Math.abs(facts.mediaHeight - factsBefore[index].mediaHeight) < 0.01,
        ) &&
        // No form fields remain: the AcroForm dictionary is gone entirely.
        reloaded.catalog.get(ACRO_FORM) === undefined &&
        // No dangling widget references remain anywhere.
        reloaded.getPages().every((page) => {
          const annots = page.node.lookup(ANNOTS);
          if (annots === undefined) return true;
          if (!(annots instanceof PDFArray)) return false;
          for (let index = 0; index < annots.size(); index += 1) {
            const entry = annots.get(index);
            const resolvedEntry =
              entry instanceof PDFRef ? reloaded.context.lookup(entry) : entry;
            if (resolvedEntry === undefined) return false;
          }
          return true;
        });
    } catch (cause) {
      throw new ProcessingError(
        "PROCESSING_ERROR",
        "The flattened PDF could not be verified.",
        { cause },
      );
    }
    if (!verified) {
      throw new ProcessingError(
        "PROCESSING_ERROR",
        "The flattened PDF failed verification. Nothing was returned.",
      );
    }

    return {
      status: "succeeded",
      artifacts: [
        {
          // Fixed output name: never carries the source filename.
          name: "flattened.pdf",
          mimeType: "application/pdf",
          size: bytes.length,
          bytes,
        },
      ],
      meta: {
        pages: pageCount,
        outputPages: pageCount,
        flattenedFields: fieldCount,
      },
    };
  }
}

export const flattenPdfProcessor = new FlattenPdfProcessor();
