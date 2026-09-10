import "server-only";

import { PDFDict, PDFName, PDFRawStream } from "pdf-lib";
import { ProcessingError } from "@/lib/processing/errors";
import { detectImageKind, inspectImage } from "@/lib/processing/images";
import { loadPdfDocument, readPageCount } from "@/lib/processing/pdf-document";
import { hasPdfSignature } from "@/lib/processing/validation/pdf-input";
import { extractPdfPageTexts } from "@/lib/thumbnails/renderer";

/**
 * DocumentProfile (Phase 68, Stage 2).
 *
 * A privacy-safe, versioned description of an input document's
 * characteristics — counts, ratios and flags only. Never text content,
 * names, metadata or anything user-identifying.
 *
 * ## Two tiers, deliberately
 *
 * 1. **Signature tier** (`describeInputFile`) — byte signature, size and
 *    client-reported MIME type. Costs one scan of the first KiB; no parser
 *    is touched. This is the ONLY tier the live conversion path uses (the
 *    engine adapters attach it to `EngineResult.profile`), so Stage 2 adds
 *    no parsing, no pdfium work and no pdf-lib work to any request.
 *
 * 2. **Full tier** (`buildDocumentProfile`) — opens the document (pdfium
 *    text pass + pdf-lib structural walk) to compute page/text/image
 *    signals. This is diagnostic infrastructure for later stages
 *    (QualityGate, profiling-based routing) and is **not** invoked by the
 *    conversion request path: every conversion already parses its input
 *    exactly once, and an upfront full profile would duplicate that work —
 *    the pattern this phase is explicitly forbidden from introducing.
 *
 * ## Philosophy
 *
 * `known > guessed`, `unknown > false precision`: fields the current
 * implementation cannot determine cheaply stay `undefined`, and the scanned
 * estimate is named `likelyScanned` because absent text alone never proves a
 * page is scanned (blank, vector-only and malformed pages exist). No OCR is
 * performed or implied.
 */

/** Bump when the profile shape or computation changes. */
export const PROFILE_VERSION = 1 as const;

/** What the bytes demonstrably are, by signature. */
export type ProfiledDocumentKind = "pdf" | "jpeg" | "png" | "unknown";

/**
 * How far the analysis got. Consumers must treat anything but
 * `"complete"` as "the absent fields are unknown", never as false values.
 */
export type ProfileAnalysisState =
  /** Signature-tier facts only (cheap tier, or nothing more is analyzable). */
  | "signature-only"
  /** Full analysis finished for the requested options. */
  | "complete"
  /** The document is password-protected; content signals are unknowable. */
  | "encrypted-input"
  /** Bytes carry a PDF signature but no parser could open them. */
  | "unreadable-input"
  /** Text signals skipped: the page count exceeds the profiling cap. */
  | "text-limited";

export interface DocumentProfile {
  /** Shape/computation version of this profile. */
  readonly profileVersion: typeof PROFILE_VERSION;
  /** FACT — real byte signature, not the claimed file name or MIME. */
  readonly documentKind: ProfiledDocumentKind;
  /** FACT — upload size in bytes. */
  readonly fileSizeBytes: number;
  /** FACT — client-reported MIME type (advisory only, never trusted). */
  readonly inputMimeType: string;
  /** How far the analysis got; see {@link ProfileAnalysisState}. */
  readonly analysisState: ProfileAnalysisState;
  /** FACT — total pages, when a parser determined it. */
  readonly pageCount?: number;
  /** FACT — whether the document is password-protected, when determined. */
  readonly encrypted?: boolean;
  /** FACT — pages with extractable text (pdfium text pass). */
  readonly textPageCount?: number;
  /** FACT — pages with no extractable text. */
  readonly emptyTextPageCount?: number;
  /** FACT — total extracted characters across pages. */
  readonly textCharacterCount?: number;
  /** FACT — textPageCount / pageCount. */
  readonly textYieldRatio?: number;
  /** FACT — image XObjects found by the structural walk (capped pages). */
  readonly imageObjectCount?: number;
  /** FACT — pages carrying at least one image XObject. */
  readonly imageBearingPageCount?: number;
  /**
   * HEURISTIC — pages with no extractable text AND at least one image
   * object. Evidence consistent with scanning, not proof of it.
   */
  readonly likelyScannedPageCount?: number;
  /** HEURISTIC — likelyScannedPageCount / pageCount. */
  readonly likelyScannedRatio?: number;
  /** FACT — pixel width, for image inputs with readable headers. */
  readonly imageWidth?: number;
  /** FACT — pixel height, for image inputs with readable headers. */
  readonly imageHeight?: number;
}

