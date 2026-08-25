import "server-only";

import { jsonError } from "@/lib/processing/http";

/**
 * Request guards (Phase 28, Wave 1).
 *
 * Cheap, deterministic checks that run before a single byte of the request
 * body is parsed, plus the slot counter behind the optional concurrency cap.
 */

/**
 * The numeric Content-Length gate.
 *
 * When a Content-Length header is present it must be a plain decimal byte
 * count. Anything else (`abc`, `-1`, `1e5`, `12.5`, a number beyond the safe
 * integer range) is a client or middleware bug — or an attempt to desynchronise
 * proxies — and is rejected with 400 before the body is read. A missing header
 * is allowed: chunked multipart uploads are legitimate, and the exact byte
 * accounting in the HTTP adapter still applies to them.
 *
 * Returns `null` when the request may proceed, or a ready-made error response.
 */
export function checkContentLengthHeader(request: Request): Response | null {
  const header = request.headers.get("content-length");
  if (header === null) return null;

  const trimmed = header.trim();
  if (!/^\d+$/.test(trimmed) || !Number.isSafeInteger(Number(trimmed))) {
    return jsonError(
      "VALIDATION_ERROR",
      "The request's Content-Length header is not a valid byte count.",
    );
  }
  return null;
}

/**
 * Process-wide count of running jobs. Module state is intentional: one Node
 * process is one deployment instance, and the cap is per instance.
 */
let activeJobs = 0;

/** How many jobs are currently running in this process (diagnostics/tests). */
export function activeJobCount(): number {
  return activeJobs;
}

/**
 * Try to take a job slot. `maxConcurrentJobs <= 0` disables the cap: every
 * request is admitted (but still counted, so diagnostics and release stay
 * symmetric). Returns `false` only when the configured cap is reached.
 */
export function tryAcquireJobSlot(maxConcurrentJobs: number): boolean {
  if (maxConcurrentJobs > 0 && activeJobs >= maxConcurrentJobs) return false;
  activeJobs += 1;
  return true;
}

/** Return a job slot. Pairs with every successful `tryAcquireJobSlot`. */
export function releaseJobSlot(): void {
  activeJobs = Math.max(0, activeJobs - 1);
}
