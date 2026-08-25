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
  };

  if (process.env.NODE_ENV === "production" || process.env.STRUCTURED_LOGS === "true") {
    console.info(JSON.stringify(payload));
  } else {
    console.info(
      `[processing] tool=${entry.toolId} outcome=${entry.outcome}` +
        ` files=${entry.fileCount} bytes=${entry.totalBytes}` +
        ` ms=${entry.durationMs}${entry.code ? ` code=${entry.code}` : ""}`,
    );
  }
}
