"use client";

import { CheckCircle2, Download, FileText, Loader2, Type } from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

type Status = "idle" | "reading" | "ready" | "processing" | "success" | "error";

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
 * PDF to Word workspace — text only, and it says so.
 *
 * The page count always comes from the server's inspect endpoint, and the
 * result always comes from the server's measured extraction. The tool never
 * implies layout, image or table reconstruction: the warning is shown before
 * the upload converts and repeated in the success state.
 */
export function PdfToWordWorkspace({ limits }: PdfToWordWorkspaceProps) {
  const [files, setFiles] = React.useState<SelectedFile[]>([]);
  const [pageCount, setPageCount] = React.useState<number | null>(null);
  const [status, setStatus] = React.useState<Status>("idle");
  const [result, setResult] = React.useState<ProcessedDocument | null>(null);
  const [failure, setFailure] = React.useState<FailureState | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);
  const { showToast } = useToast();

  const file = files[0] ?? null;

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
      const document = await runPdfToWord({
        file: file.file,
        signal: controller.signal,
      });
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
        overLimit ? (
          <ErrorState
            title="Too many pages to convert"
            description={`This PDF has ${pageCount} pages; Word export is limited to ${limits.maxPages}. Split the PDF first, then convert the parts.`}
          />
        ) : (
          <div className="rounded-xl border border-border bg-surface p-4">
            <h3 className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
              <Type aria-hidden="true" className="size-4" />
              Text only — read this first
            </h3>
            <p className="mt-2 text-sm text-muted">
              <span className="font-medium text-foreground">
                {pageCount} {pageCount === 1 ? "page" : "pages"}
              </span>{" "}
              will be converted to a Word document containing the text of each
              page, in order, one paragraph per line. Pages without extractable
              text are marked as such.
            </p>
            <p className="mt-2 text-sm text-muted">
              Formatting, images, tables and exact layout are{" "}
              <strong className="font-medium text-foreground">not preserved</strong>{" "}
              — this tool extracts text, it does not rebuild the document.
            </p>
          </div>
        )
      ) : null}

      {!file ? (
        <p className="text-sm text-muted">Upload a PDF to get started.</p>
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
        />
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button size="lg" onClick={handleConvert} disabled={!canConvert}>
          {busy ? (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <Type aria-hidden="true" className="size-4" />
          )}
          {busy ? "Converting to Word…" : "Convert to Word"}
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

      {busy ? (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-surface p-4">
          <Loader2
            aria-hidden="true"
            className="size-5 shrink-0 animate-spin text-primary"
          />
          <div>
            <p className="text-sm font-medium text-foreground">
              Converting to Word…
            </p>
            <p className="text-sm text-muted">
              Your file is processed on the server and discarded as soon as the
              result is returned. Cancelling stops the download; work that
              already started may finish on the server.
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

              <div className="mt-4 flex flex-wrap gap-3">
                <a
                  href={result.url}
                  download={result.fileName}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:h-10"
                >
                  <Download aria-hidden="true" className="size-4" />
                  Download Word document
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
