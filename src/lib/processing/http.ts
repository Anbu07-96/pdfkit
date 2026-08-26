import "server-only";

import type { ProcessingInputFile } from "@/lib/processing/contract";
import {
  ProcessingError,
  httpStatusForCode,
  toErrorResponseBody,
  type ProcessingErrorCode,
} from "@/lib/processing/errors";
import { inspectPdf } from "@/lib/processing/inspect";
import { getProcessingLimits, type ProcessingLimits } from "@/lib/processing/limits";
import { runProcessingJob } from "@/lib/processing/service";
import { createZipArchive } from "@/lib/processing/zip";
import { formatBytes } from "@/lib/utils/format";
import { getUserIdentity } from "@/lib/auth/session";
import type { UserIdentity } from "@/lib/auth/types";
import { getUsageService } from "@/lib/usage/service";

/**
 * HTTP adapter for the processing service.
 *
 * Route handlers stay thin: they call `handleProcessingRequest` with a tool id
 * and, if the tool takes options, a small reader for them. Everything
 * HTTP-specific — multipart parsing, request-size protection, artifact
 * delivery, response headers and error shaping — lives here so every tool route
 * behaves identically.
 */

/** Form field carrying the documents, in the order the user arranged them. */
export const FILES_FIELD = "files";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
} as const;

const BINARY_HEADERS = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
} as const;

/** Shared JSON response headers for every processing-related route. */
export const JSON_RESPONSE_HEADERS = JSON_HEADERS;

/**
 * Hand document bytes to `Response` without copying them.
 */
function asResponseBody(bytes: Uint8Array): BodyInit {
  return bytes as Uint8Array<ArrayBuffer>;
}

export function jsonError(
  code: ProcessingErrorCode,
  message: string,
  details?: string[],
): Response {
  return Response.json(
    { error: { code, message, ...(details?.length ? { details } : {}) } },
    { status: httpStatusForCode(code), headers: JSON_HEADERS },
  );
}

function errorResponse(error: unknown): Response {
  const body = toErrorResponseBody(error);
  return Response.json(body, {
    status: error instanceof ProcessingError ? error.status : 500,
    headers: JSON_HEADERS,
  });
}

/** `report final.pdf` → `report final.pdf`; strips anything header-unsafe. */
function sanitizeFileName(name: string, fallback: string): string {
  const cleaned = name
    .replace(/[\r\n"\\]/g, "")
    .replace(/[/\\]/g, "-")
    // Strip C0 control characters so the header cannot be split.
    .replace(/[\u0000-\u001f\u007f]/g, "")
    // Header values must be ByteStrings
    .replace(/[^\u0000-\u00ff]/g, "_")
    .trim();
  return cleaned.length > 0 && cleaned.length <= 120 ? cleaned : fallback;
}

/**
 * Read and size-check the uploaded documents.
 *
 * Returns either the parsed files or a ready-made error `Response`, so callers
 * can bail out without duplicating any of these checks.
 */
async function readUploadedFiles(
  request: Request,
  limits: ProcessingLimits,
): Promise<{ files: ProcessingInputFile[]; form: FormData } | { response: Response }> {
  // 1. Cheap rejections first — before the body is read into memory.
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    return {
      response: jsonError(
        "VALIDATION_ERROR",
        "Send the files as a multipart/form-data request.",
      ),
    };
  }

  // `content-length` covers the whole multipart envelope
  const envelopeAllowance = Math.ceil(limits.maxTotalSize * 0.05) + 8 * 1024;
  const declaredLength = Number(request.headers.get("content-length") ?? "");
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > limits.maxTotalSize + envelopeAllowance
  ) {
    return {
      response: jsonError(
        "TOTAL_SIZE_EXCEEDED",
        `The total upload must be ${formatBytes(limits.maxTotalSize, 0)} or smaller.`,
      ),
    };
  }

  // 2. Parse the multipart body.
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return { response: jsonError("VALIDATION_ERROR", "The upload could not be read.") };
  }

  const entries = form.getAll(FILES_FIELD).filter((entry): entry is File =>
    typeof entry === "object" && entry !== null && "arrayBuffer" in entry,
  );

  if (entries.length === 0) {
    return { response: jsonError("VALIDATION_ERROR", "No files were uploaded.") };
  }

  if (entries.length > limits.maxFiles) {
    return {
      response: jsonError(
        "TOO_MANY_FILES",
        `You can process up to ${limits.maxFiles} files at once. You sent ${entries.length}.`,
      ),
    };
  }

  // 3. Read the bytes, enforcing the size budget as we go.
  const files: ProcessingInputFile[] = [];
  let totalBytes = 0;

  try {
    for (const [index, entry] of entries.entries()) {
      if (entry.size > limits.maxFileSize) {
        return {
          response: jsonError(
            "FILE_TOO_LARGE",
            `Each file must be ${formatBytes(limits.maxFileSize, 0)} or smaller.`,
            [`${entry.name} is larger than ${formatBytes(limits.maxFileSize, 0)}.`],
          ),
        };
      }

      totalBytes += entry.size;
      if (totalBytes > limits.maxTotalSize) {
        return {
          response: jsonError(
            "TOTAL_SIZE_EXCEEDED",
            `The total upload must be ${formatBytes(limits.maxTotalSize, 0)} or smaller.`,
          ),
        };
      }

      // Sanitize input file name against path traversal
      const rawName = entry.name ? entry.name.split(/[/\\]/).pop() || entry.name : "";
      const safeInputName =
        rawName.replace(/[\u0000-\u001f\u007f]/g, "").trim() || `document-${index + 1}.pdf`;

      files.push({
        id: `input-${index + 1}`,
        name: safeInputName,
        size: entry.size,
        mimeType: entry.type ?? "",
        bytes: new Uint8Array(await entry.arrayBuffer()),
      });
    }
  } catch (error) {
    return { response: errorResponse(error) };
  }

  return { files, form };
}

