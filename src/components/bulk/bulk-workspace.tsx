"use client";

import {
  AlertTriangle,
  CheckCircle2,
  CircleSlash,
  Download,
  FileArchive,
  FileSpreadsheet,
  Layers,
  Loader2,
  RefreshCw,
  WifiOff,
  XCircle,
} from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { UploadZone, type SelectedFile } from "@/components/upload/upload-zone";
import {
  runBulkBatch,
  type BulkBudgets,
  type BulkBatchPhase,
  type BulkFileResult,
  type BulkStopReason,
} from "@/lib/bulk/runner";
import { buildBatchZipBlob } from "@/lib/bulk/zip";
import { batchCsvFileName, buildBatchCsv } from "@/lib/bulk/csv";
import { sendBatchTelemetryBeacon } from "@/lib/bulk/telemetry-client";
import { classifyBulkError } from "@/lib/bulk/errors";
import {
  resolveBulkBatchCaps,
  type BulkBatchCaps,
  type BulkOperation,
} from "@/lib/tools/bulk";
import { formatBytes } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

/**
 * Bulk Tools workspace (Phases 61–62).
 *
 * One shared workspace for every bulk operation: select many files, watch each
 * file's status live (with honest, batch-level progress — the server does not
 * report intra-file progress, so none is invented), cancel, retry failures,
 * download individual results or everything as one ZIP, export a CSV summary,
 * and see exactly what the batch needs and what quota remains.
 *
 * Every file is sent to the existing single-file endpoint as its own request
 * (see `lib/bulk/runner.ts`), so quota metering, rate limiting and validation
 * apply per file exactly as they do in the single-file tools.
 */

export interface BulkWorkspaceProps {
  operation: BulkOperation;
  /** Server-configured per-file size limit, so the UI matches the API. */
  limits: { maxFileSize: number };
}

interface UsageSnapshot {
  tier: "anonymous" | "free" | "pro" | "business";
  jobsUsed: number;
  dailyJobLimit: number;
  jobsRemaining: number;
  bytesUsed: number;
  dailyByteLimit: number;
  bytesRemaining: number;
}

type Phase = "select" | "running" | "done";

const STOP_REASONS: Record<BulkStopReason, { title: string; description: string }> = {
  cancelled: {
    title: "Batch cancelled",
    description:
      "Completed results are kept below. The file that was in flight when you cancelled may still have finished on the server; its quota was only counted if it succeeded.",
  },
  quota: {
    title: "Daily quota reached",
    description:
      "The batch stopped because the daily quota for your plan is used up. Remaining files were skipped and can be retried after the quota resets (or after upgrading).",
  },
  "budget-pages": {
    title: "Page budget reached",
    description:
      "The batch stopped after rasterising the per-batch page limit. Retry the remaining files in a new batch.",
  },
  "budget-output": {
    title: "Output size budget reached",
    description:
      "The batch stopped because the results held in your browser reached the per-batch output limit. Download what you have, then run the rest in a new batch.",
  },
  "budget-images": {
    title: "Image budget reached",
    description:
      "The batch stopped after extracting the per-batch image limit. Retry the remaining files in a new batch.",
  },
  "service-unavailable": {
    title: "Usage service unavailable",
    description:
      "The batch stopped because the quota service could not be reached. Nothing was charged for the failed file; retry in a moment.",
  },
};