/** The file shape profiling needs (a `ProcessingInputFile` satisfies it). */
export interface ProfiledFile {
  readonly mimeType: string;
  readonly size: number;
  readonly bytes: Uint8Array;
}

/** Signature-level kind detection: PDF header, JPEG magic, PNG magic. */
export function detectDocumentKind(bytes: Uint8Array): ProfiledDocumentKind {
  if (hasPdfSignature(bytes)) return "pdf";
  const imageKind = detectImageKind(bytes);
  if (imageKind === "jpeg") return "jpeg";
  if (imageKind === "png") return "png";
  return "unknown";
}

/**
 * Signature tier: describe a file from bytes it already holds in memory.
 * No parsing, no pdfium, no pdf-lib — safe to call on every request.
 * Returns `undefined` only when there is no file at all.
 */
export function describeInputFile(file?: ProfiledFile): DocumentProfile | undefined {
  if (!file) return undefined;
  return {
    profileVersion: PROFILE_VERSION,
    documentKind: detectDocumentKind(file.bytes),
    fileSizeBytes: file.size,
    inputMimeType: file.mimeType,
    analysisState: "signature-only",
  };
}

/** Page cap for the pdfium text pass (keeps profiling cost bounded). */
export const PROFILE_TEXT_MAX_PAGES = 200;
/** Page cap for the pdf-lib image-object walk (skipped above it). */
export const PROFILE_IMAGE_WALK_MAX_PAGES = 200;

export interface BuildDocumentProfileOptions {
  /** Run the pdfium text-extraction pass (default true). */
  readonly includeTextSignals?: boolean;
  /** Run the pdf-lib image-object walk (default true). */
  readonly includeImageObjects?: boolean;
  /** Override the text-pass page cap (mainly for tests). */
  readonly maxTextPages?: number;
}

/** The pdf-lib document handle type the structural walk works on. */
type PdfLibDocument = Awaited<ReturnType<typeof loadPdfDocument>>;

/**
 * Count the image XObject streams of one page — the same walk
 * `extract-images` uses (including its contents-length condition), so the
 * profiler and the tool can never disagree about what counts as an image.
 */
function countPageImageObjects(
  document: PdfLibDocument,
  pageIndex: number,
): number {
  const page = document.getPage(pageIndex);
  const resources = page.node.get(PDFName.of("Resources"));
  if (!resources) return 0;

  const resDict = document.context.lookup(resources);
  if (!(resDict instanceof PDFDict)) return 0;

  const xObject = resDict.get(PDFName.of("XObject"));
  if (!xObject) return 0;

  const xObjectDict = document.context.lookup(xObject);
  if (!(xObjectDict instanceof PDFDict)) return 0;

  let count = 0;
  for (const key of xObjectDict.keys()) {
    const obj = document.context.lookup(xObjectDict.get(key));
    if (obj instanceof PDFRawStream) {
      const subtype = obj.dict.get(PDFName.of("Subtype"));
      if (subtype?.toString() === "/Image" && obj.getContents().length > 0) {
        count += 1;
      }
    }
  }
  return count;
}

/**
 * Full tier: analyse a document for text/page/image signals.
 *
 * Cost (when both signals are requested for a PDF): one pdfium text pass
 * over the input plus one pdf-lib structural walk — real parsing, which is
 * exactly why the conversion request path does NOT call this. It exists for
 * diagnostics and for later stages that will consume the profile at the
 * right point in the pipeline.
 */
