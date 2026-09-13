"use client";

import { CheckCircle2, Download, FileText, Info, Type, X } from "lucide-react";
import * as React from "react";
import { JobProcessingVisual } from "@/components/jobs/job-processing-visual";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { UploadZone, type SelectedFile } from "@/components/upload/upload-zone";
import {
  inspectPdfFile,
  ProcessingRequestError,
  runPdfToWord,
  type ProcessedDocument,
} from "@/lib/processing/client";
import { formatBytes } from "@/lib/utils/format";

export interface PdfToWordWorkspaceProps {
  /** Server-configured limits, so the UI matches the API exactly. */
  limits: {
    maxFileSize: number;
    /** Maximum pages the export will process; above it the server declines. */
    maxPages: number;
  };
}

type Status =
  | "idle"
  | "reading"
  | "ready"
  | "processing"
  | "completing"
  | "success"
  | "error";

interface FailureState {
  message: string;
  details?: string[];
}

function toFailure(error: unknown, fallback: string): FailureState {
  if (error instanceof ProcessingRequestError) {
    return { message: error.message, details: error.details };
  }
  return { message: fallback };
}

/**
 * Phase 75D.4.2: how long the processing panel lingers in its success
 * state so the visual can play its settle beat before the result UI takes
 * over — kept short (the completion animation is 450 ms) so fast
 * conversions never feel delayed. Presentational only — the job itself is
 * already finished.
 */
const SUCCESS_SETTLE_MS = 450;

/** True when the user asked for reduced motion (the beat is then skipped). */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * PDF to Word workspace — Phase 75D.5 compact layout.
 *
 * The primary workflow (upload → select → convert → processing → result)
 * is designed to fit a laptop viewport without scrolling: a spacious upload
 * zone only while empty, a slim replace strip plus one premium file row
 * once a file is selected, the conversion caveat as a compact strip with an
 * expandable disclosure, and a processing/result region that always renders
 * in the same place so the user's eyes stay put.
 *
 * Honesty is unchanged from the earlier layouts: text-only extraction is
 * stated up front (now in the disclosure), the page count always comes from
 * the server's inspect endpoint, the result always comes from the server's
 * measured extraction, and the tool never implies layout, image or table
 * reconstruction.
 */