/** The most conservative caps, used until the real quota snapshot arrives. */
const FALLBACK_CAPS = resolveBulkBatchCaps("anonymous", 10, 50 * 1024 * 1024);

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${ms} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  if (minutes < 60) return `${minutes}m ${rest}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

async function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // Give the browser a tick to start the download before releasing the URL.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

function statusBadge(result: BulkFileResult): {
  tone: "neutral" | "success" | "danger" | "warning";
  label: string;
  icon: React.ReactNode;
} {
  switch (result.status) {
    case "succeeded":
      return {
        tone: "success",
        label: "Done",
        icon: <CheckCircle2 aria-hidden="true" className="size-3.5" />,
      };
    case "processing":
      return {
        tone: "neutral",
        label: "Processing…",
        icon: <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />,
      };
    case "failed":
      return {
        tone: "danger",
        label: "Failed",
        icon: <XCircle aria-hidden="true" className="size-3.5" />,
      };
    case "skipped-quota":
      return {
        tone: "warning",
        label: "Skipped — quota",
        icon: <CircleSlash aria-hidden="true" className="size-3.5" />,
      };
    case "skipped-budget":
      return {
        tone: "warning",
        label: "Skipped — batch budget",
        icon: <CircleSlash aria-hidden="true" className="size-3.5" />,
      };
    case "cancelled":
      return {
        tone: "neutral",
        label: "Cancelled",
        icon: <CircleSlash aria-hidden="true" className="size-3.5" />,
      };
    default:
      return {
        tone: "neutral",
        label: "Queued",
        icon: <Layers aria-hidden="true" className="size-3.5" />,
      };
  }
}

/** Honest, batch-level progress line for the current phase (Part 4). */
function progressLine(
  phase: BulkBatchPhase | null,
  counts: { settled: number; total: number },
): { icon: React.ReactNode; text: string } {
  if (phase?.kind === "waiting-online") {
    return {
      icon: <WifiOff aria-hidden="true" className="size-4 shrink-0" />,
      text: "You appear to be offline — the batch resumes automatically when the connection returns.",
    };
  }
  if (phase?.kind === "pacing") {
    return {
      icon: <Loader2 aria-hidden="true" className="size-4 shrink-0 animate-spin" />,
      text: "Waiting briefly before the next file, to stay under the request rate limit.",
    };
  }
  if (phase?.kind === "backoff") {
    const seconds = Math.max(1, Math.round(phase.waitMs / 1000));
    const reason =
      phase.reason === "rate-limit"
        ? `Rate limited by the server — retrying this file in ${seconds}s`
        : phase.reason === "server-busy"
          ? `Server busy — retrying this file in ${seconds}s`
          : `Connection problem — retrying this file in ${seconds}s`;
    return {
      icon: <Loader2 aria-hidden="true" className="size-4 shrink-0 animate-spin" />,
      text: `${reason}. The batch is paused, not lost.`,
    };
  }
  if (phase?.kind === "file-start") {
    const remaining = counts.total - counts.settled;
    return {
      icon: <Loader2 aria-hidden="true" className="size-4 shrink-0 animate-spin" />,
      text: `Processing file ${phase.index} of ${phase.total} · ${counts.settled} done · ${remaining} remaining`,
    };
  }
  return {
    icon: <Loader2 aria-hidden="true" className="size-4 shrink-0 animate-spin" />,
    text: `Preparing the batch… ${counts.settled} of ${counts.total} files processed`,
  };
}

export function BulkWorkspace({ operation, limits }: BulkWorkspaceProps) {
  const [files, setFiles] = React.useState<SelectedFile[]>([]);
  const [usage, setUsage] = React.useState<UsageSnapshot | null>(null);
  const [usageAvailable, setUsageAvailable] = React.useState(true);
  const [phase, setPhase] = React.useState<Phase>("select");
  const [results, setResults] = React.useState<Map<string, BulkFileResult>>(
    () => new Map(),
  );
  const [budgets, setBudgets] = React.useState<BulkBudgets>({
    pagesUsed: 0,
    outputBytes: 0,
    imagesUsed: 0,
  });
  const [stopReason, setStopReason] = React.useState<BulkStopReason | null>(null);
  const [batchPhase, setBatchPhase] = React.useState<BulkBatchPhase | null>(null);
  const [settled, setSettled] = React.useState(0);
  const [lastRun, setLastRun] = React.useState<{
    elapsedMs: number;
    batchId: string;
  } | null>(null);
  const [zipping, setZipping] = React.useState(false);
  const abortRef = React.useRef<AbortController | null>(null);
  const runningRef = React.useRef(false);
  const sessionBudgetsRef = React.useRef<BulkBudgets>({
    pagesUsed: 0,
    outputBytes: 0,
    imagesUsed: 0,
  });
  const { showToast } = useToast();

  const caps: BulkBatchCaps = React.useMemo(
    () =>
      usage
        ? resolveBulkBatchCaps(
            usage.tier,
            usage.dailyJobLimit,
            usage.dailyByteLimit,
          )
        : FALLBACK_CAPS,
    [usage],
  );

  const loadUsage = React.useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/usage", { signal, cache: "no-store" });
      if (!response.ok) throw new Error("usage unavailable");
      const summary = (await response.json()) as UsageSnapshot;
      setUsage(summary);
      setUsageAvailable(true);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setUsageAvailable(false);
    }
  }, []);

  React.useEffect(() => {
    // Initial quota snapshot. State is only set in fetch callbacks (never
    // synchronously in the effect body); a failed load falls back to the
    // conservative anonymous caps shown with a warning.
    const controller = new AbortController();
    fetch("/api/usage", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("usage unavailable");
        const summary = (await response.json()) as UsageSnapshot;
        setUsage(summary);
        setUsageAvailable(true);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setUsageAvailable(false);
      });
    return () => {
      controller.abort();
      abortRef.current?.abort();
    };
  }, []);

  // Guard against accidental refresh/navigation while a batch is running
  // (Phase 62, Part 6). Nothing is persisted, so a refresh would silently
  // discard the batch — prompting is the honest protection. It can never
  // cause duplicate processing: there is no stored state to replay.
  React.useEffect(() => {
    runningRef.current = phase === "running";
  }, [phase]);

  React.useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (!runningRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  const totalInputBytes = files.reduce((total, file) => total + file.size, 0);
  const settledResults = [...results.values()].filter(
    (result) =>
      result.status === "succeeded" ||
      result.status === "failed" ||
      result.status === "cancelled",
  );
  const succeeded = [...results.values()].filter((r) => r.status === "succeeded");
  const failed = [...results.values()].filter((r) => r.status === "failed");
  const cancelled = [...results.values()].filter((r) => r.status === "cancelled");
  const skipped = [...results.values()].filter(
    (r) => r.status === "skipped-quota" || r.status === "skipped-budget",
  );
  const cancellable = [...results.values()].filter(
    (r) =>
      r.status === "failed" ||
      r.status === "skipped-quota" ||
      r.status === "skipped-budget" ||
      r.status === "cancelled",
  );
  const running = phase === "running";

  const jobsNeeded = files.length;
  const quotaWarning =
    usage !== null &&
    (jobsNeeded > usage.jobsRemaining || totalInputBytes > usage.bytesRemaining);

  async function runBatch(entries: SelectedFile[], initialBudgets: BulkBudgets) {
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase("running");
    setStopReason(null);
    setBatchPhase(null);
    setSettled(0);

    // The batch id is generated here so the lifecycle telemetry beacons and
    // every per-file request header share one correlation id. It is metadata
    // for logs only — the server never trusts it for decisions.
    const batchId =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `b-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    sendBatchTelemetryBeacon({
      event: "batch_started",
      operation: operation.id,
      batchId,
      fileCount: entries.length,
    });

    let refreshCounter = 0;
    const run = await runBulkBatch({
      operation,
      files: entries.map((entry) => ({ id: entry.id, file: entry.file })),
      caps,
      signal: controller.signal,
      initialBudgets,
      batchId,
      onFileStatus: (result) => {
        setResults((previous) => {
          const next = new Map(previous);
          next.set(result.id, result);
          return next;
        });
      },
      onPhase: (nextPhase) => setBatchPhase(nextPhase),
      onProgress: (progress) => {
        setSettled(progress.settled);
        setBudgets({
          pagesUsed: progress.pagesUsed,
          outputBytes: progress.outputBytes,
          imagesUsed: progress.imagesUsed,
        });
        sessionBudgetsRef.current = {
          pagesUsed: progress.pagesUsed,
          outputBytes: progress.outputBytes,
          imagesUsed: progress.imagesUsed,
        };
        // Light usage refresh cadence: the server remains the source of truth
        // (a QUOTA_EXCEEDED response stops the batch), this only keeps the
        // display honest without adding a request per file.
        refreshCounter += 1;
        if (refreshCounter % 5 === 0) {
          void loadUsage();
        }
      },
    });

    sessionBudgetsRef.current = { ...run.budgets };
    setStopReason(run.stopReason ?? null);
    setLastRun({ elapsedMs: run.elapsedMs, batchId: run.batchId });
    setPhase("done");
    setBatchPhase(null);
    abortRef.current = null;
    void loadUsage();

    // One terminal lifecycle beacon (Phase 63): metadata only, fire-and-forget.
    if (!run.stopReason) {
      sendBatchTelemetryBeacon({
        event: "batch_completed",
        operation: operation.id,
        batchId: run.batchId,
        fileCount: run.results.length,
        succeeded: run.results.filter((r) => r.status === "succeeded").length,
        failed: run.results.filter((r) => r.status === "failed").length,
        skipped: run.results.filter(
          (r) => r.status === "skipped-quota" || r.status === "skipped-budget",
        ).length,
        cancelled: run.results.filter((r) => r.status === "cancelled").length,
        elapsedMs: run.elapsedMs,
      });
    } else if (run.stopReason === "quota") {
      sendBatchTelemetryBeacon({
        event: "batch_quota_stopped",
        operation: operation.id,
        batchId: run.batchId,
        settledFiles: run.results.filter(
          (r) => r.status !== "queued" && r.status !== "cancelled",
        ).length,
        totalFiles: run.results.length,
      });
    } else if (
      run.stopReason === "budget-pages" ||
      run.stopReason === "budget-output" ||
      run.stopReason === "budget-images"
    ) {
      sendBatchTelemetryBeacon({
        event: "batch_budget_stopped",
        operation: operation.id,
        batchId: run.batchId,
        settledFiles: run.results.filter((r) => r.status === "succeeded").length,
        totalFiles: run.results.length,
        reason: run.stopReason.replace("budget-", ""),
      });
    } else {
      // cancelled or service-unavailable
      sendBatchTelemetryBeacon({
        event: "batch_cancelled",
        operation: operation.id,
        batchId: run.batchId,
        settledFiles: run.results.filter((r) => r.status !== "queued").length,
        totalFiles: run.results.length,
      });
    }

    const okCount = run.results.filter((r) => r.status === "succeeded").length;
    const notOkCount = run.results.filter(
      (r) =>
        r.status === "failed" ||
        r.status === "skipped-quota" ||
        r.status === "skipped-budget",
    ).length;
    if (okCount > 0 && notOkCount === 0 && !run.stopReason) {
      showToast({
        tone: "success",
        title: "Batch complete",
        description: `${okCount} ${okCount === 1 ? "file was" : "files were"} processed successfully.`,
      });
    }
  }

  async function handleStart() {
    if (files.length === 0 || running) return;
    setResults(new Map());
    setBudgets({ pagesUsed: 0, outputBytes: 0, imagesUsed: 0 });
    sessionBudgetsRef.current = { pagesUsed: 0, outputBytes: 0, imagesUsed: 0 };
    await runBatch(files, { pagesUsed: 0, outputBytes: 0, imagesUsed: 0 });
  }

  async function handleRetry() {
    if (running) return;
    const retryEntries = files.filter((file) => {
      const result = results.get(file.id);
      return (
        result !== undefined &&
        (result.status === "failed" ||
          result.status === "skipped-quota" ||
          result.status === "skipped-budget" ||
          result.status === "cancelled")
      );
    });
    if (retryEntries.length === 0) return;
    // Keep successful results; retry only the unfinished ones, with the
    // session's budgets carried over so the browser-side caps stay honest.
    await runBatch(retryEntries, sessionBudgetsRef.current);
  }

  async function handleDownloadAll() {
    if (succeeded.length === 0 || zipping) return;
    setZipping(true);
    try {
      const { blob, fileName } = await buildBatchZipBlob(
        succeeded.map((result) => ({
          sourceName: result.name,
          resultName: result.fileName ?? result.name,
          blob: result.blob!,
        })),
        {
          flattenArchives: operation.outputKind === "archive",
          name: `${operation.id}-batch.zip`,
        },
      );
      await downloadBlob(blob, fileName);
    } catch {
      showToast({
        tone: "error",
        title: "ZIP could not be created",
        description: "Download the files individually instead.",
      });
    } finally {
      setZipping(false);
    }
  }

  function handleExportCsv() {
    const ordered = files
      .map((file) => results.get(file.id))
      .filter((result): result is BulkFileResult => Boolean(result));
    if (ordered.length === 0) return;

    const csv = buildBatchCsv({
      operation: operation.id,
      results: ordered,
    });
    // BOM so spreadsheet apps decode the UTF-8 filenames correctly.
    const blob = new Blob([`\uFEFF${csv}`], {
      type: "text/csv;charset=utf-8",
    });
    void downloadBlob(blob, batchCsvFileName(operation.id));
  }

  function handleStartOver() {
    abortRef.current?.abort();
    abortRef.current = null;
    setFiles([]);
    setResults(new Map());
    setBudgets({ pagesUsed: 0, outputBytes: 0, imagesUsed: 0 });
    sessionBudgetsRef.current = { pagesUsed: 0, outputBytes: 0, imagesUsed: 0 };
    setStopReason(null);
    setBatchPhase(null);
    setSettled(0);
    setLastRun(null);
    setPhase("select");
    void loadUsage();
  }

  const budgetNotes: string[] = [];
  if (operation.pageBudget) {
    budgetNotes.push(`${caps.maxPagesPerBatch} rendered pages per batch`);
  }
  if (operation.imageBudget) {
    budgetNotes.push(`${caps.maxExtractedImagesPerBatch} extracted images per batch`);
  }
  budgetNotes.push(`${formatBytes(caps.maxOutputBytesPerBatch, 0)} of results held per batch`);

  const completedDurations = succeeded
    .map((result) => result.durationMs)
    .filter((value): value is number => value !== undefined);
  const avgDurationMs =
    completedDurations.length > 0
      ? completedDurations.reduce((total, value) => total + value, 0) /
        completedDurations.length
      : undefined;
  const inputBytesProcessed = settledResults.reduce(
    (total, result) => total + result.size,
    0,
  );

  return (
    <div className="flex flex-col gap-5">
      <UploadZone
        label={`Upload your ${operation.supportedFileTypes.join(", ")} files`}
        hint="Drag and drop many files at once, or browse from your device."
        files={files}
        onFilesChange={(next) => {
          if (running) return;
          setFiles(next);
          setResults(new Map());
          setStopReason(null);
          setPhase("select");
          setLastRun(null);
        }}
        multiple
        maxFiles={caps.maxFilesPerBatch}
        maxFileSize={limits.maxFileSize}
        maxTotalSize={caps.maxTotalInputBytes}
        extensions={operation.supportedFileTypes}
        mimeTypes={operation.acceptedMimeTypes}
        busy={running}
      />

      {/* Quota + batch preflight panel */}
      <div className="rounded-xl border border-border bg-surface p-4 text-sm">
        <h3 className="font-medium text-foreground">Before you start</h3>
        <ul className="mt-2 flex flex-col gap-1.5 text-muted">
          <li>
            Each file is processed as its own job: this batch needs{" "}
            <strong className="font-medium text-foreground">
              {jobsNeeded} {jobsNeeded === 1 ? "job" : "jobs"}
            </strong>{" "}
            and{" "}
            <strong className="font-medium text-foreground">
              {formatBytes(totalInputBytes)}
            </strong>{" "}
            of your daily quota.
          </li>
          {usage ? (
            <li>
              Your plan ({usage.tier}) has{" "}
              <strong className="font-medium text-foreground">
                {usage.jobsRemaining} of {usage.dailyJobLimit} jobs
              </strong>{" "}
              and{" "}
              <strong className="font-medium text-foreground">
                {formatBytes(usage.bytesRemaining)} of{" "}
                {formatBytes(usage.dailyByteLimit, 0)}
              </strong>{" "}
              left today.
            </li>
          ) : (
            <li>
              {usageAvailable
                ? "Reading your current quota…"
                : "Quota information is unavailable right now — the batch will still stop safely if the server rejects a file."}
            </li>
          )}
          <li>
            Batch limits: up to {caps.maxFilesPerBatch} files and{" "}
            {formatBytes(caps.maxTotalInputBytes, 0)} of uploads per batch.
            {budgetNotes.length > 0 ? ` ${budgetNotes.join("; ")}.` : ""}
          </li>
          <li>Files are processed one at a time and never stored on the server.</li>
        </ul>
        {quotaWarning ? (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-soft/40 p-3 text-sm text-foreground">
            <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
            <p>
              This batch is larger than your remaining quota. It will stop when
              the daily limit is reached; the remaining files are marked as
              skipped and can be retried later.
            </p>
          </div>
        ) : null}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="lg"
          onClick={handleStart}
          disabled={files.length === 0 || running}
        >
          {running ? (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <Layers aria-hidden="true" className="size-4" />
          )}
          {running
            ? "Processing batch…"
            : `Process ${files.length} ${files.length === 1 ? "file" : "files"}`}
        </Button>

        {running ? (
          <Button variant="secondary" size="lg" onClick={() => abortRef.current?.abort()}>
            Cancel batch
          </Button>
        ) : null}

        {!running && phase === "done" && cancellable.length > 0 ? (
          <Button variant="secondary" size="lg" onClick={handleRetry}>
            <RefreshCw aria-hidden="true" className="size-4" />
            Retry {cancellable.length} unfinished
          </Button>
        ) : null}

        {!running && phase === "done" && succeeded.length > 0 ? (
          <Button variant="secondary" size="lg" onClick={handleDownloadAll} disabled={zipping}>
            {zipping ? (
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <FileArchive aria-hidden="true" className="size-4" />
            )}
            {zipping ? "Building ZIP…" : "Download all as ZIP"}
          </Button>
        ) : null}

        {!running && phase === "done" && results.size > 0 ? (
          <Button variant="secondary" size="lg" onClick={handleExportCsv}>
            <FileSpreadsheet aria-hidden="true" className="size-4" />
            Export results as CSV
          </Button>
        ) : null}

        {!running && (files.length > 0 || phase === "done") ? (
          <Button variant="ghost" size="lg" onClick={handleStartOver}>
            Start over
          </Button>
        ) : null}
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {running
          ? `Processing batch: ${settled} of ${files.length} files settled.`
          : phase === "done"
            ? `Batch finished: ${succeeded.length} succeeded, ${failed.length} failed, ${skipped.length} skipped.`
            : ""}
      </p>

      {/* Live batch progress (honest, batch-level only) */}
      {running && files.length > 0 ? (
        <div
          className="flex items-start gap-3 rounded-xl border border-border bg-surface p-4"
          data-testid="bulk-progress"
        >
          {progressLine(batchPhase, { settled, total: files.length }).icon}
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">
              {progressLine(batchPhase, { settled, total: files.length }).text}
            </p>
            <p className="mt-1 text-xs text-subtle">
              {settled} of {files.length} files processed
              {settled > 0
                ? ` (${Math.round((settled / files.length) * 100)}% of files)`
                : ""}
              {avgDurationMs !== undefined && settled < files.length
                ? ` · roughly ${formatDuration(
                    (avgDurationMs * (files.length - settled)) / 1,
                  )} remaining (estimate)`
                : ""}
              . Cancelling stops the next file; results already received are kept.
            </p>
          </div>
        </div>
      ) : null}

      {/* Stop reason */}
      {phase !== "running" && stopReason ? (
        <ErrorState
          title={STOP_REASONS[stopReason].title}
          description={STOP_REASONS[stopReason].description}
        />
      ) : null}

      {/* Batch completion summary (Part 1) */}
      {!running && phase === "done" && results.size > 0 ? (
        <div
          className="rounded-xl border border-border bg-surface p-4 text-sm"
          data-testid="bulk-summary"
        >
          <h3 className="font-medium text-foreground">Batch summary</h3>
          <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3 lg:grid-cols-4">
            <div>
              <dt className="text-xs text-subtle">Files</dt>
              <dd className="font-medium text-foreground">{results.size}</dd>
            </div>
            <div>
              <dt className="text-xs text-subtle">Completed</dt>
              <dd className="font-medium text-success">{succeeded.length}</dd>
            </div>
            <div>
              <dt className="text-xs text-subtle">Failed</dt>
              <dd className="font-medium text-danger">{failed.length}</dd>
            </div>
            <div>
              <dt className="text-xs text-subtle">Cancelled</dt>
              <dd className="font-medium text-foreground">{cancelled.length}</dd>
            </div>
            <div>
              <dt className="text-xs text-subtle">Skipped</dt>
              <dd className="font-medium text-foreground">{skipped.length}</dd>
            </div>
            <div>
              <dt className="text-xs text-subtle">Input processed</dt>
              <dd className="font-medium text-foreground">
                {formatBytes(inputBytesProcessed)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-subtle">Results held</dt>
              <dd className="font-medium text-foreground">
                {formatBytes(budgets.outputBytes)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-subtle">Elapsed</dt>
              <dd className="font-medium text-foreground">
                {lastRun ? formatDuration(lastRun.elapsedMs) : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-subtle">Avg per completed file</dt>
              <dd className="font-medium text-foreground">
                {avgDurationMs !== undefined ? formatDuration(avgDurationMs) : "—"}
              </dd>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <dt className="text-xs text-subtle">Quota left today</dt>
              <dd className="font-medium text-foreground">
                {usage
                  ? `${usage.jobsRemaining} of ${usage.dailyJobLimit} jobs · ${formatBytes(usage.bytesRemaining)}`
                  : "Unavailable"}
              </dd>
            </div>
          </dl>
          {lastRun ? (
            <p className="mt-3 text-xs text-subtle">
              Batch reference {lastRun.batchId} — included in server logs for
              diagnostics only; it contains no information about your files.
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Batch progress + per-file list */}
      {results.size > 0 ? (
        <section aria-label="Batch progress" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-foreground">
              {succeeded.length} succeeded · {failed.length} failed · {skipped.length} skipped
              {operation.pageBudget
                ? ` · ${budgets.pagesUsed}/${caps.maxPagesPerBatch} pages`
                : ""}
              {operation.imageBudget
                ? ` · ${budgets.imagesUsed}/${caps.maxExtractedImagesPerBatch} images`
                : ""}
            </p>
            <p className="text-xs text-subtle">
              {formatBytes(budgets.outputBytes)} of results in this browser
            </p>
          </div>

          <ul className="flex max-h-96 flex-col gap-2 overflow-y-auto">
            {[...results.values()].map((result) => {
              const badge = statusBadge(result);
              const classification =
                result.status === "failed"
                  ? classifyBulkError(result.error?.code)
                  : result.status === "cancelled"
                    ? null
                    : null;
              return (
                <li
                  key={result.id}
                  data-testid="bulk-file-row"
                  data-status={result.status}
                  className={cn(
                    "flex flex-col gap-2 rounded-xl border border-border bg-surface p-3",
                    "sm:flex-row sm:items-center sm:justify-between",
                  )}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground" title={result.name}>
                      {result.name}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
                      <span>{formatBytes(result.size)}</span>
                      {result.status === "succeeded" && result.blob ? (
                        <>
                          <span>·</span>
                          <span className="font-medium text-foreground">
                            {result.fileName}
                          </span>
                          <span>· {formatBytes(result.blob.size)}</span>
                          {result.pages !== undefined ? <span>· {result.pages} pages</span> : null}
                          {result.images !== undefined ? <span>· {result.images} images</span> : null}
                        </>
                      ) : null}
                      {result.durationMs !== undefined ? (
                        <span>· {formatDuration(result.durationMs)}</span>
                      ) : null}
                    </p>
                    {result.status === "failed" && result.error ? (
                      <p className="mt-1 text-xs text-muted">
                        <span className="font-medium text-danger">
                          {classification?.label ?? "Failed"}
                        </span>
                        <span className="text-subtle"> — </span>
                        <span className="text-error">{result.error.message}</span>
                        {classification && !classification.retryable ? (
                          <span className="text-subtle"> ({classification.retryHint})</span>
                        ) : null}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge tone={badge.tone}>
                      {badge.icon}
                      {badge.label}
                    </Badge>
                    {result.status === "succeeded" && result.blob ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() =>
                          void downloadBlob(result.blob!, result.fileName ?? result.name)
                        }
                      >
                        <Download aria-hidden="true" className="size-3.5" />
                        Download
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {phase === "running" ? (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-surface p-4">
          <Loader2 aria-hidden="true" className="size-5 shrink-0 animate-spin text-primary" />
          <div>
            <p className="text-sm font-medium text-foreground">
              Processing your batch, one file at a time
            </p>
            <p className="text-sm text-muted">
              Files are sent and processed one by one so the server stays stable
              for everyone. Cancelling stops the next file; the current file
              may still finish on the server.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
