"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileText,
  Layers,
  Loader2,
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
  runFlattenPdf,
  type ProcessedDocument,
} from "@/lib/processing/client";
import { formatBytes } from "@/lib/utils/format";

export interface FlattenPdfWorkspaceProps {
  /** Server-configured limits, so the UI matches the API exactly. */
  limits: { maxFileSize: number };
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
 * Flatten PDF workspace.
 *
 * Honesty is a first-class part of the flow, not fine print: before anything
 * is processed the user sees that flattening is irreversible, that text stays
 * selectable and links keep working, that document scripts are NOT removed,
 * and that signed PDFs are rejected. The success state reports the number of
 * fields the server actually flattened — never a client-side guess.
 */
export function FlattenPdfWorkspace({ limits }: FlattenPdfWorkspaceProps) {
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
  const canRun = Boolean(file) && pageCount !== null && !busy && status !== "error";

  async function handleFlatten() {
    if (!canRun || !file) return;

    setResult(null);
    setFailure(null);
    setStatus("processing");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const document = await runFlattenPdf({
        file: file.file,
        signal: controller.signal,
      });
      setResult(document);
      setStatus("success");
      showToast({
        tone: "success",
        title: "Form flattened",
        description: `${document.flattenedFields ?? 0} ${
          (document.flattenedFields ?? 0) === 1 ? "field" : "fields"
        } flattened into page content.`,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setStatus("ready");
        return;
      }
      setFailure(toFailure(error, "The PDF could not be flattened."));
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
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-warning/50 bg-warning-soft/40 p-4">
            <h3 className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
              <AlertTriangle aria-hidden="true" className="size-4 text-warning" />
              Flattening is permanent — form fields stop being editable
            </h3>
            <p className="mt-2 text-sm text-muted">
              Every form field&rsquo;s current value is drawn into the page as
              ordinary content and the interactive field is removed. This
              cannot be undone in the flattened file — keep your original if
              you may need to edit the form again.
            </p>
          </div>

          <div className="rounded-xl border border-border bg-surface p-4">
            <h3 className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
              <Layers aria-hidden="true" className="size-4 text-primary" />
              What flattening does — and what it does not do
            </h3>
            <ul className="mt-2 list-disc space-y-1 ps-5 text-sm text-muted">
              <li>
                Field values become permanent page content, drawn as vector
                text — pages are never turned into images, so{" "}
                <strong className="font-medium text-foreground">
                  text remains selectable
                </strong>{" "}
                and extractable.
              </li>
              <li>
                Links and other ordinary annotations{" "}
                <strong className="font-medium text-foreground">
                  remain clickable
                </strong>{" "}
                where the PDF has them. Page count, order and rotation are
                unchanged.
              </li>
              <li>
                <strong className="font-medium text-foreground">
                  Document scripts are NOT removed.
                </strong>{" "}
                Document-level JavaScript and open actions stay in the file —
                flattening is not a sanitisation or security feature.
              </li>
              <li>
                <strong className="font-medium text-foreground">
                  Signed PDFs are rejected.
                </strong>{" "}
                Flattening rewrites the file, which would invalidate a digital
                signature, so documents with signature fields are refused
                rather than silently broken.
              </li>
            </ul>
          </div>
        </div>
      ) : null}

      {status === "error" && failure ? (
        <ErrorState
          title="The PDF could not be flattened"
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
        <Button size="lg" onClick={handleFlatten} disabled={!canRun}>
          {busy ? (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <Layers aria-hidden="true" className="size-4" />
          )}
          {busy ? "Flattening…" : "Flatten PDF"}
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
          ? "Reading the PDF."
          : status === "processing"
            ? "Flattening the form fields. This may take a moment."
            : status === "success" && result
              ? `Form flattened and verified. ${result.flattenedFields ?? 0} ${
                  (result.flattenedFields ?? 0) === 1 ? "field" : "fields"
                } became permanent page content. The PDF is ready to download.`
              : status === "error" && failure
                ? `Flattening failed. ${failure.message}`
                : status === "ready" && pageCount !== null
                  ? `PDF loaded with ${pageCount} ${pageCount === 1 ? "page" : "pages"}. Ready to flatten.`
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
              Flattening form fields…
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
                Form flattened and verified
              </h3>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
                <FileText aria-hidden="true" className="size-4" />
                <span className="font-medium text-foreground">
                  {result.fileName}
                </span>
                <span>· {formatBytes(result.size)}</span>
                <span>
                  · {result.flattenedFields ?? 0}{" "}
                  {(result.flattenedFields ?? 0) === 1 ? "field" : "fields"}{" "}
                  flattened
                </span>
                <span>
                  · {result.pages ?? pageCount}{" "}
                  {(result.pages ?? pageCount) === 1 ? "page" : "pages"},{" "}
                  unchanged
                </span>
              </p>
              <p className="mt-2 text-sm text-muted">
                The result was verified by re-reading it: no form fields
                remain, and page count, order and rotation are unchanged. Field
                values are now ordinary selectable page content. Remember:
                document scripts were <strong>not</strong> removed, and
                flattening cannot be undone in this file.
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
                  Flatten another PDF
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
