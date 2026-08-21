"use client";

import {
  CheckCircle2,
  Download,
  FileText,
  Loader2,
  Minimize2,
} from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { UploadZone, type SelectedFile } from "@/components/upload/upload-zone";
import {
  inspectPdfFile,
  ProcessingRequestError,
  runCompressPdf,
  type CompressionSummary,
  type ProcessedDocument,
} from "@/lib/processing/client";
import type { CompressionLevel } from "@/lib/processing/compression";
import { formatBytes } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

export interface CompressPdfWorkspaceProps {
  /** Server-configured limits, so the UI matches the API exactly. */
  limits: {
    maxFileSize: number;
    /** Above this page count, `high` stays lossless instead of rasterising. */
    maxRasterPages: number;
  };
}

type Status = "idle" | "reading" | "ready" | "processing" | "success" | "error";

interface FailureState {
  message: string;
  details?: string[];
}

interface LevelOption {
  id: CompressionLevel;
  title: string;
  summary: string;
  description: string;
}

/**
 * The levels say exactly what the server does — no invented claims:
 * - low/medium are lossless (structure, and stream re-compression),
 * - high may rasterise pages: smaller files, but lower image quality and text
 *   that is no longer selectable. It is only attempted when it can help.
 */
const LEVELS: LevelOption[] = [
  {
    id: "low",
    title: "Low",
    summary: "Best quality · smaller reduction",
    description:
      "Lossless: rebuilds the file structure and removes metadata. Fastest, and often a large win on files saved inefficiently.",
  },
  {
    id: "medium",
    title: "Medium",
    summary: "Balanced · recommended",
    description:
      "Lossless: everything in Low, plus internal streams are re-compressed with maximum effort. Quality never changes.",
  },
  {
    id: "high",
    title: "High",
    summary: "Maximum reduction · may reduce image quality",
    description:
      "Also tries rasterising pages to compressed images. Image-heavy and scanned PDFs shrink the most; text becomes pixels and is no longer selectable. Only kept when it is genuinely smaller.",
  },
];

function toFailure(error: unknown, fallback: string): FailureState {
  if (error instanceof ProcessingRequestError) {
    return { message: error.message, details: error.details };
  }
  return { message: fallback };
}

/**
 * Compress PDF workspace.
 *
 * Interaction state only: the level is sent to the server, which validates it
 * again, and every number shown in the result comes from the response — the
 * browser never measures or guesses the savings itself.
 */