export async function buildDocumentProfile(
  file: ProfiledFile,
  options: BuildDocumentProfileOptions = {},
): Promise<DocumentProfile> {
  const {
    includeTextSignals = true,
    includeImageObjects = true,
    maxTextPages = PROFILE_TEXT_MAX_PAGES,
  } = options;

  const base = describeInputFile(file);
  if (!base) {
    throw new ProcessingError("VALIDATION_ERROR", "No document was given.");
  }

  // Non-PDF inputs: images get their (already cheap) header dimensions;
  // anything else has no analyzable structure for now.
  if (base.documentKind === "jpeg" || base.documentKind === "png") {
    const inspected = inspectImage("input", file.bytes);
    if ("image" in inspected) {
      return {
        ...base,
        analysisState: "complete",
        imageWidth: inspected.image.width,
        imageHeight: inspected.image.height,
      };
    }
    return { ...base, analysisState: "signature-only" };
  }
  if (base.documentKind === "unknown") {
    return { ...base, analysisState: "signature-only" };
  }

  // PDF path.
  let profile: DocumentProfile = { ...base };
  let texts: string[] | undefined;
  let pageCountFromText: number | undefined;
  let textLimited = false;

  if (includeTextSignals) {
    try {
      const result = await extractPdfPageTexts(file.bytes, {
        maxPages: maxTextPages,
      });
      texts = result.texts;
      pageCountFromText = result.pageCount;
      const textPages = texts.filter((text) => text.trim().length > 0).length;
      profile = {
        ...profile,
        textPageCount: textPages,
        emptyTextPageCount: result.pageCount - textPages,
        textCharacterCount: texts.reduce((total, text) => total + text.length, 0),
        textYieldRatio: textPages / result.pageCount,
      };
    } catch (error) {
      if (error instanceof ProcessingError) {
        if (error.code === "ENCRYPTED_PDF") {
          return { ...profile, analysisState: "encrypted-input", encrypted: true };
        }
        if (error.code === "TOO_MANY_OUTPUTS") {
          textLimited = true;
        } else {
          // INVALID_PDF and any other typed failure: the document cannot be
          // analysed. Report what is known — nothing content-bearing leaks.
          return { ...profile, analysisState: "unreadable-input" };
        }
      } else {
        throw error;
      }
    }
  }

  try {
    const document = await loadPdfDocument("input", file.bytes);
    const pageCount = readPageCount(document, "input");
    profile = { ...profile, pageCount, encrypted: false };

    if (
      includeImageObjects &&
      pageCount <= PROFILE_IMAGE_WALK_MAX_PAGES
    ) {
      let imageObjects = 0;
      let imageBearingPages = 0;
      const pageHasImage: boolean[] = [];
      for (let index = 0; index < pageCount; index += 1) {
        const count = countPageImageObjects(document, index);
        pageHasImage.push(count > 0);
        imageObjects += count;
        if (count > 0) imageBearingPages += 1;
      }
      profile = {
        ...profile,
        imageObjectCount: imageObjects,
        imageBearingPageCount: imageBearingPages,
      };

      if (texts) {
        const likelyScanned = pageHasImage.reduce(
          (total, hasImage, index) =>
            total + (hasImage && (texts[index] ?? "").trim().length === 0 ? 1 : 0),
          0,
        );
        profile = {
          ...profile,
          likelyScannedPageCount: likelyScanned,
          likelyScannedRatio: likelyScanned / pageCount,
        };
      }
    }
  } catch (error) {
    if (error instanceof ProcessingError && error.code === "ENCRYPTED_PDF") {
      return { ...profile, encrypted: true, analysisState: "encrypted-input" };
    }
    if (error instanceof ProcessingError) {
      // pdf-lib could not open what pdfium possibly could. Keep whatever
      // signals were measured; without any, the input is unreadable.
      if (pageCountFromText !== undefined) {
        profile = { ...profile, pageCount: pageCountFromText };
      } else if (profile.pageCount === undefined) {
        return { ...profile, analysisState: "unreadable-input" };
      }
    } else {
      throw error;
    }
  }

  const analysisState: ProfileAnalysisState = textLimited
    ? "text-limited"
    : "complete";
  return { ...profile, analysisState };
}

/**
 * A memoized, on-demand profile: `resolve()` computes the full profile at
 * most once per instance; nothing is computed until the first call. This is
 * the shape later stages (QualityGate, profile-aware routing) will consume —
 * Stage 2 creates the capability but the conversion path never resolves it.
 */
export interface LazyDocumentProfile {
  resolve(): Promise<DocumentProfile>;
  /** True once `resolve()` has been invoked (regardless of outcome). */
  isRequested(): boolean;
}

export function createLazyDocumentProfile(
  file: ProfiledFile,
  options?: BuildDocumentProfileOptions,
): LazyDocumentProfile {
  let promise: Promise<DocumentProfile> | undefined;
  return {
    resolve() {
      promise ??= buildDocumentProfile(file, options);
      return promise;
    },
    isRequested() {
      return promise !== undefined;
    },
  };
}