export interface HandleProcessingRequestOptions<TOptions> {
  toolId: string;
  /** Fallback download name when the artifact does not provide one. */
  fallbackFileName: string;
  /**
   * Pull tool options out of the multipart body. Values are untrusted: the
   * processor validates them server-side.
   */
  readOptions?: (form: FormData) => TOptions;
  /** Resolved user identity from auth layer (Phase 42/43). */
  identity?: UserIdentity;
}

export async function handleProcessingRequest<TOptions = Record<string, unknown>>(
  request: Request,
  { toolId, fallbackFileName, readOptions, identity }: HandleProcessingRequestOptions<TOptions>,
): Promise<Response> {
  const limits = getProcessingLimits();

  const upload = await readUploadedFiles(request, limits);
  if ("response" in upload) return upload.response;

  const options = readOptions ? readOptions(upload.form) : undefined;

  // Hand over to the processing service (validation happens inside).
  const result = await runProcessingJob<TOptions>(
    { toolId, files: upload.files, options },
    { limits },
  );

  if (result.status === "failed") {
    return Response.json(
      { error: result.error },
      {
        status: httpStatusForCode(result.error.code as ProcessingErrorCode),
        headers: JSON_HEADERS,
      },
    );
  }

  if (result.artifacts.length === 0) {
    return jsonError("PROCESSING_ERROR", "No document was produced.");
  }

  // Record successful usage metering (Phase 43)
  const userIdentity = identity || (await getUserIdentity());
  const totalProcessedBytes = upload.files.reduce((sum, f) => sum + f.size, 0);
  try {
    await getUsageService().recordJobSuccess(userIdentity, totalProcessedBytes);
  } catch (usageError) {
    console.error("[usage] Failed to record usage after successful job", usageError);
  }

  const metaHeaders: Record<string, string> = {
    "x-pdfkit-artifacts": String(result.artifacts.length),
    ...(result.meta?.pages !== undefined
      ? { "x-pdfkit-pages": String(result.meta.pages) }
      : {}),
    ...(result.meta?.outputPages !== undefined
      ? { "x-pdfkit-output-pages": String(result.meta.outputPages) }
      : {}),
  };

  // Compression statistics (Compress PDF)
  if (result.meta?.originalBytes !== undefined) {
    metaHeaders["x-pdfkit-original-bytes"] = String(result.meta.originalBytes);
  }
  if (result.meta?.outputBytes !== undefined) {
    metaHeaders["x-pdfkit-output-bytes"] = String(result.meta.outputBytes);
  }
  if (result.meta?.bytesSaved !== undefined) {
    metaHeaders["x-pdfkit-bytes-saved"] = String(result.meta.bytesSaved);
  }
  if (result.meta?.reductionPercent !== undefined) {
    metaHeaders["x-pdfkit-reduction-percent"] = String(
      result.meta.reductionPercent,
    );
  }
  if (result.meta?.reduced !== undefined) {
    metaHeaders["x-pdfkit-reduced"] = String(result.meta.reduced);
  }
  if (result.meta?.compressionLevel !== undefined) {
    metaHeaders["x-pdfkit-compression-level"] = String(
      result.meta.compressionLevel,
    );
  }
  if (result.meta?.strategy !== undefined) {
    metaHeaders["x-pdfkit-compression-strategy"] = String(result.meta.strategy);
  }
  if (result.meta?.rasterSkipped !== undefined) {
    metaHeaders["x-pdfkit-raster-skipped"] = String(result.meta.rasterSkipped);
  }

  // Metadata removal facts
  if (result.meta?.removedFields !== undefined) {
    metaHeaders["x-pdfkit-removed-fields"] = String(result.meta.removedFields);
  }
  if (result.meta?.xmpRemoved !== undefined) {
    metaHeaders["x-pdfkit-xmp-removed"] = String(result.meta.xmpRemoved);
  }
  if (result.meta?.verification !== undefined) {
    metaHeaders["x-pdfkit-verification"] = String(result.meta.verification);
  }

  // Text extraction facts
  if (result.meta?.characters !== undefined) {
    metaHeaders["x-pdfkit-characters"] = String(result.meta.characters);
  }
  if (result.meta?.paragraphs !== undefined) {
    metaHeaders["x-pdfkit-paragraphs"] = String(result.meta.paragraphs);
  }
  if (result.meta?.mode !== undefined) {
    metaHeaders["x-pdfkit-mode"] = String(result.meta.mode);
  }

  // Watermark facts
  if (result.meta?.watermarkedPages !== undefined) {
    metaHeaders["x-pdfkit-watermarked-pages"] = String(
      result.meta.watermarkedPages,
    );
  }

  // Add Text facts
  if (result.meta?.textPages !== undefined) {
    metaHeaders["x-pdfkit-text-pages"] = String(result.meta.textPages);
  }

  // Page-number facts
  if (result.meta?.numberedPages !== undefined) {
    metaHeaders["x-pdfkit-numbered-pages"] = String(result.meta.numberedPages);
  }

  // Crop facts
  if (result.meta?.croppedPages !== undefined) {
    metaHeaders["x-pdfkit-cropped-pages"] = String(result.meta.croppedPages);
  }

  // Flatten facts
  if (result.meta?.flattenedFields !== undefined) {
    metaHeaders["x-pdfkit-flattened-fields"] = String(
      result.meta.flattenedFields,
    );
  }

  // Single artifact delivery
  if (result.artifacts.length === 1) {
    const artifact = result.artifacts[0];
    const fileName = sanitizeFileName(artifact.name, fallbackFileName);

    return new Response(asResponseBody(artifact.bytes), {
      status: 200,
      headers: {
        ...BINARY_HEADERS,
        ...metaHeaders,
        "content-type": artifact.mimeType,
        "content-length": String(artifact.size),
        "content-disposition": `attachment; filename="${fileName}"`,
      },
    });
  }

  let archive: Uint8Array;
  try {
    archive = createZipArchive(result.artifacts);
  } catch (error) {
    return errorResponse(error);
  }

  const zipName = sanitizeFileName(
    result.bundleName ?? `${toolId}-output.zip`,
    `${toolId}-output.zip`,
  );

  return new Response(asResponseBody(archive), {
    status: 200,
    headers: {
      ...BINARY_HEADERS,
      ...metaHeaders,
      "content-type": "application/zip",
      "content-length": String(archive.length),
      "content-disposition": `attachment; filename="${zipName}"`,
    },
  });
}

