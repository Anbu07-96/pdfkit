import "server-only";

/**
 * Centralised processing limits.
 *
 * Every limit is configurable through an environment variable with a safe
 * default, so nothing is hardcoded across the application. Values are read on
 * each call (cheap) so deployments — and tests — can change them without a
 * rebuild.
 *
 * Defaults (documented in `.env.example` and the README):
 *
 * | Variable                          | Default | Meaning                    |
 * | --------------------------------- | ------- | -------------------------- |
 * | PDFKIT_MAX_FILES_PER_JOB          | 20      | files per request          |
 * | PDFKIT_MAX_UPLOAD_SIZE            | 25 MB   | size of a single file      |
 * | PDFKIT_MAX_TOTAL_UPLOAD_SIZE      | 100 MB  | total size of one request  |
 * | PDFKIT_MAX_SPLIT_OUTPUTS          | 50      | documents one job may emit |
 *
 * The MVP processes documents entirely in memory, so these limits also bound
 * the memory a single request can use.
 */

const MB = 1024 * 1024;

export interface ProcessingLimits {
  /** Maximum number of files accepted in a single job. */
  maxFiles: number;
  /** Maximum size of one file, in bytes. */
  maxFileSize: number;
  /** Maximum combined size of all files in one request, in bytes. */
  maxTotalSize: number;
  /**
   * Maximum number of documents a single job may produce (for example when
   * splitting every page). Checked before any output is generated.
   */
  maxOutputs: number;
}

export const DEFAULT_PROCESSING_LIMITS: ProcessingLimits = {
  maxFiles: 20,
  maxFileSize: 25 * MB,
  maxTotalSize: 100 * MB,
  maxOutputs: 50,
};

function readPositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

/** Effective limits for the current environment. */
export function getProcessingLimits(): ProcessingLimits {
  const maxFiles = readPositiveInt(
    process.env.PDFKIT_MAX_FILES_PER_JOB,
    DEFAULT_PROCESSING_LIMITS.maxFiles,
  );
  const maxFileSize = readPositiveInt(
    process.env.PDFKIT_MAX_UPLOAD_SIZE,
    DEFAULT_PROCESSING_LIMITS.maxFileSize,
  );
  const maxTotalSize = readPositiveInt(
    process.env.PDFKIT_MAX_TOTAL_UPLOAD_SIZE,
    DEFAULT_PROCESSING_LIMITS.maxTotalSize,
  );

  const maxOutputs = readPositiveInt(
    process.env.PDFKIT_MAX_SPLIT_OUTPUTS,
    DEFAULT_PROCESSING_LIMITS.maxOutputs,
  );

  return {
    maxFiles,
    maxFileSize,
    maxOutputs,
    // A total smaller than a single file would be contradictory.
    maxTotalSize: Math.max(maxTotalSize, maxFileSize),
  };
}
