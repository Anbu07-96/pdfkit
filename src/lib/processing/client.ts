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
  /** Removal outcome measured by the server (Remove Metadata only). */
  removal?: RemovalSummary;
  /** Text extraction outcome measured by the server (PDF to Word only). */
  extraction?: ExtractionSummary;
  /** How many pages the server stamped (Watermark only). */
  watermarkedPages?: number;
  /** How many pages received the text box (Add Text only). */
  textPages?: number;
  /** How many pages received shapes (Add Shapes only). */
  shapePages?: number;
  /** How many pages received an image (Add Images only). */
  imagePages?: number;
  /** How many pages received highlights (Highlight only). */
  highlightedPages?: number;
  /** How many pages received drawing marks (Draw only). */
  drawnPages?: number;
  /** How many pages received PDF annotations (Annotations only). */
  annotatedPages?: number;
  /** How many pages the server numbered (Page Numbers only). */
  numberedPages?: number;
  /** How many pages the server cropped (Crop only). */
  croppedPages?: number;
  /** How many form fields the server flattened (Flatten PDF only). */
  flattenedFields?: number;
  /** How many pages were deleted (Organize PDF only). */
  deletedPages?: number;
  /** How many pages were rotated (Organize PDF only). */
  rotatedPages?: number;
}

/** Server-measured text extraction outcome. */
export interface ExtractionSummary {
  characters: number;
  paragraphs: number;
  mode: string;
}

