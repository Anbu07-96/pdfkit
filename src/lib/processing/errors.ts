/**
 * Processing error model.
 *
 * Every expected failure is a `ProcessingError` with a stable machine-readable
 * code, an HTTP status and a message that is safe to show a user. Unexpected
 * failures are converted into `INTERNAL_ERROR` so stack traces and library
 * internals never reach the client.
 *
 * This module is deliberately free of `server-only` so the browser can reuse
 * the codes and the user-facing copy.
 */

export const PROCESSING_ERROR_CODES = [
  "VALIDATION_ERROR",
  "UNSUPPORTED_FILE",
  "FILE_TOO_LARGE",
  "TOO_MANY_FILES",
  "TOTAL_SIZE_EXCEEDED",
  "INVALID_PDF",
  "ENCRYPTED_PDF",
  "INVALID_SPLIT_CONFIGURATION",
  "INVALID_PAGE_RANGE",
  "PAGE_OUT_OF_RANGE",
  "OVERLAPPING_RANGES",
  "TOO_MANY_OUTPUTS",
  "PROCESSING_ERROR",
  "TOOL_NOT_AVAILABLE",
  "INTERNAL_ERROR",
] as const;

export type ProcessingErrorCode = (typeof PROCESSING_ERROR_CODES)[number];

const HTTP_STATUS: Record<ProcessingErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNSUPPORTED_FILE: 415,
  FILE_TOO_LARGE: 413,
  TOO_MANY_FILES: 413,
  TOTAL_SIZE_EXCEEDED: 413,
  INVALID_PDF: 422,
  ENCRYPTED_PDF: 422,
  INVALID_SPLIT_CONFIGURATION: 400,
  INVALID_PAGE_RANGE: 400,
  PAGE_OUT_OF_RANGE: 400,
  OVERLAPPING_RANGES: 400,
  TOO_MANY_OUTPUTS: 413,
  PROCESSING_ERROR: 500,
  TOOL_NOT_AVAILABLE: 404,
  INTERNAL_ERROR: 500,
};

export interface ProcessingErrorOptions {
  /**
   * Extra user-facing lines, typically which files were rejected. Shown to the
   * person who uploaded the files and never written to logs.
   */
  details?: string[];
  /** Original error, kept for local debugging only. Never serialised. */
  cause?: unknown;
}

export class ProcessingError extends Error {
  readonly code: ProcessingErrorCode;
  readonly status: number;
  readonly details?: string[];

  constructor(
    code: ProcessingErrorCode,
    message: string,
    options: ProcessingErrorOptions = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "ProcessingError";
    this.code = code;
    this.status = HTTP_STATUS[code];
    this.details = options.details?.length ? options.details : undefined;
  }
}

export function isProcessingError(value: unknown): value is ProcessingError {
  return value instanceof ProcessingError;
}

export function httpStatusForCode(code: ProcessingErrorCode): number {
  return HTTP_STATUS[code] ?? 500;
}

/** Shape returned by the API for any failed request. */
export interface ProcessingErrorResponseBody {
  error: {
    code: ProcessingErrorCode;
    message: string;
    details?: string[];
  };
}

/**
 * Convert any thrown value into a safe response body. Unknown errors are
 * flattened to `INTERNAL_ERROR` — no messages, stacks or causes leak out.
 */
export function toErrorResponseBody(error: unknown): ProcessingErrorResponseBody {
  if (isProcessingError(error)) {
    return {
      error: {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
    };
  }

  return {
    error: {
      code: "INTERNAL_ERROR",
      message: "Something went wrong while processing your files. Please try again.",
    },
  };
}
