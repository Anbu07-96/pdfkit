import type {
  CompressionLevel,
  CompressionStrategy,
  RasterSkipReason,
} from "@/lib/processing/compression";
import type { DocumentMetadata } from "@/lib/processing/metadata";

export type { DocumentMetadata };
import type { ProcessingErrorCode } from "@/lib/processing/errors";
import {
  formatPageRotations,
  type PageRotation,
  type PageRotationMap,
  type PageSelectionMode,
} from "@/lib/processing/pages";

/**
 * Browser-side client for the processing API.
 *
 * This is the only place the UI knows about HTTP. Components call
 * `runMergePdf()` and receive either a real document or a typed failure — they
 * never build requests, parse responses or touch a PDF library.
 */

export interface ProcessedDocument {
  /** Object URL for the produced document. Revoke it when finished. */
  url: string;
  fileName: string;
  size: number;
  /** Page count of the input document, reported by the server. */
  pages?: number;
  /** Page count of the produced document, reported by the server. */
  outputPages?: number;
  /** How many documents the job produced (>1 means the download is a ZIP). */
  artifacts: number;
  /** True when several documents were bundled into a ZIP. */
  isArchive: boolean;
  blob: Blob;
  /**
   * Compression statistics measured by the server (Compress PDF only). Always
   * taken from the response headers — the browser never guesses sizes.
   */
  compression?: CompressionSummary;
}

/** Server-measured result of a compression job, for honest reporting. */
export interface CompressionSummary {
  originalBytes: number;
  outputBytes: number;
  bytesSaved: number;
  reductionPercent: number;
  wasReduced: boolean;
  compressionLevel: CompressionLevel;
  strategy: CompressionStrategy;
  rasterSkipped?: RasterSkipReason;
}

function compressionFromHeaders(
  response: Response,
): CompressionSummary | undefined {
  const originalBytes = Number.parseInt(
    response.headers.get("x-pdfkit-original-bytes") ?? "",
    10,
  );
  const outputBytes = Number.parseInt(
    response.headers.get("x-pdfkit-output-bytes") ?? "",
    10,
  );
  if (!Number.isFinite(originalBytes) || !Number.isFinite(outputBytes)) {
    return undefined;
  }

  const bytesSaved = Number.parseInt(
    response.headers.get("x-pdfkit-bytes-saved") ?? "",
    10,
  );
  const reductionPercent = Number.parseFloat(
    response.headers.get("x-pdfkit-reduction-percent") ?? "",
  );
  const level = response.headers.get("x-pdfkit-compression-level");
  const strategy = response.headers.get("x-pdfkit-compression-strategy");

  return {
    originalBytes,
    outputBytes,
    bytesSaved: Number.isFinite(bytesSaved) ? bytesSaved : 0,
    reductionPercent: Number.isFinite(reductionPercent) ? reductionPercent : 0,
    wasReduced: response.headers.get("x-pdfkit-reduced") === "yes",
    compressionLevel:
      level === "low" || level === "high"
        ? level
        : "medium",
    strategy:
      strategy === "lossless" || strategy === "rasterized" ? strategy : "original",
    ...(response.headers.get("x-pdfkit-raster-skipped")
      ? {
          rasterSkipped: response.headers.get(
            "x-pdfkit-raster-skipped",
          ) as RasterSkipReason,
        }
      : {}),
  };
}

export class ProcessingRequestError extends Error {
  readonly code: ProcessingErrorCode | "NETWORK_ERROR";
  readonly details?: string[];

  constructor(
    code: ProcessingErrorCode | "NETWORK_ERROR",
    message: string,
    details?: string[],
  ) {
    super(message);
    this.name = "ProcessingRequestError";
    this.code = code;
    this.details = details?.length ? details : undefined;
  }
}

function fileNameFromDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const match = /filename="?([^";]+)"?/i.exec(header);
  return match?.[1]?.trim() || fallback;
}

/** POST a multipart body and turn any failure into a `ProcessingRequestError`. */
async function postForm(
  url: string,
  form: FormData,
  signal?: AbortSignal,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, { method: "POST", body: form, signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ProcessingRequestError(
      "NETWORK_ERROR",
      "The files could not be sent. Check your connection and try again.",
    );
  }

  if (!response.ok) {
    let code: ProcessingErrorCode | "NETWORK_ERROR" = "INTERNAL_ERROR";
    let message = "Something went wrong while processing your files.";
    let details: string[] | undefined;

    try {
      const body = (await response.json()) as {
        error?: { code?: ProcessingErrorCode; message?: string; details?: string[] };
      };
      if (body.error?.code) code = body.error.code;
      if (body.error?.message) message = body.error.message;
      details = body.error?.details;
    } catch {
      // Non-JSON error body: keep the generic message.
    }

    throw new ProcessingRequestError(code, message, details);
  }

  return response;
}

