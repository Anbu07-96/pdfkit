"use client";

import { CheckCircle2, Download, FileText, Loader2 } from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { UploadZone, type SelectedFile } from "@/components/upload/upload-zone";
import {
  inspectPdfFile,
  ProcessingRequestError,
  type ProcessedDocument,
} from "@/lib/processing/client";
import {
  parseAndValidatePageRanges,
  type PageRange,
} from "@/lib/processing/pages";
import { formatBytes } from "@/lib/utils/format";

/**
 * Shared workspace for the single-PDF, page-selection tools.
 *
 * Extract PDF Pages and Delete PDF Pages differ only in wording, in one extra
 * validation rule and in what they ask the server to do, so the upload →
 * inspect → validate → process → download flow lives here once. Both keep their
 * own thin component, and neither knows anything about pdf-lib.
 */
export interface PageSelectionWorkspaceProps {
  /** Server-configured limits, so the UI matches the API. */
  limits: { maxFileSize: number };
  labels: {
    /** Accessible label for the range field, e.g. "Pages to extract". */
    rangeLabel: string;
    rangePlaceholder: string;
    /** Helper text; the real page count is appended automatically. */
    rangeHelp: string;
    /** Primary button, e.g. "Extract Pages". */
    action: string;
    /** Shown while the request is running, e.g. "Extracting pages…". */
    processing: string;
    /** Reset button, e.g. "Extract another PDF". */
    reset: string;
    /** Toast + heading, e.g. "Successfully extracted 6 pages." */
    success: (outputPages: number) => string;
    /** Optional extra line under the success heading. */
    successDetail?: (outputPages: number, pageCount: number) => React.ReactNode;
  };
  /** Extra rule beyond syntax/bounds/overlap, e.g. "keep at least one page". */
  extraValidation?: (ranges: PageRange[], pageCount: number) => string | null;
  /** Live summary of a valid selection. */
  summary: (ranges: PageRange[], pageCount: number) => React.ReactNode;
  /** Performs the request. Provided by the tool's own workspace. */
  run: (options: {
    file: File;
    ranges: string;
    signal: AbortSignal;
  }) => Promise<ProcessedDocument>;
}

type Status = "idle" | "reading" | "ready" | "processing" | "success" | "error";

interface FailureState {
  message: string;
  details?: string[];
}