export interface SingleUploadedPdf {
  file: ProcessingInputFile;
  form: FormData;
  release: () => void;
}

export async function readSingleUploadedPdf(
  request: Request,
): Promise<SingleUploadedPdf | { response: Response }> {
  const limits = getProcessingLimits();
  const upload = await readUploadedFiles(request, limits);
  if ("response" in upload) return upload;

  if (upload.files.length > 1) {
    return {
      response: jsonError(
        "TOO_MANY_FILES",
        `Send one PDF. You sent ${upload.files.length}.`,
      ),
    };
  }

  return {
    file: upload.files[0],
    form: upload.form,
    release: () => {
      upload.files.length = 0;
    },
  };
}

export async function handleInspectRequest(request: Request): Promise<Response> {
  const upload = await readSingleUploadedPdf(request);
  if ("response" in upload) return upload.response;

  try {
    const inspection = await inspectPdf(upload.file);
    return Response.json(inspection, { status: 200, headers: JSON_HEADERS });
  } catch (error) {
    if (!(error instanceof ProcessingError)) {
      console.error("[processing] unexpected failure while inspecting a PDF", error);
    }
    return errorResponse(error);
  } finally {
    upload.release();
  }
}

export function methodNotAllowed(allow = "POST"): Response {
  return Response.json(
    {
      error: {
        code: "VALIDATION_ERROR",
        message: `Use ${allow} for this endpoint.`,
      },
    },
    { status: 405, headers: { ...JSON_HEADERS, allow } },
  );
}