/** Turn a successful binary response into a downloadable document. */
async function toProcessedDocument(
  response: Response,
  fallbackName: string,
): Promise<ProcessedDocument> {
  const blob = await response.blob();
  const pagesHeader = response.headers.get("x-pdfkit-pages");
  const pages = pagesHeader ? Number.parseInt(pagesHeader, 10) : undefined;
  const outputPagesHeader = response.headers.get("x-pdfkit-output-pages");
  const outputPages = outputPagesHeader
    ? Number.parseInt(outputPagesHeader, 10)
    : undefined;
  const artifactsHeader = response.headers.get("x-pdfkit-artifacts");
  const artifacts = artifactsHeader ? Number.parseInt(artifactsHeader, 10) : 1;
  const contentType = response.headers.get("content-type") ?? "";
  const compression = compressionFromHeaders(response);

  return {
    blob,
    url: URL.createObjectURL(blob),
    ...(compression ? { compression } : {}),
    fileName: fileNameFromDisposition(
      response.headers.get("content-disposition"),
      fallbackName,
    ),
    size: blob.size,
    pages: Number.isFinite(pages) ? pages : undefined,
    outputPages: Number.isFinite(outputPages) ? outputPages : undefined,
    artifacts: Number.isFinite(artifacts) && artifacts > 0 ? artifacts : 1,
    isArchive: contentType.includes("zip"),
  };
}

export interface PdfInspectionResult {
  fileName: string;
  size: number;
  pageCount: number;
  /** Document metadata reported by the server; `null` entries are absent. */
  metadata: DocumentMetadata;
}

export interface RunMergePdfOptions {
  files: File[];
  signal?: AbortSignal;
}

/**
 * Upload PDFs to the merge endpoint and return the produced document.
 * The order of `files` is the order sent to the server.
 */
export async function runMergePdf({
  files,
  signal,
}: RunMergePdfOptions): Promise<ProcessedDocument> {
  const form = new FormData();
  for (const file of files) form.append("files", file, file.name);

  const response = await postForm("/api/tools/merge-pdf", form, signal);
  return toProcessedDocument(response, "merged.pdf");
}

export interface RunSplitPdfOptions {
  file: File;
  mode: PageSelectionMode;
  /** Raw range input, e.g. "1-3, 5, 7-9". Required for `ranges` mode. */
  ranges?: string;
  signal?: AbortSignal;
}

/**
 * Split a PDF on the server. Returns a single PDF when the split produces one
 * document, or a ZIP containing one PDF per output.
 */
export async function runSplitPdf({
  file,
  mode,
  ranges,
  signal,
}: RunSplitPdfOptions): Promise<ProcessedDocument> {
  const form = new FormData();
  form.append("files", file, file.name);
  form.append("mode", mode);
  if (ranges !== undefined) form.append("ranges", ranges);

  const response = await postForm("/api/tools/split-pdf", form, signal);
  return toProcessedDocument(response, "split.zip");
}

export interface RunPageSelectionToolOptions {
  file: File;
  /** Raw range input, e.g. "1-3, 5, 8-10". */
  ranges: string;
  signal?: AbortSignal;
}

/** Shared request shape for the single-file, page-selection tools. */
async function runPageSelectionTool(
  endpoint: string,
  fallbackName: string,
  { file, ranges, signal }: RunPageSelectionToolOptions,
): Promise<ProcessedDocument> {
  const form = new FormData();
  form.append("files", file, file.name);
  form.append("ranges", ranges);

  const response = await postForm(endpoint, form, signal);
  return toProcessedDocument(response, fallbackName);
}

/** Keep only the selected pages, in the order they were selected. */
export async function runExtractPdfPages(
  options: RunPageSelectionToolOptions,
): Promise<ProcessedDocument> {
  return runPageSelectionTool(
    "/api/tools/extract-pdf-pages",
    "extracted.pdf",
    options,
  );
}

/** Remove the selected pages and keep the rest, in document order. */
export async function runDeletePdfPages(
  options: RunPageSelectionToolOptions,
): Promise<ProcessedDocument> {
  return runPageSelectionTool(
    "/api/tools/delete-pdf-pages",
    "pages-removed.pdf",
    options,
  );
}

export interface RunReorderPdfPagesOptions {
  file: File;
  /** The complete new order, e.g. `[5, 3, 1, 2, 4]`. */
  order: number[];
  signal?: AbortSignal;
}

/** Reorder the pages of one PDF. The order is sent explicitly, in full. */
export async function runReorderPdfPages({
  file,
  order,
  signal,
}: RunReorderPdfPagesOptions): Promise<ProcessedDocument> {
  const form = new FormData();
  form.append("files", file, file.name);
  form.append("order", order.join(","));

  const response = await postForm("/api/tools/reorder-pdf-pages", form, signal);
  return toProcessedDocument(response, "reordered.pdf");
}

export interface RunRotatePdfOptions {
  file: File;
  /** Clockwise rotation per page; omitted pages keep their orientation. */
  rotations: PageRotationMap;
  signal?: AbortSignal;
}

