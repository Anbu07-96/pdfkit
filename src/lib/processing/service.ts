import "server-only";

import type {
  ProcessingRequest,
  ProcessingResult,
} from "@/lib/processing/contract";
import { ProcessingError, toErrorResponseBody } from "@/lib/processing/errors";
import { getProcessingLimits, type ProcessingLimits } from "@/lib/processing/limits";
import { getProcessor } from "@/lib/processing/registry";
import { validateProcessingInput } from "@/lib/processing/validation/pdf-input";
import { captureServerException } from "@/lib/monitoring/sentry";
import { recordTelemetryEvent } from "@/lib/monitoring/telemetry";
import { classifyBulkError } from "@/lib/bulk/errors";

/**
 * The processing service: the single entry point between the API layer and the
 * tool processors.
 *
 * Responsibilities:
 * 1. resolve the processor for a tool,
 * 2. validate input before any expensive parsing,
 * 3. run the processor,
 * 4. convert any failure into a structured, safe result,
 * 5. emit privacy-safe diagnostics.
 *
 * Input files are held in memory only for the duration of the call. The
 * `finally` block drops the references so nothing outlives the request.
 */

export interface RunProcessingJobOptions {
  limits?: ProcessingLimits;
  /**
   * Optional operational log context (Phase 62). Values are supplied by
   * trusted server code (resolved identity tier, validated batch id) and are
   * used for log correlation only — never for decisions.
   */
  logContext?: { tier?: string; batchId?: string; requestId?: string };
}

export async function runProcessingJob<TOptions>(
  request: ProcessingRequest<TOptions>,
  {
    limits = getProcessingLimits(),
    logContext,
  }: RunProcessingJobOptions = {},
): Promise<ProcessingResult> {
  const startedAt = Date.now();
  const fileCount = request.files.length;
  const totalBytes = request.files.reduce((total, file) => total + file.bytes.length, 0);

  // Operational telemetry (Phase 63). Metadata only — never contents.
  const telemetryContext = {
    toolId: request.toolId,
    ...(logContext?.tier ? { tier: logContext.tier } : {}),
    ...(logContext?.batchId ? { batchId: logContext.batchId } : {}),
    ...(logContext?.requestId ? { requestId: logContext.requestId } : {}),
  };
  recordTelemetryEvent({
    type: "job_started",
    ...telemetryContext,
    fileCount,
    inputBytes: totalBytes,
  });

  try {
    const processor = getProcessor<TOptions>(request.toolId);

    validateProcessingInput({
      files: request.files,
      rules: processor.input,
      limits,
    });

    const result = await processor.process(request, { limits });

    recordTelemetryEvent({
      type: "job_completed",
      ...telemetryContext,
      durationMs: Date.now() - startedAt,
      fileCount,
      inputBytes: totalBytes,
      outputBytes:
        result.status === "succeeded"
          ? result.artifacts.reduce((total, artifact) => total + artifact.size, 0)
          : 0,
      ...(result.status === "succeeded" && result.meta?.pages !== undefined
        ? { pages: Number(result.meta.pages) }
        : {}),
      ...(result.status === "succeeded" && result.meta?.extractedImagesCount !== undefined
        ? { images: Number(result.meta.extractedImagesCount) }
        : {}),
    });

    return result;
  } catch (error) {
    const body = toErrorResponseBody(error);

    recordTelemetryEvent({
      type: "job_failed",
      ...telemetryContext,
      durationMs: Date.now() - startedAt,
      fileCount,
      inputBytes: totalBytes,
      errorCode: body.error.code,
      errorCategory: classifyBulkError(body.error.code).category,
    });

    if (!(error instanceof ProcessingError)) {
      // Keep the real cause in server logs only, without document data.
      console.error(`[processing] unexpected failure in ${request.toolId}`, error);
      captureServerException(error, { toolId: request.toolId, code: body.error.code });
    }

    return { status: "failed", error: body.error };
  } finally {
    // Release the in-memory buffers as soon as the job is done, on success and
    // on failure alike. There are no temporary files to clean up: the MVP never
    // writes uploads to disk.
    request.files.length = 0;
  }
}
