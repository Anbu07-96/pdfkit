import "server-only";

import type { ProcessingInputFile } from "@/lib/processing/contract";
import {
  ProcessingError,
  httpStatusForCode,
  toErrorResponseBody,
  type ProcessingErrorCode,
} from "@/lib/processing/errors";
import { getProcessingLimits } from "@/lib/processing/limits";
import { runProcessingJob } from "@/lib/processing/service";
import { formatBytes } from "@/lib/utils/format";

/**
 * HTTP adapter for the processing service.
 *
 * Route handlers stay thin: they call `handleProcessingRequest` with a tool id.
 * Everything HTTP-specific — multipart parsing, request-size protection,
 * response headers and error shaping — lives here so every future tool route
 * behaves identically.
 */

/** Form field carrying the documents, in the order the user arranged them. */
export const FILES_FIELD = "files";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
} as const;

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
    .trim();
  return cleaned.length > 0 && cleaned.length <= 120 ? cleaned : fallback;
}

export interface HandleProcessingRequestOptions {
  toolId: string;
  /** Fallback download name when the artifact does not provide one. */
  fallbackFileName: string;
}

export async function handleProcessingRequest(
  request: Request,
  { toolId, fallbackFileName }: HandleProcessingRequestOptions,
): Promise<Response> {
  const limits = getProcessingLimits();

  // 1. Cheap rejections first — before the body is read into memory.
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    return jsonError(
      "VALIDATION_ERROR",
      "Send the files as a multipart/form-data request.",
    );
  }

  // `content-length` covers the whole multipart envelope (boundaries and part
  // headers), so a small allowance keeps a request that is just under the file
  // budget from being rejected here. Exact accounting happens below.
  const envelopeAllowance = Math.ceil(limits.maxTotalSize * 0.05) + 8 * 1024;
  const declaredLength = Number(request.headers.get("content-length") ?? "");
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > limits.maxTotalSize + envelopeAllowance
  ) {
    return jsonError(
      "TOTAL_SIZE_EXCEEDED",
      `The total upload must be ${formatBytes(limits.maxTotalSize, 0)} or smaller.`,
    );
  }

  // 2. Parse the multipart body.
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError("VALIDATION_ERROR", "The upload could not be read.");
  }

  const entries = form.getAll(FILES_FIELD).filter((entry): entry is File =>
    typeof entry === "object" && entry !== null && "arrayBuffer" in entry,
  );

  if (entries.length === 0) {
    return jsonError("VALIDATION_ERROR", "No files were uploaded.");
  }

  if (entries.length > limits.maxFiles) {
    return jsonError(
      "TOO_MANY_FILES",
      `You can process up to ${limits.maxFiles} files at once. You sent ${entries.length}.`,
    );
  }

  // 3. Read the bytes, enforcing the size budget as we go.
  const files: ProcessingInputFile[] = [];
  let totalBytes = 0;

  try {
    for (const [index, entry] of entries.entries()) {
      if (entry.size > limits.maxFileSize) {
        return jsonError(
          "FILE_TOO_LARGE",
          `Each file must be ${formatBytes(limits.maxFileSize, 0)} or smaller.`,
          [`${entry.name} is larger than ${formatBytes(limits.maxFileSize, 0)}.`],
        );
      }

      totalBytes += entry.size;
      if (totalBytes > limits.maxTotalSize) {
        return jsonError(
          "TOTAL_SIZE_EXCEEDED",
          `The total upload must be ${formatBytes(limits.maxTotalSize, 0)} or smaller.`,
        );
      }

      files.push({
        id: `input-${index + 1}`,
        name: entry.name || `document-${index + 1}.pdf`,
        size: entry.size,
        mimeType: entry.type ?? "",
        bytes: new Uint8Array(await entry.arrayBuffer()),
      });
    }
  } catch (error) {
    return errorResponse(error);
  }

  // 4. Hand over to the processing service (validation happens inside).
  const result = await runProcessingJob({ toolId, files }, { limits });

  if (result.status === "failed") {
    return Response.json(
      { error: result.error },
      {
        status: httpStatusForCode(result.error.code as ProcessingErrorCode),
        headers: JSON_HEADERS,
      },
    );
  }

  const artifact = result.artifacts[0];
  if (!artifact) {
    return jsonError("PROCESSING_ERROR", "No document was produced.");
  }

  const fileName = sanitizeFileName(artifact.name, fallbackFileName);

  // 5. Stream the produced document straight back — nothing is persisted.
  return new Response(new Uint8Array(artifact.bytes), {
    status: 200,
    headers: {
      "content-type": artifact.mimeType,
      "content-length": String(artifact.size),
      "content-disposition": `attachment; filename="${fileName}"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...(result.meta?.pages !== undefined
        ? { "x-pdfkit-pages": String(result.meta.pages) }
        : {}),
    },
  });
}

/** Consistent 405 for unsupported verbs on a processing route. */
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
