"use client";

import { CheckCircle2, Download, FileText, Loader2 } from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { UploadZone, type SelectedFile } from "@/components/upload/upload-zone";
import {
  inspectPdfFile,
  ProcessingRequestError,
  runPdfToJpg,
  runPdfToPng,
  type ProcessedDocument,
} from "@/lib/processing/client";
import { formatBytes } from "@/lib/utils/format";

export interface PdfToImageWorkspaceProps {
  /** Which image format this instance converts to. */
  format: "jpg" | "png";
  /** Server-configured limits, so the UI matches the API exactly. */
  limits: {
    maxFileSize: number;
    /** Maximum pages the export will render; above it the server declines. */
    maxPages: number;
  };
}

type Status = "idle" | "reading" | "ready" | "processing" | "success" | "error";

interface FailureState {
  message: string;
  details?: string[];
}

const FORMATS = {
  jpg: {
    label: "JPG",
    run: runPdfToJpg,
    fileWord: "JPG file",
    filesWord: "JPG files",
  },
  png: {
    label: "PNG",
    run: runPdfToPng,
    fileWord: "PNG file",
    filesWord: "PNG files",
  },
} as const;

function toFailure(error: unknown, fallback: string): FailureState {
  if (error instanceof ProcessingRequestError) {
    return { message: error.message, details: error.details };
  }
  return { message: fallback };
}

/**
 * Shared PDF → image workspace (PDF to JPG and PDF to PNG).
 *
 * The page count always comes from the server's inspect endpoint — never
 * guessed in the browser — and the export itself happens server-side with
 * pdfium. Previews are deliberately not part of the flow: they are a nice-to-
 * have of other tools, never a blocker for conversion.
 */
export function PdfToImageWorkspace({
  format,
  limits,
}: PdfToImageWorkspaceProps) {
  const profile = FORMATS[format];
  const [files, setFiles] = React.useState<SelectedFile[]>([]);
  const [pageCount, setPageCount] = React.useState<number | null>(null);
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

  const busy = status === "processing";
  const overLimit = pageCount !== null && pageCount > limits.maxPages;
  const canConvert =
    Boolean(file) && pageCount !== null && !busy && status !== "error" && !overLimit;

  async function handleConvert() {
    if (!canConvert || !file) return;

    setResult(null);
    setFailure(null);
    setStatus("processing");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const document = await profile.run({ file: file.file, signal: controller.signal });
      setResult(document);
      setStatus("success");
      showToast({
        tone: "success",
        title: "Export ready",
        description: `${document.artifacts} ${document.artifacts === 1 ? profile.fileWord : profile.filesWord} ready to download.`,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setStatus("ready");
        return;
      }
      setFailure(toFailure(error, `This PDF could not be exported to ${profile.label}.`));
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
        overLimit ? (
          <ErrorState
            title="Too many pages to export"
            description={`This PDF has ${pageCount} pages; image export is limited to ${limits.maxPages}. Split the PDF first, then export the parts.`}
          />
        ) : (
          <p className="text-sm text-muted">
            <span className="font-medium text-foreground">
              {pageCount} {pageCount === 1 ? "page" : "pages"}
            </span>{" "}
            will produce {pageCount === 1 ? `one ${profile.label} file` : `${pageCount} ${profile.filesWord}`}.
          </p>
        )
      ) : null}

      {!file ? (
        <p className="text-sm text-muted">Upload a PDF to get started.</p>
      ) : null}

      {status === "error" && failure ? (
        <ErrorState
          title="Export failed"
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
        <Button size="lg" onClick={handleConvert} disabled={!canConvert}>
          {busy ? (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <Download aria-hidden="true" className="size-4" />
          )}
          {busy ? "Rendering your PDF…" : `Convert to ${profile.label}`}
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
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {status === "reading"
          ? "Reading the PDF to count its pages."
          : status === "processing"
            ? "Rendering your PDF. This may take a moment."
            : status === "success" && result
              ? `Export ready. ${result.artifacts} ${result.artifacts === 1 ? profile.fileWord : profile.filesWord} ready to download.`
              : status === "error" && failure
                ? `Export failed. ${failure.message}`
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
            <p className="text-sm font-medium text-foreground">
              Rendering your PDF…
            </p>
            <p className="text-sm text-muted">
              Each page is rendered on the server at the configured export
              resolution and discarded as soon as the result is returned.
              Cancelling stops the download; work that already started may
              finish on the server.
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
                {result.artifacts}{" "}
                {result.artifacts === 1 ? profile.fileWord : profile.filesWord}{" "}
                created
              </h3>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
                <FileText aria-hidden="true" className="size-4" />
                <span className="font-medium text-foreground">
                  {result.fileName}
                </span>
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
                  {result.isArchive
                    ? `Download all (${profile.label}s, ZIP)`
                    : `Download ${profile.label}`}
                </a>
                <Button variant="secondary" onClick={handleStartOver}>
                  Convert another PDF
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
