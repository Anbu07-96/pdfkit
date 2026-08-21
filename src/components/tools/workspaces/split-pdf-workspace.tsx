"use client";

import {
  CheckCircle2,
  Download,
  FileText,
  Loader2,
  Scissors,
} from "lucide-react";
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
  runSplitPdf,
  type ProcessedDocument,
} from "@/lib/processing/client";
import {
  PAGE_RANGE_SYNTAX_HINT,
  parseAndValidatePageRanges,
  type PageSelectionMode,
} from "@/lib/processing/pages";
import { formatBytes } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

export interface SplitPdfWorkspaceProps {
  /** Server-configured limits, passed down so the UI matches the API exactly. */
  limits: {
    maxFileSize: number;
    maxOutputs: number;
  };
}

type Status = "idle" | "reading" | "ready" | "processing" | "success" | "error";

interface FailureState {
  message: string;
  details?: string[];
}

const MODES: { id: PageSelectionMode; title: string; description: string }[] = [
  {
    id: "every-page",
    title: "Split every page",
    description: "Each page becomes its own PDF.",
  },
  {
    id: "ranges",
    title: "Split by page ranges",
    description: "Each range you enter becomes a separate PDF.",
  },
];

/**
 * Split PDF workspace.
 *
 * Owns interaction state only. The page count comes from the server (never
 * guessed in the browser), range validation reuses the very same module the
 * processor uses, and the split itself happens server-side.
 */
