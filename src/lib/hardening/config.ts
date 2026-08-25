import "server-only";

/**
 * Production-hardening configuration (Phase 28, Wave 1).
 *
 * Two safety valves on top of the per-request size limits in
 * `lib/processing/limits.ts`:
 *
 * - `requestTimeoutMs` — how long a processing request may take before the
 *   caller receives `504 REQUEST_TIMEOUT`. The underlying job is **not**
 *   aborted: pdfium's WASM work cannot be cancelled mid-render and pdf-lib
 *   keeps no cancellation token, so pretending to stop the work would be
 *   dishonest. When the timeout fires the job keeps running privately, its
 *   result is discarded, and its concurrency slot is released only when it
 *   genuinely finishes.
 *
 * - `maxConcurrentJobs` — an optional cap on jobs running at the same time.
 *   `0` (the default) means "no cap", so a small self-hosted instance behaves
 *   exactly as before. When the cap is reached, extra requests fail fast with
 *   `503 SERVER_BUSY` instead of queueing invisibly. There is deliberately no
 *   queue: this is a single-purpose in-memory processor, not a multi-tenant
 *   SaaS.
 *
 * Both values are read on each call (cheap), so deployments — and tests — can
 * change them without a rebuild.
 */

export interface HardeningConfig {
  /** Milliseconds a processing request may take before a 504 is returned. */
  requestTimeoutMs: number;
  /** Maximum jobs processed at the same time; `0` disables the cap. */
  maxConcurrentJobs: number;
  /** Maximum requests allowed per minute per client IP hash; `0` disables rate limiting. */
  rateLimitPerMinute: number;
}

export const DEFAULT_HARDENING_CONFIG: HardeningConfig = {
  requestTimeoutMs: 120_000,
  maxConcurrentJobs: 0,
  rateLimitPerMinute: 60,
};

/** Hard ceilings, so a misconfigured environment cannot pin the instance. */
const REQUEST_TIMEOUT_CEILING_MS = 600_000; // 10 minutes
const MAX_CONCURRENT_JOBS_CEILING = 1024;
const RATE_LIMIT_CEILING = 1000;

function readPositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

/** Effective hardening configuration for the current environment. */
export function getHardeningConfig(): HardeningConfig {
  return {
    requestTimeoutMs: Math.min(
      readPositiveInt(
        process.env.PDFKIT_REQUEST_TIMEOUT_MS,
        DEFAULT_HARDENING_CONFIG.requestTimeoutMs,
      ),
      REQUEST_TIMEOUT_CEILING_MS,
    ),
    maxConcurrentJobs: Math.min(
      readPositiveInt(
        process.env.PDFKIT_MAX_CONCURRENT_JOBS,
        DEFAULT_HARDENING_CONFIG.maxConcurrentJobs,
      ),
      MAX_CONCURRENT_JOBS_CEILING,
    ),
    rateLimitPerMinute: Math.min(
      readPositiveInt(
        process.env.PDFKIT_RATE_LIMIT_PER_MINUTE,
        DEFAULT_HARDENING_CONFIG.rateLimitPerMinute,
      ),
      RATE_LIMIT_CEILING,
    ),
  };
}
