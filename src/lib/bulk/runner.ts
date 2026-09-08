import type { BulkBatchCaps, BulkOperation } from "@/lib/tools/bulk";
import { BULK_REQUEST_PACING_MS } from "@/lib/tools/bulk";

/**
 * Browser-side bulk batch runner (Phase 61).
 *
 * Runs a batch of files through an existing single-file processing endpoint,
 * **one request at a time**: the browser uploads each file as its own ordinary
 * `/api/tools/<tool>` request, so quota metering, rate limiting, concurrency
 * capping, origin checks, validation and sanitisation all apply per file with
 * no bulk-specific bypass. Sequential dispatch also means a batch adds no new
 * server concurrency pressure (one in-flight request per batch).
 *
 * Why pacing: the default IP rate limit is 60 requests/minute. A batch where
 * files fail instantly (invalid PDFs) would otherwise burst past it, so the
 * runner enforces a minimum gap between request starts and backs off on 429.
 *
 * The runner is transport only — no React, no DOM beyond `File`/`fetch`, which
 * keeps it unit-testable.
 */

export type BulkFileStatus =
  | "queued"
  | "processing"
  | "succeeded"
  | "failed"
  | "skipped-quota"
  | "skipped-budget"
  | "cancelled";

export interface BulkFileEntry {
  /** Stable id matching the UI's selected-file list. */
  id: string;
  file: File;
}

export interface BulkFileResult {
  id: string;
  name: string;
  size: number;
  status: BulkFileStatus;
  /** Download name reported by the server (successful files only). */
  fileName?: string;
  /** Result bytes (successful files only). */
  blob?: Blob;
  /** Pages reported by the server (`x-pdfkit-pages`). */
  pages?: number;
  /** Extracted images reported by the server (`x-pdfkit-extracted-images`). */
  images?: number;
  /** Typed failure detail (failed files only). */
  error?: { code?: string; message: string };
}

export type BulkStopReason =
  | "cancelled"
  | "quota"
  | "budget-pages"
  | "budget-output"
  | "budget-images"
  | "service-unavailable";

export interface BulkBudgets {
  pagesUsed: number;
  outputBytes: number;
  imagesUsed: number;
}

export interface BulkBatchRun {
  /** Final result snapshot for every file, in batch order. */
  results: BulkFileResult[];
  /** Why the batch stopped early, when it did. */
  stopReason?: BulkStopReason;
  budgets: BulkBudgets;
}

export interface RunBulkBatchOptions {
  operation: BulkOperation;
  files: BulkFileEntry[];
  caps: BulkBatchCaps;
  signal: AbortSignal;
  /** Fired on every status change of every file. */
  onFileStatus?: (result: BulkFileResult) => void;
  /** Fired after each file settles, with the running budget totals. */
  onProgress?: (progress: { settled: number; total: number } & BulkBudgets) => void;
  /**
   * Budget totals carried over from a previous run in the same session (used
   * when retrying failed files), so the browser-side output cap bounds the
   * *session*, not each attempt.
   */
  initialBudgets?: BulkBudgets;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
  /** Injectable for tests (default `setTimeout`). */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

const RATE_LIMIT_COOLDOWN_MS = 60_000;
const SERVER_BUSY_RETRY_MS = 10_000;
const MAX_RATE_LIMIT_RETRIES = 2;
const MAX_SERVER_BUSY_RETRIES = 3;
const MAX_NETWORK_RETRIES = 1;

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function fileNameFromDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const match = /filename="?([^";]+)"?/i.exec(header);
  return match?.[1]?.trim() || fallback;
}