export function SplitPdfWorkspace({ limits }: SplitPdfWorkspaceProps) {
  const [files, setFiles] = React.useState<SelectedFile[]>([]);
  const [pageCount, setPageCount] = React.useState<number | null>(null);
  const [mode, setMode] = React.useState<PageSelectionMode>("every-page");
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

  const rangeCheck = React.useMemo(() => {
    if (mode !== "ranges" || pageCount === null || ranges.trim() === "") return null;
    return parseAndValidatePageRanges(ranges, pageCount);
  }, [mode, ranges, pageCount]);

  const rangeError = rangeCheck && !rangeCheck.ok ? rangeCheck.issue.message : undefined;
  const plannedOutputs =
    pageCount === null
      ? 0
      : mode === "every-page"
        ? pageCount
        : rangeCheck?.ok
          ? rangeCheck.ranges.length
          : 0;
  const overOutputLimit = plannedOutputs > limits.maxOutputs;

  const busy = status === "processing";
  const canSplit =
    Boolean(file) &&
    pageCount !== null &&
    !busy &&
    status !== "reading" &&
    !overOutputLimit &&
    (mode === "every-page" || Boolean(rangeCheck?.ok));

  async function handleSplit() {
    if (!canSplit || !file) return;

    setResult(null);
    setFailure(null);
    setStatus("processing");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const document = await runSplitPdf({
        file: file.file,
        mode,
        ranges: mode === "ranges" ? ranges : undefined,
        signal: controller.signal,
      });
      setResult(document);
      setStatus("success");
      showToast({
        tone: "success",
        title: "Split complete",
        description: `${document.artifacts} ${
          document.artifacts === 1 ? "PDF is" : "PDFs are"
        } ready to download.`,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setStatus("ready");
        return;
      }
      setFailure(toFailure(error, "This PDF could not be split."));
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
          <span className="font-medium text-foreground">{file.name}</span>
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
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-medium text-foreground">
            How should this PDF be split?
          </legend>

          {MODES.map((option) => {
            const selected = mode === option.id;
            return (
              <label
                key={option.id}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors",
                  "focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring",
                  selected
                    ? "border-primary bg-primary-soft/40"
                    : "border-border bg-surface hover:border-border-strong",
                  busy && "pointer-events-none opacity-60",
                )}
              >
                <input
                  type="radio"
                  name="split-mode"
                  value={option.id}
                  checked={selected}
                  disabled={busy}
                  onChange={() => setMode(option.id)}
                  className="mt-1 size-4 accent-[var(--color-primary)] focus:outline-none"
                />
                <span>
                  <span className="block text-sm font-medium text-foreground">
                    {option.title}
                  </span>
                  <span className="block text-sm text-muted">{option.description}</span>
                  {option.id === "every-page" && selected ? (
                    <span className="mt-2 block text-sm text-muted">
                      This {pageCount}-page PDF will produce{" "}
                      <strong className="font-medium text-foreground">
                        {pageCount} {pageCount === 1 ? "PDF" : "PDFs"}
                      </strong>
                      . Maximum {limits.maxOutputs} output files.
                    </span>
                  ) : null}
                </span>
              </label>
            );
          })}

          {mode === "ranges" ? (
            <div className="ps-1">
              <Input
                label="Page ranges"
                placeholder="1-3, 4-6, 7-10"
                value={ranges}
                disabled={busy}
                onChange={(event) => setRanges(event.target.value)}
                hint={`${PAGE_RANGE_SYNTAX_HINT} This PDF has ${pageCount} ${
                  pageCount === 1 ? "page" : "pages"
                }.`}
                error={rangeError}
                inputMode="numeric"
                autoComplete="off"
              />
              {rangeCheck?.ok ? (
                <p className="mt-2 text-sm text-muted">
                  {rangeCheck.ranges.length}{" "}
                  {rangeCheck.ranges.length === 1 ? "PDF" : "PDFs"} will be created.
                </p>
              ) : null}
            </div>
          ) : null}

          {overOutputLimit ? (
            <ErrorState
              title="Too many output files"
              description={`This would create ${plannedOutputs} PDFs, above the limit of ${limits.maxOutputs}. Use page ranges, or a shorter document.`}
            />
          ) : null}
        </fieldset>
      ) : null}

      {status === "error" && failure ? (
        <ErrorState
          title="Split failed"
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
        <Button size="lg" onClick={handleSplit} disabled={!canSplit}>
          {busy ? (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <Scissors aria-hidden="true" className="size-4" />
          )}
          {busy ? "Splitting…" : "Split PDF"}
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
            ? "Splitting your PDF. This may take a moment."
            : status === "success" && result
              ? `Split complete. ${result.artifacts} ${
                  result.artifacts === 1 ? "PDF" : "PDFs"
                } ready to download.`
              : status === "error" && failure
                ? `Split failed. ${failure.message}`
                : status === "ready" && pageCount !== null
                  ? `PDF loaded with ${pageCount} pages.`
                  : ""}
      </p>

      {busy ? (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-surface p-4">
          <Loader2 aria-hidden="true" className="size-5 shrink-0 animate-spin text-primary" />
          <div>
            <p className="text-sm font-medium text-foreground">Splitting your PDF…</p>
            <p className="text-sm text-muted">
              Your file is processed on the server and discarded as soon as the results
              are returned.
            </p>
          </div>
        </div>
      ) : null}

      {status === "success" && result ? (
        <div className="rounded-xl border border-success/40 bg-success-soft/50 p-5">
          <div className="flex items-start gap-3">
            <CheckCircle2 aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-success" />
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-semibold text-foreground">
                Successfully created {result.artifacts}{" "}
                {result.artifacts === 1 ? "PDF" : "PDFs"}
              </h3>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
                <FileText aria-hidden="true" className="size-4" />
                <span className="font-medium text-foreground">{result.fileName}</span>
                <span>· {formatBytes(result.size)}</span>
                {result.isArchive ? <span>· ZIP archive</span> : null}
              </p>

              <div className="mt-4 flex flex-wrap gap-3">
                <a
                  href={result.url}
                  download={result.fileName}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:h-10"
                >
                  <Download aria-hidden="true" className="size-4" />
                  {result.isArchive ? "Download all (ZIP)" : "Download PDF"}
                </a>
                <Button variant="secondary" onClick={handleStartOver}>
                  Split another PDF
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