export function PageSelectionWorkspace({
  limits,
  labels,
  extraValidation,
  summary,
  run,
}: PageSelectionWorkspaceProps) {
  const [files, setFiles] = React.useState<SelectedFile[]>([]);
  const [pageCount, setPageCount] = React.useState<number | null>(null);
  const [ranges, setRanges] = React.useState("");
  const [status, setStatus] = React.useState<Status>("idle");
  const [result, setResult] = React.useState<ProcessedDocument | null>(null);
  const [failure, setFailure] = React.useState<FailureState | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);
  const { showToast } = useToast();

  const file = files[0] ?? null;

  // Release each object URL as soon as it is replaced, and on unmount.
  React.useEffect(() => {
    if (!result) return;
    return () => URL.revokeObjectURL(result.url);
  }, [result]);

  React.useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  /** Ask the server for the real page count whenever a document is chosen. */
  async function handleFilesChange(next: SelectedFile[]) {
    abortRef.current?.abort();
    abortRef.current = null;

    setFiles(next);
    setResult(null);
    setFailure(null);
    setPageCount(null);

    const chosen = next[0];
    if (!chosen) {
      setStatus("idle");
      return;
    }

    setStatus("reading");
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const inspection = await inspectPdfFile(chosen.file, controller.signal);
      setPageCount(inspection.pageCount);
      setStatus("ready");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setFailure(toFailure(error, "This PDF could not be read."));
      setStatus("error");
    } finally {
      abortRef.current = null;
    }
  }

  const selection = React.useMemo(() => {
    if (pageCount === null || ranges.trim() === "") return null;

    const parsed = parseAndValidatePageRanges(ranges, pageCount);
    if (!parsed.ok) return { ok: false as const, message: parsed.issue.message };

    const extra = extraValidation?.(parsed.ranges, pageCount);
    if (extra) return { ok: false as const, message: extra };

    return { ok: true as const, ranges: parsed.ranges };
  }, [ranges, pageCount, extraValidation]);

  const selectionError = selection && !selection.ok ? selection.message : undefined;
  const busy = status === "processing";
  const canRun =
    Boolean(file) && pageCount !== null && !busy && Boolean(selection?.ok);

  async function handleRun() {
    if (!canRun || !file) return;

    setResult(null);
    setFailure(null);
    setStatus("processing");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const document = await run({
        file: file.file,
        ranges,
        signal: controller.signal,
      });
      setResult(document);
      setStatus("success");
      showToast({
        tone: "success",
        title: labels.success(document.outputPages ?? 0),
        description: `${document.fileName} is ready to download.`,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setStatus("ready");
        return;
      }
      setFailure(toFailure(error, "This PDF could not be processed."));
      setStatus("error");
    } finally {
      abortRef.current = null;
    }
  }

  function handleStartOver() {
    abortRef.current?.abort();
    setFiles([]);
    setPageCount(null);
    setRanges("");
    setResult(null);
    setFailure(null);
    setStatus("idle");
  }

  return (
    <div className="flex flex-col gap-5">
      <UploadZone
        label="Upload a PDF"
        hint="Drag and drop a PDF here, or browse from your device."
        files={files}
        onFilesChange={handleFilesChange}
        multiple={false}
        maxFiles={1}
        busy={busy || status === "reading"}
        extensions={[".pdf"]}
        mimeTypes={["application/pdf"]}
        maxFileSize={limits.maxFileSize}
      />

      {file ? (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <FileText aria-hidden="true" className="size-4" />
          <span className="font-medium break-all text-foreground">{file.name}</span>
          <span>· {formatBytes(file.size)}</span>
          <span>·</span>
          {status === "reading" ? (
            <span className="inline-flex items-center gap-1.5">
              <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
              Reading PDF…
            </span>
          ) : pageCount !== null ? (
            <Badge tone="neutral">
              {pageCount} {pageCount === 1 ? "page" : "pages"}
            </Badge>
          ) : (
            <span>Page count unavailable</span>
          )}
        </div>
      ) : null}

      {file && pageCount !== null ? (
        <div>
          <Input
            label={labels.rangeLabel}
            placeholder={labels.rangePlaceholder}
            value={ranges}
            disabled={busy}
            onChange={(event) => setRanges(event.target.value)}
            hint={`${labels.rangeHelp} This PDF has ${pageCount} ${
              pageCount === 1 ? "page" : "pages"
            }.`}
            error={selectionError}
            inputMode="numeric"
            autoComplete="off"
          />
          {selection?.ok ? (
            <div className="mt-2 text-sm text-muted">
              {summary(selection.ranges, pageCount)}
            </div>
          ) : null}
        </div>
      ) : null}

      {status === "error" && failure ? (
        <ErrorState
          title="Something went wrong"
          description={
            <>
              <span>{failure.message}</span>
              {failure.details ? (
                <ul className="mt-2 list-disc space-y-1 ps-4">
                  {failure.details.map((detail) => (
                    <li key={detail}>{detail}</li>
                  ))}
                </ul>
              ) : null}
            </>
          }
        />
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button size="lg" onClick={handleRun} disabled={!canRun}>
          {busy ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
          {busy ? labels.processing : labels.action}
        </Button>

        {busy ? (
          <Button
            variant="secondary"
            size="lg"
            onClick={() => abortRef.current?.abort()}
          >
            Cancel
          </Button>
        ) : null}

        {file && !busy ? (
          <Button variant="ghost" size="lg" onClick={handleStartOver}>
            Start over
          </Button>
        ) : null}

        {!file ? (
          <p className="text-sm text-muted">Upload a PDF to get started.</p>
        ) : null}
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {status === "reading"
          ? "Reading the PDF to count its pages."
          : status === "processing"
            ? `${labels.processing} This may take a moment.`
            : status === "success" && result
              ? labels.success(result.outputPages ?? 0)
              : status === "error" && failure
                ? failure.message
                : status === "ready" && pageCount !== null
                  ? `PDF loaded with ${pageCount} pages.`
                  : ""}
      </p>

      {busy ? (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-surface p-4">
          <Loader2
            aria-hidden="true"
            className="size-5 shrink-0 animate-spin text-primary"
          />
          <div>
            <p className="text-sm font-medium text-foreground">{labels.processing}</p>
            <p className="text-sm text-muted">
              Your file is processed on the server and discarded as soon as the result
              is returned.
            </p>
          </div>
        </div>
      ) : null}

      {status === "success" && result ? (
        <div className="rounded-xl border border-success/40 bg-success-soft/50 p-5">
          <div className="flex items-start gap-3">
            <CheckCircle2
              aria-hidden="true"
              className="mt-0.5 size-5 shrink-0 text-success"
            />
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-semibold text-foreground">
                {labels.success(result.outputPages ?? 0)}
              </h3>
              {labels.successDetail && pageCount !== null ? (
                <p className="mt-1 text-sm text-muted">
                  {labels.successDetail(result.outputPages ?? 0, pageCount)}
                </p>
              ) : null}
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
                <FileText aria-hidden="true" className="size-4" />
                <span className="font-medium break-all text-foreground">
                  {result.fileName}
                </span>
                <span>· {formatBytes(result.size)}</span>
              </p>

              <div className="mt-4 flex flex-wrap gap-3">
                <a
                  href={result.url}
                  download={result.fileName}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:h-10"
                >
                  <Download aria-hidden="true" className="size-4" />
                  Download PDF
                </a>
                <Button variant="secondary" onClick={handleStartOver}>
                  {labels.reset}
                </Button>
              </div>

              <p className="mt-3 text-xs text-subtle">
                The download link points at the file in your browser&rsquo;s memory. It
                disappears when you leave or reload this page.
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function toFailure(error: unknown, fallback: string): FailureState {
  if (error instanceof ProcessingRequestError) {
    return { message: error.message, details: error.details };
  }
  return { message: fallback };
}
