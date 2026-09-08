import type { ToolIconName } from "@/lib/tools";
import type { UserAccountTier } from "@/lib/auth/types";

/**
 * Bulk Tools catalog and batch limits (Phase 61).
 *
 * Bulk operations are deliberately **not** entries in `TOOLS`: a catalog tool
 * may only be `AVAILABLE` when it has a server-side processor
 * (`catalog.test.ts` / `registry.test.ts` enforce that), and bulk tools have
 * none — they are a **browser-orchestrated batch** over the existing
 * single-file endpoints. The browser sends each file as its own ordinary
 * request, so every existing control (quota preflight + metering, IP rate
 * limit, concurrency cap, origin check, file validation, filename
 * sanitisation, in-memory-only processing, cleanup) applies to every file of a
 * batch by construction. There is no bulk bypass and no new server processing
 * surface.
 *
 * This module is pure data with no React, no PDF libraries and no
 * `server-only` marker: the bulk pages render it on the server, the batch
 * runner consumes it in the browser.
 */

export type BulkOperationId =
  | "pdf-to-word"
  | "pdf-to-excel"
  | "pdf-to-text"
  | "pdf-to-jpg"
  | "pdf-to-png"
  | "images-to-pdf"
  | "extract-images";

/** How one input file's result is delivered by the underlying endpoint. */
export type BulkOutputKind =
  /** Exactly one output file per input (e.g. one .docx per PDF). */
  | "single"
  /**
   * A ZIP of several outputs per input (e.g. one JPG per page, or the
   * embedded images of one PDF). The batch ZIP flattens these into one
   * folder per source file.
   */
  | "archive";

export interface BulkOperation {
  id: BulkOperationId;
  name: string;
  description: string;
  /** Landing route, derived from the id. */
  route: `/bulk/${BulkOperationId}`;
  /** The existing, genuinely implemented single-file endpoint used per file. */
  endpoint: `/api/tools/${BulkOperationId}`;
  /** Icon key, resolved by the shared presentation-layer icon registry. */
  icon: ToolIconName;
  /** Lower-case, dot-prefixed input extensions. */
  supportedFileTypes: string[];
  /** MIME types matching {@link supportedFileTypes}. */
  acceptedMimeTypes: string[];
  outputKind: BulkOutputKind;
  /**
   * Rasterising operations track a per-batch page budget so a batch cannot
   * ask the server to rasterise an unbounded number of pages.
   */
  pageBudget: boolean;
  /**
   * Extract Images tracks a per-batch image budget (sum of the server-reported
   * per-file image counts).
   */
  imageBudget: boolean;
  /** Extra search terms for the bulk landing page. */
  keywords: string[];
  howItWorks: string[];
}

function pdfOperation(
  operation: Omit<
    BulkOperation,
    "route" | "endpoint" | "supportedFileTypes" | "acceptedMimeTypes"
  > &
    Partial<Pick<BulkOperation, "supportedFileTypes" | "acceptedMimeTypes">>,
): BulkOperation {
  return {
    route: `/bulk/${operation.id}`,
    endpoint: `/api/tools/${operation.id}`,
    supportedFileTypes: [".pdf"],
    acceptedMimeTypes: ["application/pdf"],
    ...operation,
  };
}