export function CompressPdfWorkspace({ limits }: CompressPdfWorkspaceProps) {
  const [files, setFiles] = React.useState<SelectedFile[]>([]);
  const [pageCount, setPageCount] = React.useState<number | null>(null);
  const [level, setLevel] = React.useState<CompressionLevel>("medium");
  const [status, setStatus] = React.useState<Status>("idle");
  const [result, setResult] = React.useState<ProcessedDocument | null>(null);
  const [stats, setStats] = React.useState<CompressionSummary | null>(null);
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
    setStats(null);
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

  const busy = status === "processing";
  const canCompress =
    Boolean(file) && !busy && status !== "reading" && status !== "error";

  async function handleCompress() {
    if (!canCompress || !file) return;

    setResult(null);
    setStats(null);
    setFailure(null);
    setStatus("processing");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const document = await runCompressPdf({
        file: file.file,
        level,
        signal: controller.signal,
      });
      setResult(document);
      setStats(document.compression ?? null);
      setStatus("success");
      if (document.compression?.wasReduced) {
        showToast({
          tone: "success",
          title: "Compression complete",
          description: `Reduced by ${document.compression.reductionPercent}%.`,
        });
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setStatus("ready");
        return;
      }
      setFailure(toFailure(error, "This PDF could not be compressed."));
      setStatus("error");
    } finally {
      abortRef.current = null;
    }
  }

  function handleStartOver() {
    abortRef.current?.abort();
    setFiles([]);
    setPageCount(null);
    setResult(null);
    setStats(null);
    setFailure(null);
    setStatus("idle");
  }

  // Server-answered question: did the bytes actually shrink?
  const reduced = stats?.wasReduced === true;

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

      {file ? (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-medium text-foreground">
            How strongly should this PDF be compressed?
          </legend>

          {LEVELS.map((option) => {
            const selected = level === option.id;
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
                  name="compression-level"
                  value={option.id}
                  checked={selected}
                  disabled={busy}
                  onChange={() => setLevel(option.id)}
                  className="mt-1 size-4 accent-[var(--color-primary)] focus:outline-none"
                />
                <span>
                  <span className="block text-sm font-medium text-foreground">
                    {option.title}
                    <span className="ms-2 text-xs font-normal text-muted">
                      {option.summary}
                    </span>
                  </span>
                  <span className="mt-1 block text-sm text-muted">
                    {option.description}
                  </span>
                </span>
              </label>
            );
          })}

          <p className="text-sm text-muted">
            Lower compression keeps quality and reduces less; higher compression
            produces smaller files and, at high, may reduce image quality.
            Documents over {limits.maxRasterPages} pages are always compressed
            losslessly, even at high.
          </p>
        </fieldset>
      ) : null}

      {status === "error" && failure ? (
        <ErrorState
          title="Compression failed"
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
        <Button size="lg" onClick={handleCompress} disabled={!canCompress}>
          {busy ? (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <Minimize2 aria-hidden="true" className="size-4" />
          )}
          {busy ? "Compressing…" : "Compress PDF"}
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
            ? "Compressing your PDF. This may take a moment."
            : status === "success" && stats
              ? reduced
                ? `Compression complete. Size reduced from ${formatBytes(
                    stats.originalBytes,
                  )} to ${formatBytes(stats.outputBytes)}, saving ${formatBytes(
                    stats.bytesSaved,
                  )} — ${stats.reductionPercent} percent smaller.`
                : "This PDF could not be reduced further."
              : status === "error" && failure
                ? `Compression failed. ${failure.message}`
                : status === "ready"
                  ? "PDF loaded. Choose a compression level."
                  : ""}
      </p>

      {busy ? (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-surface p-4">
          <Loader2
            aria-hidden="true"
            className="size-5 shrink-0 animate-spin text-primary"
          />
          <div>
            <p className="text-sm font-medium text-foreground">
              Compressing your PDF…
            </p>
            <p className="text-sm text-muted">
              Your file is processed on the server and discarded as soon as the
              result is returned. Cancelling stops the download; work that
              already started may finish on the server.
            </p>
          </div>
        </div>
      ) : null}

      {status === "success" && result && stats ? (
        <div
          className={cn(
            "rounded-xl border p-5",
            reduced
              ? "border-success/40 bg-success-soft/50"
              : "border-border bg-surface",
          )}
        >
          <div className="flex items-start gap-3">
            {reduced ? (
              <CheckCircle2
                aria-hidden="true"
                className="mt-0.5 size-5 shrink-0 text-success"
              />
            ) : (
              <FileText
                aria-hidden="true"
                className="mt-0.5 size-5 shrink-0 text-muted"
              />
            )}
            <div className="min-w-0 flex-1">
              {reduced ? (
                <h3 className="text-base font-semibold text-foreground">
                  PDF compressed successfully
                </h3>
              ) : (
                <h3 className="text-base font-semibold text-foreground">
                  This PDF is already well optimised
                </h3>
              )}

              {reduced ? (
                <p className="mt-1 text-sm text-muted">
                  {stats.strategy === "rasterized"
                    ? "Pages were rasterised to compressed images, which reduces image quality and makes text non-selectable."
                    : "The file was rebuilt losslessly — content and quality are unchanged."}
                </p>
              ) : (
                <p className="mt-1 text-sm text-muted">
                  Compression could not make this file smaller. The original,
                  unchanged PDF is available to download.
                </p>
              )}

              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-muted">Original size</dt>
                  <dd className="font-medium text-foreground">
                    {formatBytes(stats.originalBytes)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted">
                    {reduced ? "Compressed size" : "Output size"}
                  </dt>
                  <dd className="font-medium text-foreground">
                    {formatBytes(stats.outputBytes)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted">Saved</dt>
                  <dd className="font-medium text-foreground">
                    {reduced ? formatBytes(stats.bytesSaved) : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted">Reduction</dt>
                  <dd className="font-medium text-foreground">
                    {reduced ? `${stats.reductionPercent}%` : "—"}
                  </dd>
                </div>
              </dl>

              <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
                <FileText aria-hidden="true" className="size-4" />
                <span className="font-medium text-foreground">
                  {result.fileName}
                </span>
                <span>· {formatBytes(result.size)}</span>
                <span>· Level: {stats.compressionLevel}</span>
              </p>

              <div className="mt-4 flex flex-wrap gap-3">
                <a
                  href={result.url}
                  download={result.fileName}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:h-10"
                >
                  <Download aria-hidden="true" className="size-4" />
                  {reduced ? "Download compressed PDF" : "Download PDF"}
                </a>
                <Button variant="secondary" onClick={handleStartOver}>
                  Compress another PDF
                </Button>
              </div>

              <p className="mt-3 text-xs text-subtle">
                The download link points at the file in your browser&rsquo;s
                memory. It disappears when you leave or reload this page.
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