/** Rotate pages of one PDF. Rotations are additive on the server. */
export async function runRotatePdf({
  file,
  rotations,
  signal,
}: RunRotatePdfOptions): Promise<ProcessedDocument> {
  const form = new FormData();
  form.append("files", file, file.name);
  form.append("rotations", formatPageRotations(rotations));

  const response = await postForm("/api/tools/rotate-pdf", form, signal);
  return toProcessedDocument(response, "rotated.pdf");
}

export interface RunCompressPdfOptions {
  file: File;
  /** `low`, `medium` (default) or `high` — the server validates it again. */
  level: CompressionLevel;
  signal?: AbortSignal;
}

/**
 * Compress a PDF on the server. The returned document carries the measured
 * statistics in `compression`, straight from the response headers.
 */
export async function runCompressPdf({
  file,
  level,
  signal,
}: RunCompressPdfOptions): Promise<ProcessedDocument> {
  const form = new FormData();
  form.append("files", file, file.name);
  form.append("level", level);

  const response = await postForm("/api/tools/compress-pdf", form, signal);
  return toProcessedDocument(response, "compressed.pdf");
}

export interface RunImagesToPdfOptions {
  /** Images in the exact order the pages should follow. */
  files: File[];
  signal?: AbortSignal;
}

/**
 * Convert JPG/JPEG/PNG images into one PDF on the server. The order of
 * `files` is the page order sent to the server.
 */
export async function runImagesToPdf({
  files,
  signal,
}: RunImagesToPdfOptions): Promise<ProcessedDocument> {
  const form = new FormData();
  for (const file of files) form.append("files", file, file.name);

  const response = await postForm("/api/tools/images-to-pdf", form, signal);
  return toProcessedDocument(response, "images-to-pdf.pdf");
}

export interface RunPdfToImageOptions {
  file: File;
  signal?: AbortSignal;
}

/** Shared request shape for the PDF → image endpoints. */
async function runPdfToImage(
  endpoint: string,
  fallbackName: string,
  { file, signal }: RunPdfToImageOptions,
): Promise<ProcessedDocument> {
  const form = new FormData();
  form.append("files", file, file.name);

  const response = await postForm(endpoint, form, signal);
  return toProcessedDocument(response, fallbackName);
}

/** Export every page of a PDF as a JPG (single image or ZIP). */
export async function runPdfToJpg(
  options: RunPdfToImageOptions,
): Promise<ProcessedDocument> {
  return runPdfToImage("/api/tools/pdf-to-jpg", "page-1.jpg", options);
}

/** Export every page of a PDF as a PNG (single image or ZIP). */
export async function runPdfToPng(
  options: RunPdfToImageOptions,
): Promise<ProcessedDocument> {
  return runPdfToImage("/api/tools/pdf-to-png", "page-1.png", options);
}

export interface RunEditPdfMetadataOptions {
  file: File;
  /** Per-field values; `null` means "clear this field". */
  title: string | null;
  author: string | null;
  subject: string | null;
  /** Comma-separated keywords. */
  keywords: string | null;
  creator: string | null;
  signal?: AbortSignal;
}

/**
 * Edit the metadata of one PDF on the server. Every field is sent explicitly
 * so clearing works: an empty value removes the Info entry, and the server
 * re-validates types and lengths.
 */
export async function runEditPdfMetadata({
  file,
  title,
  author,
  subject,
  keywords,
  creator,
  signal,
}: RunEditPdfMetadataOptions): Promise<ProcessedDocument> {
  const form = new FormData();
  form.append("files", file, file.name);
  const fields = { title, author, subject, keywords, creator };
  for (const [field, value] of Object.entries(fields)) {
    form.append(field, value ?? "");
  }

  const response = await postForm("/api/tools/edit-pdf-metadata", form, signal);
  return toProcessedDocument(response, "metadata.pdf");
}

export interface PageThumbnailData {
  pageNumber: number;
  /** Extra clockwise rotation baked into this preview. */
  rotation: PageRotation;
  width: number;
  height: number;
  /** `data:image/png;base64,...` — usable directly as an `<img src>`. */
  dataUrl: string;
}

export interface PageThumbnailsResult {
  pageCount: number;
  thumbnails: PageThumbnailData[];
}

/**
 * Render page previews on the server.
 *
 * `pages` is optional; omitting it asks for the first N pages, where N is the
 * server's configured limit.
 */
export async function fetchPageThumbnails(
  file: File,
  pages?: number[],
  signal?: AbortSignal,
  rotations?: PageRotationMap,
): Promise<PageThumbnailsResult> {
  const form = new FormData();
  form.append("files", file, file.name);
  if (pages?.length) form.append("pages", pages.join(","));
  if (rotations && Object.keys(rotations).length > 0) {
    form.append("rotations", formatPageRotations(rotations));
  }

  const response = await postForm("/api/documents/thumbnails", form, signal);
  return (await response.json()) as PageThumbnailsResult;
}

/** Ask the server for a document's real page count. */
export async function inspectPdfFile(
  file: File,
  signal?: AbortSignal,
): Promise<PdfInspectionResult> {
  const form = new FormData();
  form.append("files", file, file.name);

  const response = await postForm("/api/documents/inspect", form, signal);
  return (await response.json()) as PdfInspectionResult;
}