export const BULK_OPERATIONS: readonly BulkOperation[] = [
  pdfOperation({
    id: "pdf-to-word",
    icon: "word",
    name: "Bulk PDF to Word",
    description:
      "Convert many PDFs into editable Word documents, one .docx per file.",
    outputKind: "single",
    pageBudget: false,
    imageBudget: false,
    keywords: ["batch", "docx", "multiple", "mass convert"],
    howItWorks: [
      "Add the PDF files you want converted (drag and drop works).",
      "Each PDF is converted on the server, one file at a time, with live status per file.",
      "Download each .docx individually, or everything as one ZIP. Text only — formatting and images are not preserved.",
    ],
  }),
  pdfOperation({
    id: "pdf-to-excel",
    icon: "excel",
    name: "Bulk PDF to Excel",
    description:
      "Turn tables inside many PDFs into Excel spreadsheets, one .xlsx per file.",
    outputKind: "single",
    pageBudget: false,
    imageBudget: false,
    keywords: ["batch", "xlsx", "spreadsheet", "multiple", "tables"],
    howItWorks: [
      "Add the PDFs that contain tabular data.",
      "Each PDF is converted on the server, one file at a time, with live status per file.",
      "Download each .xlsx individually, or everything as one ZIP.",
    ],
  }),
  pdfOperation({
    id: "pdf-to-text",
    icon: "text",
    name: "Bulk PDF to Text",
    description:
      "Extract the text of many PDFs into plain .txt files, one per document.",
    outputKind: "single",
    pageBudget: false,
    imageBudget: false,
    keywords: ["batch", "txt", "plain text", "multiple"],
    howItWorks: [
      "Add the PDFs whose text you need.",
      "Each PDF is read on the server, one file at a time, with live status per file.",
      "Download each .txt individually, or everything as one ZIP. Scanned pages contain no text — OCR is not performed.",
    ],
  }),
  pdfOperation({
    id: "pdf-to-jpg",
    icon: "image",
    name: "Bulk PDF to JPG",
    description:
      "Export every page of many PDFs as JPG images, grouped per file.",
    outputKind: "archive",
    pageBudget: true,
    imageBudget: false,
    keywords: ["batch", "jpeg", "images", "multiple", "rasterise"],
    howItWorks: [
      "Add the PDFs to export.",
      "Each PDF is rendered on the server at 150 DPI, one file at a time, with live status per file.",
      "Download each file's images (a ZIP per PDF) individually, or everything as one ZIP grouped by source file.",
    ],
  }),
  pdfOperation({
    id: "pdf-to-png",
    icon: "image",
    name: "Bulk PDF to PNG",
    description:
      "Export every page of many PDFs as lossless PNG images, grouped per file.",
    outputKind: "archive",
    pageBudget: true,
    imageBudget: false,
    keywords: ["batch", "images", "multiple", "lossless"],
    howItWorks: [
      "Add the PDFs to export.",
      "Each PDF is rendered on the server at 150 DPI, one file at a time, with live status per file.",
      "Download each file's images (a ZIP per PDF) individually, or everything as one ZIP grouped by source file.",
    ],
  }),
  {
    id: "images-to-pdf",
    icon: "image",
    name: "Bulk Images to PDF",
    description:
      "Turn many JPG/PNG images into separate PDF documents, one PDF per image.",
    route: "/bulk/images-to-pdf",
    endpoint: "/api/tools/images-to-pdf",
    supportedFileTypes: [".jpg", ".jpeg", ".png"],
    acceptedMimeTypes: ["image/jpeg", "image/png"],
    outputKind: "single",
    pageBudget: false,
    imageBudget: false,
    keywords: ["batch", "jpg to pdf", "png to pdf", "multiple", "photos"],
    howItWorks: [
      "Add the JPG or PNG images to convert.",
      "Each image becomes exactly one PDF page on the server, one file at a time, with live status per file.",
      "Download each PDF individually, or everything as one ZIP. To combine images into a single PDF, use the Images to PDF tool instead.",
    ],
  },
  pdfOperation({
    id: "extract-images",
    icon: "extract",
    name: "Bulk Extract Images",
    description:
      "Pull the embedded images out of many PDFs, grouped per file.",
    outputKind: "archive",
    pageBudget: false,
    imageBudget: true,
    keywords: [
      "batch",
      "embedded",
      "pictures",
      "multiple",
      "save images",
      "extraction",
      "image extraction",
    ],
    howItWorks: [
      "Add the PDFs that contain embedded images.",
      "Images are extracted on the server, one file at a time, with live status per file.",
      "Download each file's images (a ZIP per PDF) individually, or everything as one ZIP grouped by source file.",
    ],
  }),
] as const;

const OPERATIONS_BY_ID = new Map<string, BulkOperation>(
  BULK_OPERATIONS.map((operation) => [operation.id, operation]),
);

export function getBulkOperation(id: string): BulkOperation | undefined {
  return OPERATIONS_BY_ID.get(id);
}

/* ------------------------------------------------------------------ */
/* Batch limits                                                        */
/* ------------------------------------------------------------------ */