export function PdfToWordWorkspace({ limits }: PdfToWordWorkspaceProps) {
  const [files, setFiles] = React.useState<SelectedFile[]>([]);
  const [pageCount, setPageCount] = React.useState<number | null>(null);
  const [status, setStatus] = React.useState<Status>("idle");
  const [result, setResult] = React.useState<ProcessedDocument | null>(null);
  const [failure, setFailure] = React.useState<FailureState | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);
  const settleTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const { showToast } = useToast();

  const file = files[0] ?? null;

  React.useEffect(() => {
    if (!result) return;
    return () => URL.revokeObjectURL(result.url);
  }, [result]);

  function clearSettleTimer() {
    if (settleTimer.current !== null) {
      clearTimeout(settleTimer.current);
      settleTimer.current = null;
    }
  }

  React.useEffect(() => {
    return () => {
      abortRef.current?.abort();
      clearSettleTimer();
    };
  }, []);

  /** Ask the server for the real page count whenever a document is chosen. */
  async function handleFilesChange(next: SelectedFile[]) {
    abortRef.current?.abort();
    abortRef.current = null;
    clearSettleTimer();

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

  const busy = status === "processing";
  const settling = status === "completing";
  const working = busy || settling;
  const overLimit = pageCount !== null && pageCount > limits.maxPages;
  const canConvert =
    Boolean(file) && pageCount !== null && !working && !overLimit;
  // Note: an error status no longer blocks conversion here so the error
  // panel's "Try again" works; the primary button stays hidden in the
  // error state regardless.

  async function handleConvert() {
    if (!canConvert || !file) return;

    setResult(null);
    setFailure(null);
    setStatus("processing");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const document = await runPdfToWord({
        file: file.file,
        signal: controller.signal,
      });

      /** Show the result panel (and its toast) — now or after the beat. */
      const finish = () => {
        settleTimer.current = null;
        setResult(document);
        setStatus("success");
        const characters = document.extraction?.characters ?? 0;
        showToast({
          tone: "success",
          title: "Word document ready",
          description:
            characters === 0
              ? "No text was found in this PDF — the document may contain only images."
              : `${characters.toLocaleString()} characters of text extracted.`,
        });
      };

      if (prefersReducedMotion()) {
        finish();
        return;
      }

      // Hold the processing panel for a short success beat so the visual
      // can complete its transformation before the result UI takes over.
      setStatus("completing");
      settleTimer.current = setTimeout(finish, SUCCESS_SETTLE_MS);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setStatus("ready");
        return;
      }
      setFailure(toFailure(error, "This PDF could not be converted to Word."));
      setStatus("error");
    } finally {
      abortRef.current = null;
    }
  }

  function handleStartOver() {
    abortRef.current?.abort();
    clearSettleTimer();
    setFiles([]);
    setPageCount(null);
    setResult(null);
    setFailure(null);
    setStatus("idle");
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Selection: spacious while empty, a slim replace strip once a file
          is selected (the upload zone collapses itself — variant compact). */}
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
        variant="compact"
        showFileList={false}
      />

      {/* The selected file: one premium compact row — icon, name, size,
          server-verified page count, remove. The filename appears exactly
          once on the page. */}
      {file && !working ? (
        <div
          className="workspace-enter flex items-center gap-3 rounded-xl border border-border bg-surface p-3 shadow-xs"
          data-testid="selected-file-row"
        >
          <span
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-foreground"
          >
            <FileText className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">
              {file.name}
            </p>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
              <span>{formatBytes(file.size)}</span>
              {status === "reading" ? (
                <span>· Reading PDF…</span>
              ) : pageCount !== null ? (
                <>
                  <span>
                    ·{" "}
                    {pageCount === 1 ? "1 page" : `${pageCount} pages`}
                  </span>
                  {overLimit ? (
                    <Badge tone="warning">Over {limits.maxPages}-page limit</Badge>
                  ) : null}
                </>
              ) : (
                <span>· Page count unavailable</span>
              )}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleFilesChange([])}
            disabled={working}
          >
            <X aria-hidden="true" className="size-4" />
            Remove
          </Button>
        </div>
      ) : null}

      {/* Conversion caveat as a compact strip: the material limitation is
          always visible; the full explanation stays one disclosure away. */}
      {file && pageCount !== null && !working && status !== "error" ? (
        overLimit ? (
          <ErrorState
            title="Too many pages to convert"
            description={`This PDF has ${pageCount} pages; Word export is limited to ${limits.maxPages}. Split the PDF first, then convert the parts.`}
          />
        ) : (
          <div className="flex items-start gap-2.5 rounded-lg border border-border bg-surface-muted/40 px-3 py-2 text-sm">
            <Info
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-primary"
            />
            <p className="min-w-0 flex-1 text-muted">
              <span className="font-medium text-foreground">
                Text extraction
              </span>{" "}
              — formatting, images, tables and exact layout may not be
              preserved.
              <details className="mt-1 text-xs">
                <summary className="cursor-pointer font-medium text-primary marker:content-['']">
                  Details
                </summary>
                <p className="mt-1.5 leading-relaxed text-muted">
                  Your{" "}
                  <span className="font-medium text-foreground">
                    {pageCount === 1 ? "1 page" : `${pageCount} pages`}
                  </span>{" "}
                  become a Word document containing the text of each page, in
                  order, one paragraph per line. Pages without extractable
                  text are marked as such. This tool extracts text — it does
                  not rebuild the document.
                </p>
              </details>
            </p>
          </div>
        )
      ) : null}

      {status === "error" && failure ? (
        <ErrorState
          title="Conversion failed"
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
          action={
            file ? (
              <Button variant="secondary" size="sm" onClick={handleConvert}>
                Try again
              </Button>
            ) : undefined
          }
        />
      ) : null}

      {/* Primary action. */}
      {file && !working && status !== "error" ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button size="lg" onClick={handleConvert} disabled={!canConvert}>
            <Type aria-hidden="true" className="size-4" />
            Convert to Word
          </Button>
          <Button variant="ghost" size="lg" onClick={handleStartOver}>
            Start over
          </Button>
        </div>
      ) : null}

      <p role="status" aria-live="polite" className="sr-only">
        {status === "reading"
          ? "Reading the PDF to count its pages."
          : status === "completing"
            ? "Finishing up."
            : status === "processing"
              ? "Converting your PDF to a Word document. This may take a moment."
              : status === "success" && result
                ? `Word document ready. ${
                    result.extraction?.characters === 0
                      ? "No text was found — the PDF may contain only images."
                      : `${(result.extraction?.characters ?? 0).toLocaleString()} characters extracted.`
                  }`
                : status === "error" && failure
                  ? `Conversion failed. ${failure.message}`
                  : status === "ready" && pageCount !== null
                    ? `PDF loaded with ${pageCount} pages.`
                    : ""}
      </p>

      {/* Processing and result always render in this same region — the
          user's eyes stay in one place through convert → processing →
          complete → download. Setup UI above collapses while working. */}
      {working ? (
        <div className="workspace-enter flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-foreground">
              {settling ? "Finishing up…" : "Converting to Word"}
            </p>
            {file ? (
              <p className="min-w-0 truncate text-xs text-muted">{file.name}</p>
            ) : null}
            {busy ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => abortRef.current?.abort()}
              >
                Cancel
              </Button>
            ) : null}
          </div>

          {/* Phase 75D.5: the Document Intelligence Core — decorative,
              aria-hidden, wide and shallow. The job, its text and its
              status handling are unchanged; remove this element and the
              layer is gone. */}
          <JobProcessingVisual
            toolId="pdf-to-word"
            status={settling ? "success" : "processing"}
          />

          <p className="text-sm text-muted">
            {settling
              ? "Building your Word document."
              : "Analyzing document structure and extracting text."}
          </p>
          <p className="text-xs text-subtle">
            Processed on the server, in memory only, and discarded as soon as
            the result is returned. Cancelling stops the download; work that
            already started may finish on the server.
          </p>
        </div>
      ) : null}

      {status === "success" && result ? (
        <div className="workspace-enter rounded-xl border border-success/40 bg-success-soft/50 p-4">
          <div className="flex items-start gap-3">
            <CheckCircle2
              aria-hidden="true"
              className="mt-0.5 size-5 shrink-0 text-success"
            />
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-semibold text-foreground">
                {result.extraction?.characters === 0
                  ? "Word document created — no text found"
                  : "Word document ready"}
              </h3>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
                <FileText aria-hidden="true" className="size-4" />
                <span className="font-medium text-foreground">
                  {result.fileName}
                </span>
                <span>· {formatBytes(result.size)}</span>
                {result.extraction && result.extraction.characters > 0 ? (
                  <>
                    <span>
                      · {result.extraction.characters.toLocaleString()} characters
                    </span>
                    <span>· {result.extraction.paragraphs} paragraphs</span>
                  </>
                ) : null}
                <span>
                  · {result.pages ?? pageCount}{" "}
                  {(result.pages ?? pageCount) === 1 ? "page" : "pages"}
                </span>
              </p>
              <p className="mt-2 text-sm text-muted">
                {result.extraction?.characters === 0
                  ? "This PDF contains no extractable text — it may consist of images or scans. The document lists the pages that had none."
                  : "Text only — formatting, images, tables and exact layout are not preserved."}
              </p>

              <div className="mt-3 flex flex-wrap gap-3">
                <ButtonLink
                  href={result.url}
                  download={result.fileName}
                  size="lg"
                  className="workspace-enter"
                >
                  <Download aria-hidden="true" className="size-4" />
                  Download Word document
                </ButtonLink>
                <Button variant="secondary" onClick={handleStartOver}>
                  Convert another PDF
                </Button>
              </div>

              <p className="mt-2.5 text-xs text-subtle">
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