function intHeader(response: Response, name: string): number | undefined {
  const raw = response.headers.get(name);
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

interface ErrorBody {
  error?: { code?: string; message?: string };
}

async function errorFromResponse(
  response: Response,
): Promise<{ code?: string; message: string }> {
  try {
    const body = (await response.json()) as ErrorBody;
    return {
      code: body.error?.code,
      message:
        body.error?.message ??
        "The file could not be processed. Nothing was changed on the server.",
    };
  } catch {
    return {
      message: "The file could not be processed. Nothing was changed on the server.",
    };
  }
}

/** Build the per-file form for an operation. Mirrors the single-tool clients. */
function buildForm(operation: BulkOperation, file: File): FormData {
  const form = new FormData();
  form.append("files", file, file.name);
  // The two page-selection endpoints require their `pages` option; bulk mode
  // always means "the whole document".
  if (operation.id === "extract-images" || operation.id === "pdf-to-text") {
    form.append("pages", "all");
  }
  return form;
}

/**
 * Run one file through the endpoint, handling 429/503 backoff and aborts.
 * Returns the file outcome; never throws (aborts surface as `cancelled`).
 */
async function processOneFile(
  operation: BulkOperation,
  entry: BulkFileEntry,
  options: {
    signal: AbortSignal;
    fetchImpl: typeof fetch;
    sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  },
): Promise<
  | { outcome: "succeeded"; blob: Blob; fileName: string; pages?: number; images?: number }
  | { outcome: "failed"; code?: string; message: string }
  | { outcome: "cancelled" }
  | { outcome: "quota" }
  | { outcome: "service-unavailable"; message: string }
> {
  const form = buildForm(operation, entry.file);
  let rateLimitRetries = 0;
  let busyRetries = 0;
  let networkRetries = 0;

  // Each loop iteration is one attempt; backoffs sleep (abortable) and retry.
  for (;;) {
    let response: Response;
    try {
      response = await options.fetchImpl(operation.endpoint, {
        method: "POST",
        body: form,
        signal: options.signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return { outcome: "cancelled" };
      }
      if (networkRetries < MAX_NETWORK_RETRIES) {
        networkRetries += 1;
        try {
          await options.sleep(2_000, options.signal);
        } catch {
          return { outcome: "cancelled" };
        }
        continue;
      }
      return {
        outcome: "failed",
        message: "The file could not be sent. Check your connection and try again.",
      };
    }

    if (response.ok) {
      const blob = await response.blob();
      return {
        outcome: "succeeded",
        blob,
        fileName: fileNameFromDisposition(
          response.headers.get("content-disposition"),
          "download",
        ),
        pages: intHeader(response, "x-pdfkit-pages"),
        images: intHeader(response, "x-pdfkit-extracted-images"),
      };
    }

    const failure = await errorFromResponse(response);

    if (failure.code === "QUOTA_EXCEEDED") {
      return { outcome: "quota" };
    }
    if (failure.code === "USAGE_SERVICE_UNAVAILABLE") {
      return {
        outcome: "service-unavailable",
        message: failure.message,
      };
    }
    if (failure.code === "TOO_MANY_REQUESTS") {
      if (rateLimitRetries >= MAX_RATE_LIMIT_RETRIES) {
        return {
          outcome: "failed",
          code: failure.code,
          message: failure.message,
        };
      }
      rateLimitRetries += 1;
      try {
        await options.sleep(RATE_LIMIT_COOLDOWN_MS, options.signal);
      } catch {
        return { outcome: "cancelled" };
      }
      continue;
    }
    if (failure.code === "SERVER_BUSY") {
      if (busyRetries >= MAX_SERVER_BUSY_RETRIES) {
        return {
          outcome: "failed",
          code: failure.code,
          message: failure.message,
        };
      }
      busyRetries += 1;
      try {
        await options.sleep(SERVER_BUSY_RETRY_MS, options.signal);
      } catch {
        return { outcome: "cancelled" };
      }
      continue;
    }

    return {
      outcome: "failed",
      code: failure.code,
      message: failure.message,
    };
  }
}

/** Run a whole batch. See the module comment for the invariants. */
export async function runBulkBatch({
  operation,
  files,
  caps,
  signal,
  onFileStatus,
  onProgress,
  initialBudgets,
  fetchImpl = fetch,
  sleep = defaultSleep,
}: RunBulkBatchOptions): Promise<BulkBatchRun> {
  const results = new Map<string, BulkFileResult>();
  const budgets: BulkBudgets = initialBudgets ?? {
    pagesUsed: 0,
    outputBytes: 0,
    imagesUsed: 0,
  };
  let stopReason: BulkStopReason | undefined;
  let lastStart = 0;
  let settled = 0;

  const emit = (result: BulkFileResult) => {
    results.set(result.id, result);
    onFileStatus?.(result);
  };

  const base = (entry: BulkFileEntry): BulkFileResult => ({
    id: entry.id,
    name: entry.file.name,
    size: entry.file.size,
    status: "queued",
  });

  for (const entry of files) {
    emit(base(entry));
  }

  for (const entry of files) {
    if (stopReason) {
      const current = results.get(entry.id);
      if (current && current.status === "queued") {
        emit({
          ...current,
          status: stopReason === "quota" ? "skipped-quota" : "cancelled",
        });
      }
      continue;
    }

    if (signal.aborted) {
      stopReason = "cancelled";
      const current = results.get(entry.id)!;
      emit({ ...current, status: "cancelled" });
      continue;
    }

    // Budget pre-checks — never schedule work the batch is not allowed to do.
    if (operation.pageBudget && budgets.pagesUsed >= caps.maxPagesPerBatch) {
      stopReason = "budget-pages";
      const current = results.get(entry.id)!;
      emit({ ...current, status: "skipped-budget" });
      continue;
    }
    if (budgets.outputBytes >= caps.maxOutputBytesPerBatch) {
      stopReason = "budget-output";
      const current = results.get(entry.id)!;
      emit({ ...current, status: "skipped-budget" });
      continue;
    }
    if (operation.imageBudget && budgets.imagesUsed >= caps.maxExtractedImagesPerBatch) {
      stopReason = "budget-images";
      const current = results.get(entry.id)!;
      emit({ ...current, status: "skipped-budget" });
      continue;
    }

    // Pacing: keep the batch under the per-IP rate limit even on fast failures.
    const waitFor = lastStart + BULK_REQUEST_PACING_MS - Date.now();
    if (waitFor > 0) {
      try {
        await sleep(waitFor, signal);
      } catch {
        stopReason = "cancelled";
        const current = results.get(entry.id)!;
        emit({ ...current, status: "cancelled" });
        continue;
      }
    }
    lastStart = Date.now();

    emit({ ...results.get(entry.id)!, status: "processing" });

    const outcome = await processOneFile(operation, entry, {
      signal,
      fetchImpl,
      sleep,
    });

    settled += 1;

    if (outcome.outcome === "succeeded") {
      budgets.outputBytes += outcome.blob.size;
      if (outcome.pages !== undefined) budgets.pagesUsed += outcome.pages;
      if (outcome.images !== undefined) budgets.imagesUsed += outcome.images;
      emit({
        ...results.get(entry.id)!,
        status: "succeeded",
        blob: outcome.blob,
        fileName: outcome.fileName,
        pages: outcome.pages,
        images: outcome.images,
      });
    } else if (outcome.outcome === "quota") {
      stopReason = "quota";
      emit({
        ...results.get(entry.id)!,
        status: "skipped-quota",
      });
    } else if (outcome.outcome === "service-unavailable") {
      stopReason = "service-unavailable";
      emit({
        ...results.get(entry.id)!,
        status: "failed",
        error: { code: "USAGE_SERVICE_UNAVAILABLE", message: outcome.message },
      });
    } else if (outcome.outcome === "cancelled") {
      stopReason = "cancelled";
      emit({ ...results.get(entry.id)!, status: "cancelled" });
    } else {
      emit({
        ...results.get(entry.id)!,
        status: "failed",
        error: { code: outcome.code, message: outcome.message },
      });
    }

    onProgress?.({ settled, total: files.length, ...budgets });
  }

  return {
    results: files.map((entry) => results.get(entry.id)!).filter(Boolean),
    stopReason,
    budgets,
  };
}