/** Server-verified outcome of a metadata removal. */
export interface RemovalSummary {
  /** How many of the five Info fields were present and removed. */
  removedFields: number;
  /** `"yes"` when an XMP stream was removed, `"not-present"` otherwise. */
  xmp: string;
  /** Always `"verified"` — checked by re-reading the output. */
  verification: string;
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

function extractionFromHeaders(response: Response): ExtractionSummary | undefined {
  const characters = Number.parseInt(
    response.headers.get("x-pdfkit-characters") ?? "",
    10,
  );
  if (!Number.isFinite(characters)) return undefined;
  const paragraphs = Number.parseInt(
    response.headers.get("x-pdfkit-paragraphs") ?? "",
    10,
  );
  return {
    characters,
    paragraphs: Number.isFinite(paragraphs) ? paragraphs : 0,
    mode: response.headers.get("x-pdfkit-mode") ?? "",
  };
}

function removalFromHeaders(response: Response): RemovalSummary | undefined {
  const removedFields = Number.parseInt(
    response.headers.get("x-pdfkit-removed-fields") ?? "",
    10,
  );
  if (!Number.isFinite(removedFields)) return undefined;
  return {
    removedFields,
    xmp: response.headers.get("x-pdfkit-xmp-removed") ?? "",
    verification: response.headers.get("x-pdfkit-verification") ?? "",
  };
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
  const removal = removalFromHeaders(response);
  const extraction = extractionFromHeaders(response);
  const watermarkedPages = Number.parseInt(
    response.headers.get("x-pdfkit-watermarked-pages") ?? "",
    10,
  );
  const textPages = Number.parseInt(
    response.headers.get("x-pdfkit-text-pages") ?? "",
    10,
  );
  const shapePages = Number.parseInt(
    response.headers.get("x-pdfkit-shape-pages") ?? "",
    10,
  );
  const imagePages = Number.parseInt(
    response.headers.get("x-pdfkit-image-pages") ?? "",
    10,
  );
  const highlightedPages = Number.parseInt(
    response.headers.get("x-pdfkit-highlighted-pages") ?? "",
    10,
  );
  const drawnPages = Number.parseInt(
    response.headers.get("x-pdfkit-drawn-pages") ?? "",
    10,
  );
  const annotatedPages = Number.parseInt(
    response.headers.get("x-pdfkit-annotated-pages") ?? "",
    10,
  );
  const numberedPages = Number.parseInt(
    response.headers.get("x-pdfkit-numbered-pages") ?? "",
    10,
  );
  const croppedPages = Number.parseInt(
    response.headers.get("x-pdfkit-cropped-pages") ?? "",
    10,
  );
  const flattenedFields = Number.parseInt(
    response.headers.get("x-pdfkit-flattened-fields") ?? "",
    10,
  );
  const deletedPages = Number.parseInt(
    response.headers.get("x-pdfkit-deleted-pages") ?? "",
    10,
  );
  const rotatedPages = Number.parseInt(
    response.headers.get("x-pdfkit-rotated-pages") ?? "",
    10,
  );

  return {
    blob,
    url: URL.createObjectURL(blob),
    ...(compression ? { compression } : {}),
    ...(removal ? { removal } : {}),
    ...(extraction ? { extraction } : {}),
    ...(Number.isFinite(watermarkedPages) ? { watermarkedPages } : {}),
    ...(Number.isFinite(textPages) ? { textPages } : {}),
    ...(Number.isFinite(shapePages) ? { shapePages } : {}),
    ...(Number.isFinite(imagePages) ? { imagePages } : {}),
    ...(Number.isFinite(highlightedPages) ? { highlightedPages } : {}),
    ...(Number.isFinite(drawnPages) ? { drawnPages } : {}),
    ...(Number.isFinite(annotatedPages) ? { annotatedPages } : {}),
    ...(Number.isFinite(numberedPages) ? { numberedPages } : {}),
    ...(Number.isFinite(croppedPages) ? { croppedPages } : {}),
    ...(Number.isFinite(flattenedFields) ? { flattenedFields } : {}),
    ...(Number.isFinite(deletedPages) ? { deletedPages } : {}),
    ...(Number.isFinite(rotatedPages) ? { rotatedPages } : {}),
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

/** Generic tool job execution fallback for client UI workspaces. */
export async function executeToolJob(
  toolId: string,
  form: FormData,
  signal?: AbortSignal,
): Promise<{ status: "succeeded" | "failed"; artifact?: { name: string; blob: Blob }; error?: { message: string } }> {
  try {
    const response = await postForm(`/api/tools/${toolId}`, form, signal);
    const doc = await toProcessedDocument(response, "output.bin");
    return {
      status: "succeeded",
      artifact: { name: doc.fileName, blob: doc.blob },
    };
  } catch (err) {
    return {
      status: "failed",
      error: { message: err instanceof Error ? err.message : "Processing failed." },
    };
  }
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

export interface RunOrganizePdfOptions {
  file: File;
  order: number[];
  rotations?: PageRotationMap;
  signal?: AbortSignal;
}

/**
 * Organize PDF pages on the server (reorder, rotate, delete in one operation).
 */
export async function runOrganizePdf({
  file,
  order,
  rotations,
  signal,
}: RunOrganizePdfOptions): Promise<ProcessedDocument> {
  const form = new FormData();
  form.append("files", file, file.name);
  form.append("order", order.join(","));
  if (rotations && Object.keys(rotations).length > 0) {
    form.append("rotations", formatPageRotations(rotations));
  }

  const response = await postForm("/api/tools/organize-pdf", form, signal);
  return toProcessedDocument(response, "organized.pdf");
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

export interface RunPngToPdfOptions {
  /** PNG images in the exact order the pages should follow. */
  files: File[];
  signal?: AbortSignal;
}

/**
 * Convert PNG images into one PDF on the server. The order of `files` is the
 * page order sent to the server; non-PNG payloads are rejected there.
 */
export async function runPngToPdf({
  files,
  signal,
}: RunPngToPdfOptions): Promise<ProcessedDocument> {
  const form = new FormData();
  for (const file of files) form.append("files", file, file.name);

  const response = await postForm("/api/tools/png-to-pdf", form, signal);
  return toProcessedDocument(response, "png-to-pdf.pdf");
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

export interface RunRemoveMetadataOptions {
  file: File;
  signal?: AbortSignal;
}

/**
 * Strip the metadata from one PDF on the server. The response headers report
 * how many fields were found and removed and whether the removal was verified.
 */
export async function runRemoveMetadata({
  file,
  signal,
}: RunRemoveMetadataOptions): Promise<ProcessedDocument> {
  const form = new FormData();
  form.append("files", file, file.name);

  const response = await postForm("/api/tools/remove-metadata", form, signal);
  return toProcessedDocument(response, "metadata-removed.pdf");
}

export interface RunPdfToWordOptions {
  file: File;
  signal?: AbortSignal;
}

/**
 * Extract the text of one PDF into a Word document on the server. Text only —
 * the response headers report how much text was actually found.
 */
export async function runPdfToWord({
  file,
  signal,
}: RunPdfToWordOptions): Promise<ProcessedDocument> {
  const form = new FormData();
  form.append("files", file, file.name);

  const response = await postForm("/api/tools/pdf-to-word", form, signal);
  return toProcessedDocument(response, "document.docx");
}

export interface RunWatermarkOptions {
  file: File;
  text: string;
  opacityPercent: number;
  rotationDegrees: number;
  placement: string;
  pages: string;
  signal?: AbortSignal;
}

/**
 * Add a text watermark to one PDF on the server. Every option is re-validated
 * there; the response reports how many pages were stamped.
 */
export async function runWatermark({
  file,
  text,
  opacityPercent,
  rotationDegrees,
  placement,
  pages,
  signal,
}: RunWatermarkOptions): Promise<ProcessedDocument> {
  const form = new FormData();
  form.append("files", file, file.name);
  form.append("text", text);
  form.append("opacity", String(opacityPercent));
  form.append("rotation", String(rotationDegrees));
  form.append("placement", placement);
  form.append("pages", pages);

  const response = await postForm("/api/tools/watermark", form, signal);
  return toProcessedDocument(response, "watermarked.pdf");
}

export interface RunAddTextOptions {
  file: File;
  text: string;
  placement: string;
  fontSize: number;
  pages: string;
  signal?: AbortSignal;
}

/**
 * Add a text box to one PDF on the server. Every option is re-validated
 * there; the response reports how many pages received the text.
 */
export async function runAddText({
  file,
  text,
  placement,
  fontSize,
  pages,
  signal,
}: RunAddTextOptions): Promise<ProcessedDocument> {
  const form = new FormData();
  form.append("files", file, file.name);
  form.append("text", text);
  form.append("placement", placement);
  form.append("size", String(fontSize));
  form.append("pages", pages);

  const response = await postForm("/api/tools/add-text", form, signal);
  return toProcessedDocument(response, "text-added.pdf");
}

export interface RunAddShapesOptions {
  file: File;
  shape: string;
  placement: string;
  width: number;
  height: number;
  strokeWidth: number;
  strokeColor: string;
  fillColor: string;
  pages: string;
  signal?: AbortSignal;
}

/**
 * Add vector shapes to one PDF on the server. Every option is re-validated
 * there; the response reports how many pages received the shape.
 */
export async function runAddShapes({
  file,
  shape,
  placement,
  width,
  height,
  strokeWidth,
  strokeColor,
  fillColor,
  pages,
  signal,
}: RunAddShapesOptions): Promise<ProcessedDocument> {
  const form = new FormData();
  form.append("files", file, file.name);
  form.append("shape", shape);
  form.append("placement", placement);
  form.append("width", String(width));
  form.append("height", String(height));
  form.append("strokeWidth", String(strokeWidth));
  form.append("strokeColor", strokeColor);
  form.append("fillColor", fillColor);
  form.append("pages", pages);

  const response = await postForm("/api/tools/add-shapes", form, signal);
  return toProcessedDocument(response, "shapes-added.pdf");
}

export interface RunAddImagesOptions {
  pdfFile: File;
  imageFile: File;
  placement: string;
  width: number;
  height: number;
  preserveAspectRatio: boolean;
  pages: string;
  signal?: AbortSignal;
}

/**
 * Add an image to one PDF on the server.
 */
export async function runAddImages({
  pdfFile,
  imageFile,
  placement,
  width,
  height,
  preserveAspectRatio,
  pages,
  signal,
}: RunAddImagesOptions): Promise<ProcessedDocument> {
  const form = new FormData();
  form.append("files", pdfFile, pdfFile.name);
  form.append("files", imageFile, imageFile.name);
  form.append("placement", placement);
  form.append("width", String(width));
  form.append("height", String(height));
  form.append("preserveAspectRatio", String(preserveAspectRatio));
  form.append("pages", pages);

  const response = await postForm("/api/tools/add-images", form, signal);
  return toProcessedDocument(response, "image-added.pdf");
}

export interface RunHighlightOptions {
  file: File;
  placement: string;
  width: number;
  height: number;
  color: string;
  opacity: number;
  pages: string;
  signal?: AbortSignal;
}

/**
 * Highlight areas on one PDF on the server.
 */
export async function runHighlight({
  file,
  placement,
  width,
  height,
  color,
  opacity,
  pages,
  signal,
}: RunHighlightOptions): Promise<ProcessedDocument> {
  const form = new FormData();
  form.append("files", file, file.name);
  form.append("placement", placement);
  form.append("width", String(width));
  form.append("height", String(height));
  form.append("color", color);
  form.append("opacity", String(opacity));
  form.append("pages", pages);

  const response = await postForm("/api/tools/highlight", form, signal);
  return toProcessedDocument(response, "highlighted.pdf");
}

export interface RunDrawOptions {
  file: File;
  preset: string;
  placement: string;
  width: number;
  height: number;
  strokeWidth: number;
  strokeColor: string;
  pages: string;
  signal?: AbortSignal;
}

/**
 * Draw freehand vector strokes on one PDF on the server.
 */
export async function runDraw({
  file,
  preset,
  placement,
  width,
  height,
  strokeWidth,
  strokeColor,
  pages,
  signal,
}: RunDrawOptions): Promise<ProcessedDocument> {
  const form = new FormData();
  form.append("files", file, file.name);
  form.append("preset", preset);
  form.append("placement", placement);
  form.append("width", String(width));
  form.append("height", String(height));
  form.append("strokeWidth", String(strokeWidth));
  form.append("strokeColor", strokeColor);
  form.append("pages", pages);

  const response = await postForm("/api/tools/draw", form, signal);
  return toProcessedDocument(response, "drawn.pdf");
}

export interface RunAnnotationsOptions {
  file: File;
  type: string;
  placement: string;
  text?: string;
  author?: string;
  url?: string;
  width?: number;
  height?: number;
  pages: string;
  signal?: AbortSignal;
}

/**
 * Add PDF annotations (comments, links) to one PDF on the server.
 */
export async function runAnnotations({
  file,
  type,
  placement,
  text = "",
  author = "",
  url = "",
  width = 30,
  height = 30,
  pages,
  signal,
}: RunAnnotationsOptions): Promise<ProcessedDocument> {
  const form = new FormData();
  form.append("files", file, file.name);
  form.append("type", type);
  form.append("placement", placement);
  if (text) form.append("text", text);
  if (author) form.append("author", author);
  if (url) form.append("url", url);
  form.append("width", String(width));
  form.append("height", String(height));
  form.append("pages", pages);

  const response = await postForm("/api/tools/annotations", form, signal);
  return toProcessedDocument(response, "annotated.pdf");
}

export interface RunExtractImagesOptions {
  file: File;
  pages: string;
  signal?: AbortSignal;
}

/**
 * Extract embedded raster images from one PDF on the server.
 */
export async function runExtractImages({
  file,
  pages,
  signal,
}: RunExtractImagesOptions): Promise<ProcessedDocument> {
  const form = new FormData();
  form.append("files", file, file.name);
  form.append("pages", pages);

  const response = await postForm("/api/tools/extract-images", form, signal);
  return toProcessedDocument(response, "extracted-images.zip");
}

export interface RunPdfToTextOptions {
  file: File;
  pages: string;
  signal?: AbortSignal;
}

/**
 * Extract plain searchable text from one PDF on the server.
 */
export async function runPdfToText({
  file,
  pages,
  signal,
}: RunPdfToTextOptions): Promise<ProcessedDocument> {
  const form = new FormData();
  form.append("files", file, file.name);
  form.append("pages", pages);

  const response = await postForm("/api/tools/pdf-to-text", form, signal);
  return toProcessedDocument(response, "text.txt");
}

export interface RunPageNumbersOptions {
  file: File;
  position: string;
  start: number;
  fontSize: number;
  format: string;
  pages: string;
  signal?: AbortSignal;
}

/**
 * Add page numbers to one PDF on the server. Every option is re-validated
 * there; the response reports how many pages were numbered.
 */
export async function runPageNumbers({
  file,
  position,
  start,
  fontSize,
  format,
  pages,
  signal,
}: RunPageNumbersOptions): Promise<ProcessedDocument> {
  const form = new FormData();
  form.append("files", file, file.name);
  form.append("position", position);
  form.append("start", String(start));
  form.append("size", String(fontSize));
  form.append("format", format);
  form.append("pages", pages);

  const response = await postForm("/api/tools/page-numbers", form, signal);
  return toProcessedDocument(response, "numbered.pdf");
}

export interface RunCropOptions {
  file: File;
  mode: string;
  /** Rectangle mode fields (points). */
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  /** Margins mode fields (points). */
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
  /** Raw ranges, e.g. "1-3, 5". Omitted means every page. */
  ranges?: string;
  signal?: AbortSignal;
}

/**
 * Crop one PDF on the server (CropBox only). Every value is re-validated
 * there; the response reports how many pages were cropped.
 */
export async function runCrop({
  file,
  mode,
  x,
  y,
  width,
  height,
  top,
  right,
  bottom,
  left,
  ranges,
  signal,
}: RunCropOptions): Promise<ProcessedDocument> {
  const form = new FormData();
  form.append("files", file, file.name);
  form.append("mode", mode);
  if (mode === "rectangle") {
    form.append("x", String(x ?? 0));
    form.append("y", String(y ?? 0));
    form.append("width", String(width ?? 0));
    form.append("height", String(height ?? 0));
  } else {
    form.append("top", String(top ?? 0));
    form.append("right", String(right ?? 0));
    form.append("bottom", String(bottom ?? 0));
    form.append("left", String(left ?? 0));
  }
  if (ranges !== undefined && ranges.trim() !== "") {
    form.append("ranges", ranges);
  }

  const response = await postForm("/api/tools/crop", form, signal);
  return toProcessedDocument(response, "cropped.pdf");
}

export interface RunFlattenPdfOptions {
  file: File;
  signal?: AbortSignal;
}

/**
 * Flatten one PDF's form fields into permanent page content on the server
 * (vector flattening — never rasterisation). The response reports the number
 * of fields the server actually flattened. Signed PDFs are rejected with a
 * `SIGNED_PDF` error; document-level scripts are not removed.
 */
export async function runFlattenPdf({
  file,
  signal,
}: RunFlattenPdfOptions): Promise<ProcessedDocument> {
  const form = new FormData();
  form.append("files", file, file.name);

  const response = await postForm("/api/tools/flatten-pdf", form, signal);
  return toProcessedDocument(response, "flattened.pdf");
}

export interface RunPasswordProtectOptions {
  file: File;
  /** The password exactly as typed — never trimmed, never logged. */
  password: string;
  signal?: AbortSignal;
}

/**
 * Protect one PDF with a password on the server. The password travels once,
 * as a multipart field; the server validates it again, encrypts with RC4
 * 128-bit (V2/R3) and verifies the encrypted document before returning it.
 */
export async function runPasswordProtect({
  file,
  password,
  signal,
}: RunPasswordProtectOptions): Promise<ProcessedDocument> {
  const form = new FormData();
  form.append("files", file, file.name);
  form.append("password", password);

  const response = await postForm("/api/tools/password-protect", form, signal);
  return toProcessedDocument(response, "protected.pdf");
}

export interface RunUnlockPdfOptions {
  file: File;
  /** The password exactly as typed; `""` when the file needs none. */
  password: string;
  signal?: AbortSignal;
}

/**
 * Remove a known password from one PDF on the server. The password travels
 * once, as a multipart field; the server authenticates it (never recovers
 * it), decrypts with RC4 support only, and verifies the unlocked document
 * before returning it.
 */
export async function runUnlockPdf({
  file,
  password,
  signal,
}: RunUnlockPdfOptions): Promise<ProcessedDocument> {
  const form = new FormData();
  form.append("files", file, file.name);
  form.append("password", password);

  const response = await postForm("/api/tools/unlock-pdf", form, signal);
  return toProcessedDocument(response, "unlocked.pdf");
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
