import "server-only";

/**
 * Privacy-safe production logger.
 *
 * Emits structured JSON entries for job execution and monitoring.
 * Logs MUST NEVER contain:
 * - Passwords
 * - Uploaded file names
 * - Document content or extracted text
 * - Query strings / user-supplied URLs
 * - Secrets or raw request bodies
 */

export interface LogJobEntry {
  toolId: string;
  outcome: "succeeded" | "failed";
  fileCount: number;
  totalBytes: number;
  durationMs: number;
  code?: string;
  /** Account tier of the caller, when known (Phase 62 observability). */
  tier?: string;
  /**
   * Client-generated batch correlation id (bulk tools). Strictly validated
   * (alnum + hyphens) before it reaches here and used for log correlation
   * only — never for authorization, quota or security decisions.
   */
  batchId?: string;
  /**
   * Server-generated request correlation id (Phase 63). Ties the HTTP
   * response, timeout event and job outcome lines of one request together.
   */
  requestId?: string;
  /** Safe error category label (Phase 63), e.g. "rate-limited". */
  errorCategory?: string;
}

export function logStructuredJob(entry: LogJobEntry): void {
  const payload = {
    timestamp: new Date().toISOString(),
    level: "info",
    event: "job_completed",
    tool: entry.toolId,
    outcome: entry.outcome,
    files: entry.fileCount,
    bytes: entry.totalBytes,
    ms: entry.durationMs,
    ...(entry.code ? { code: entry.code } : {}),
    ...(entry.tier ? { tier: entry.tier } : {}),
    ...(entry.batchId ? { batchId: entry.batchId } : {}),
    ...(entry.requestId ? { requestId: entry.requestId } : {}),
    ...(entry.errorCategory ? { errorCategory: entry.errorCategory } : {}),
  };

  if (process.env.NODE_ENV === "production" || process.env.STRUCTURED_LOGS === "true") {
    console.info(JSON.stringify(payload));
  } else {
    console.info(
      `[processing] tool=${entry.toolId} outcome=${entry.outcome}` +
        ` files=${entry.fileCount} bytes=${entry.totalBytes}` +
        ` ms=${entry.durationMs}${entry.code ? ` code=${entry.code}` : ""}` +
        `${entry.tier ? ` tier=${entry.tier}` : ""}` +
        `${entry.batchId ? ` batchId=${entry.batchId}` : ""}` +
        `${entry.requestId ? ` requestId=${entry.requestId}` : ""}` +
        `${entry.errorCategory ? ` errorCategory=${entry.errorCategory}` : ""}`,
    );
  }
}

/**
 * Privacy-safe structured event for operational telemetry (Phase 62).
 *
 * Same rules as `logStructuredJob`: field names and values are supplied by
 * trusted server code only. Callers must never pass document contents, file
 * names, passwords, tokens or raw request data — scalar operational facts
 * only (codes, counts, durations, tiers, sanitized correlation ids).
 */
export function logStructuredEvent(
  event: string,
  fields: Record<string, string | number | boolean | undefined>,
): void {
  const clean: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) clean[key] = value;
  }

  const payload = {
    timestamp: new Date().toISOString(),
    level: "info",
    event,
    ...clean,
  };

  if (process.env.NODE_ENV === "production" || process.env.STRUCTURED_LOGS === "true") {
    console.info(JSON.stringify(payload));
  } else {
    console.info(`[event] ${event} ${JSON.stringify(clean)}`);
  }
}
