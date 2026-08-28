import "server-only";

import { jsonError } from "@/lib/processing/http";

/**
 * Request guards (Phase 28/55).
 *
 * Cheap, deterministic checks that run before a single byte of the request
 * body is parsed, plus the slot counter behind the optional concurrency cap.
 */

/**
 * The numeric Content-Length gate.
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
 * Verify Origin or Referer header on state-changing requests to prevent CSRF.
 * Returns null if valid, or a ready-made HTTP 403 Response if invalid origin.
 */
export function checkRequestOrigin(request: Request): Response | null {
  const origin = request.headers.get("origin") || request.headers.get("referer");
  if (!origin) return null; // Same-origin or non-browser client

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  try {
    const requestHost = new URL(origin).host;
    const siteHost = new URL(siteUrl).host;

    // Allow site host, localhost, or allowed dev origins
    if (
      requestHost === siteHost ||
      requestHost.includes("localhost") ||
      requestHost.includes("127.0.0.1") ||
      requestHost.endsWith(".e2b.app") ||
      requestHost.endsWith(".app.github.dev")
    ) {
      return null;
    }

    console.warn(`[hardening] CSRF origin check failed for origin: ${origin}`);
    return jsonError(
      "VALIDATION_ERROR",
      "Request origin verification failed.",
    );
  } catch {
    return jsonError(
      "VALIDATION_ERROR",
      "Invalid request origin header.",
    );
  }
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
