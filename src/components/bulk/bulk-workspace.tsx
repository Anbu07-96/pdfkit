"use client";

import {
  AlertTriangle,
  CheckCircle2,
  CircleSlash,
  Download,
  FileArchive,
  Layers,
  Loader2,
  RefreshCw,
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
  type BulkFileResult,
  type BulkStopReason,
} from "@/lib/bulk/runner";
import { buildBatchZipBlob } from "@/lib/bulk/zip";
import {
  resolveBulkBatchCaps,
  type BulkBatchCaps,
  type BulkOperation,
} from "@/lib/tools/bulk";
import { formatBytes } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

/**
 * Bulk Tools workspace (Phase 61).
 *
 * One shared workspace for every bulk operation: select many files, watch each
 * file's status live, cancel, retry failures, download individual results or
 * everything as one ZIP — with the batch's quota needs shown up front.
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
  const [zipping, setZipping] = React.useState(false);
  const abortRef = React.useRef<AbortController | null>(null);
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

  const totalInputBytes = files.reduce((total, file) => total + file.size, 0);
  const succeeded = [...results.values()].filter((r) => r.status === "succeeded");
  const failed = [...results.values()].filter((r) => r.status === "failed");
  const skipped =
    [...results.values()].filter((r) => r.status === "skipped-quota" || r.status === "skipped-budget").length;
  const cancellable = [...results.values()].filter(
    (r) => r.status === "failed" || r.status === "skipped-quota" || r.status === "skipped-budget" || r.status === "cancelled",
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

    let refreshCounter = 0;
    const run = await runBulkBatch({
      operation,
      files: entries.map((entry) => ({ id: entry.id, file: entry.file })),
      caps,
      signal: controller.signal,
      initialBudgets,
      onFileStatus: (result) => {
        setResults((previous) => {
          const next = new Map(previous);
          next.set(result.id, result);
          return next;
        });
      },
      onProgress: (progress) => {
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
    setPhase("done");
    abortRef.current = null;
    void loadUsage();

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
    const retryEntries = files.filter(
      (file) => {
        const result = results.get(file.id);
        return (
          result !== undefined &&
          (result.status === "failed" ||
            result.status === "skipped-quota" ||
            result.status === "skipped-budget" ||
            result.status === "cancelled")
        );
      },
    );
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

  function handleStartOver() {
    abortRef.current?.abort();
    abortRef.current = null;
    setFiles([]);
    setResults(new Map());
    setBudgets({ pagesUsed: 0, outputBytes: 0, imagesUsed: 0 });
    sessionBudgetsRef.current = { pagesUsed: 0, outputBytes: 0, imagesUsed: 0 };
    setStopReason(null);
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

        {!running && (files.length > 0 || phase === "done") ? (
          <Button variant="ghost" size="lg" onClick={handleStartOver}>
            Start over
          </Button>
        ) : null}
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {running
          ? `Processing batch: ${succeeded.length + failed.length + skipped} of ${files.length} files settled.`
          : phase === "done"
            ? `Batch finished: ${succeeded.length} succeeded, ${failed.length} failed, ${skipped} skipped.`
            : ""}
      </p>

      {/* Stop reason */}
      {phase !== "running" && stopReason ? (
        <ErrorState
          title={STOP_REASONS[stopReason].title}
          description={STOP_REASONS[stopReason].description}
        />
      ) : null}

      {/* Batch progress + per-file list */}
      {results.size > 0 ? (
        <section aria-label="Batch progress" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-foreground">
              {succeeded.length} succeeded · {failed.length} failed · {skipped} skipped
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
                      {result.status === "failed" && result.error ? (
                        <>
                          <span>·</span>
                          <span className="text-error">{result.error.message}</span>
                        </>
                      ) : null}
                    </p>
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
