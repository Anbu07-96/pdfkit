import "server-only";

import type {
  ProcessingRequest,
  ProcessingResult,
} from "@/lib/processing/contract";
import { ProcessingError, toErrorResponseBody } from "@/lib/processing/errors";
import { getProcessingLimits, type ProcessingLimits } from "@/lib/processing/limits";
import { getProcessor } from "@/lib/processing/registry";
import { validateProcessingInput } from "@/lib/processing/validation/pdf-input";
import { logStructuredJob } from "@/lib/monitoring/logger";
import { captureServerException } from "@/lib/monitoring/sentry";

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
}

export async function runProcessingJob<TOptions>(
  request: ProcessingRequest<TOptions>,
  { limits = getProcessingLimits() }: RunProcessingJobOptions = {},
): Promise<ProcessingResult> {
  const startedAt = Date.now();
  const fileCount = request.files.length;
  const totalBytes = request.files.reduce((total, file) => total + file.bytes.length, 0);

  try {
    const processor = getProcessor<TOptions>(request.toolId);

    validateProcessingInput({
      files: request.files,
      rules: processor.input,
      limits,
    });

    const result = await processor.process(request, { limits });

    logStructuredJob({
      toolId: request.toolId,
      outcome: "succeeded",
      fileCount,
      totalBytes,
      durationMs: Date.now() - startedAt,
    });

    return result;
  } catch (error) {
    const body = toErrorResponseBody(error);

    logStructuredJob({
      toolId: request.toolId,
      outcome: "failed",
      fileCount,
      totalBytes,
      durationMs: Date.now() - startedAt,
      code: body.error.code,
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