/**
 * Hard batch ceilings per tier. These are *ceilings*, not the effective caps:
 * the effective cap for files and input bytes is always the smaller of the
 * ceiling and the account's **daily quota** (so an anonymous batch can never
 * be larger than the 10 jobs it could actually complete, and a quota raised
 * through environment variables automatically raises the batch cap with it).
 *
 * Why these numbers (Phase 61 audit — see `.arena/KNOWN-ISSUES.md`):
 *
 * - **Files per batch** — anonymous 10 = its whole daily job quota (a larger
 *   batch could never finish); free 50 = its whole daily job quota; pro and
 *   business 100 = 20% / 2% of their daily job quota, where the binding
 *   constraints become browser memory and a multi-minute session, not the
 *   server. Not a round "100 files is fine" guess: the page, output and image
 *   budgets below are what actually protect the server, and they apply
 *   regardless of file count.
 * - **Input bytes per batch** — anonymous 50 MB = its daily byte quota; free
 *   100 MB (40% of its daily 250 MB); pro/business 250 MB, an upload-session
 *   practicality cap (10+ minutes on a typical connection) that also stays
 *   under the 100 MB per-request server limit since files travel one by one.
 * - **Pages per batch (PDF → JPG/PNG)** — 200 for every tier: at 150 DPI a
 *   dense page is ~1 MB of JPEG, so 200 pages bounds the worst case at
 *   ~200 MB of browser-held output and ~100-400 s of server rasterisation
 *   spread across many short requests, each far under the 120 s request
 *   timeout.
 * - **Output bytes per batch** — 200 MB for every tier: the batch result is
 *   assembled into a ZIP in the browser, so *all* outputs live in RAM at
 *   once. 200 MB keeps mobile browsers (which are killed well before desktop
 *   limits) safe.
 * - **Extracted images per batch** — 400: twice the server-side per-file cap
 *   of 200 (PDFKIT_EXTRACT_IMAGES_MAX_IMAGES), still a bounded number of
 *   in-memory artifacts.
 */
export const BULK_BATCH_CEILINGS: Record<
  UserAccountTier,
  { files: number; inputBytes: number }
> = {
  anonymous: { files: 10, inputBytes: 50 * 1024 * 1024 },
  free: { files: 50, inputBytes: 100 * 1024 * 1024 },
  pro: { files: 100, inputBytes: 250 * 1024 * 1024 },
  business: { files: 100, inputBytes: 250 * 1024 * 1024 },
};

export const BULK_SHARED_BUDGETS = {
  /** Rasterised pages per batch (PDF → JPG / PDF → PNG). */
  maxPagesPerBatch: 200,
  /** Total produced output bytes held in the browser per batch. */
  maxOutputBytesPerBatch: 200 * 1024 * 1024,
  /** Extracted images per batch (Bulk Extract Images). */
  maxExtractedImagesPerBatch: 400,
} as const;

/**
 * Minimum gap between the starts of two consecutive per-file requests.
 * The default IP rate limit is 60 requests/minute, so ~54 requests/minute
 * stays safely under it even when files fail instantly.
 */
export const BULK_REQUEST_PACING_MS = 1100;

export interface BulkBatchCaps {
  tier: UserAccountTier;
  maxFilesPerBatch: number;
  maxTotalInputBytes: number;
  maxPagesPerBatch: number;
  maxOutputBytesPerBatch: number;
  maxExtractedImagesPerBatch: number;
}

/**
 * Effective batch caps for one account: the tier ceiling, clamped by the
 * account's live daily quota (which may be overridden by environment
 * variables), plus the tier-independent browser budgets.
 */
export function resolveBulkBatchCaps(
  tier: UserAccountTier,
  dailyJobLimit: number,
  dailyByteLimit: number,
): BulkBatchCaps {
  const ceilings = BULK_BATCH_CEILINGS[tier] ?? BULK_BATCH_CEILINGS.anonymous;
  return {
    tier,
    maxFilesPerBatch: Math.max(1, Math.min(ceilings.files, dailyJobLimit)),
    maxTotalInputBytes: Math.max(
      1,
      Math.min(ceilings.inputBytes, dailyByteLimit),
    ),
    maxPagesPerBatch: BULK_SHARED_BUDGETS.maxPagesPerBatch,
    maxOutputBytesPerBatch: BULK_SHARED_BUDGETS.maxOutputBytesPerBatch,
    maxExtractedImagesPerBatch: BULK_SHARED_BUDGETS.maxExtractedImagesPerBatch,
  };
}

/**
 * Bulk conversions that are intentionally NOT offered because their
 * single-file engines do not exist yet (they stay `COMING_SOON` in the tool
 * catalog — accurate Office/PowerPoint rendering needs LibreOffice or a
 * headless browser, which violates PDFKit's zero-native-binary,
 * zero-external-service constraints). Listed on the bulk landing page so the
 * section never overpromises.
 */
export const BULK_UNAVAILABLE_CONVERSIONS: readonly {
  id: string;
  name: string;
  reason: string;
}[] = [
  {
    id: "word-to-pdf",
    name: "Bulk Word to PDF",
    reason:
      "The Word to PDF engine is not implemented yet — accurate layout rendering requires LibreOffice or a headless browser, which PDFKit does not ship.",
  },
  {
    id: "excel-to-pdf",
    name: "Bulk Excel to PDF",
    reason:
      "The Excel to PDF engine is not implemented yet for the same reason.",
  },
  {
    id: "powerpoint-to-pdf",
    name: "Bulk PowerPoint to PDF",
    reason:
      "The PowerPoint to PDF engine is not implemented yet for the same reason.",
  },
] as const;
