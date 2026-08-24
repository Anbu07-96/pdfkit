"use client";

import { CheckCircle2, Download, FileText, Loader2, Merge } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { UploadZone, type SelectedFile } from "@/components/upload/upload-zone";
import {
  ProcessingRequestError,
  runMergePdf,
  type ProcessedDocument,
} from "@/lib/processing/client";
import { formatBytes } from "@/lib/utils/format";

export interface MergePdfWorkspaceProps {
  /** Server-configured limits, passed down so the UI matches the API exactly. */
  limits: {
    minFiles: number;
    maxFiles: number;
    maxFileSize: number;
    maxTotalSize: number;
  };
}

type Status = "idle" | "processing" | "success" | "error";

interface FailureState {
  message: string;
  details?: string[];
}

/**
 * Merge PDF workspace.
 *
 * Owns only interaction state: which files are selected, in which order, and
 * what the current request is doing. All PDF work happens on the server — this
 * component talks to `runMergePdf()`, which calls the API route. No PDF library
 * is imported here.
 */
export function MergePdfWorkspace({ limits }: MergePdfWorkspaceProps) {
  const [files, setFiles] = React.useState<SelectedFile[]>([]);
  const [status, setStatus] = React.useState<Status>("idle");
  const [result, setResult] = React.useState<ProcessedDocument | null>(null);
  const [failure, setFailure] = React.useState<FailureState | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);
  const { showToast } = useToast();

  // Release each object URL as soon as it is replaced, and on unmount.
  React.useEffect(() => {
    if (!result) return;
    return () => URL.revokeObjectURL(result.url);
  }, [result]);

  // Never leave a request running after the page has gone.
  React.useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const totalSize = files.reduce((total, file) => total + file.size, 0);
  const enoughFiles = files.length >= limits.minFiles;
  const overTotalLimit = totalSize > limits.maxTotalSize;
  const busy = status === "processing";
  const canMerge = enoughFiles && !overTotalLimit && !busy;

  /** Drops the current result; the effect above revokes its object URL. */
  function discardResult() {
    setResult(null);
  }

  function handleFilesChange(next: SelectedFile[]) {
    setFiles(next);
    setFailure(null);
    if (status === "success") {
      discardResult();
      setStatus("idle");
    }
  }

  async function handleMerge() {
    if (!canMerge) return;

    discardResult();
    setFailure(null);
    setStatus("processing");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const document = await runMergePdf({
        files: files.map((file) => file.file),
        signal: controller.signal,
      });
      setResult(document);
      setStatus("success");
      showToast({
        tone: "success",
        title: "Merge complete",
        description: `${document.fileName} is ready to download.`,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setStatus("idle");
        return;
      }
      const processingError =
        error instanceof ProcessingRequestError
          ? error
          : new ProcessingRequestError(
              "INTERNAL_ERROR",
              "Something went wrong while merging your files.",
            );

      setFailure({
        message: processingError.message,
        details: processingError.details,
      });
      setStatus("error");
    } finally {
      abortRef.current = null;
    }
  }

  function handleStartOver() {
    abortRef.current?.abort();
    discardResult();
    setFiles([]);
    setFailure(null);
    setStatus("idle");
  }

  return (
    <div className="flex flex-col gap-5">
      <UploadZone
        label="Upload your PDF files"
        hint="Drag and drop your PDFs here, or browse from your device."
        files={files}
        onFilesChange={handleFilesChange}
        orderable
        busy={busy}
        extensions={[".pdf"]}
        mimeTypes={["application/pdf"]}
        maxFileSize={limits.maxFileSize}
        maxFiles={limits.maxFiles}
      />

      {files.length > 0 ? (
        <p className="text-sm text-muted">
          Total size: {formatBytes(totalSize)} of {formatBytes(limits.maxTotalSize, 0)}{" "}
          allowed.
        </p>
      ) : null}

      {overTotalLimit ? (
        <ErrorState
          title="These files are too large to merge together"
          description={`The combined size is ${formatBytes(totalSize)}, above the ${formatBytes(
            limits.maxTotalSize,
            0,
          )} limit. Remove a file and try again.`}
        />
      ) : null}

      {status === "error" && failure ? (
        <ErrorState
          title="Merge failed"
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
            <Button variant="secondary" size="sm" onClick={handleMerge} disabled={!canMerge}>
              Try again
            </Button>
          }
        />
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button size="lg" onClick={handleMerge} disabled={!canMerge}>
          {busy ? (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <Merge aria-hidden="true" className="size-4" />
          )}
          {busy ? "Merging…" : "Merge PDFs"}
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

        {files.length > 0 && !busy ? (
          <Button variant="ghost" size="lg" onClick={handleStartOver}>
            Start over
          </Button>
        ) : null}

        {!enoughFiles ? (
          <p className="text-sm text-muted">
            Add at least {limits.minFiles} PDF files to merge.
          </p>
        ) : null}
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {status === "processing"
          ? "Merging your PDF files. This may take a moment."
          : status === "success" && result
            ? `Merge complete. ${result.fileName} is ready to download.`
            : status === "error" && failure
              ? `Merge failed. ${failure.message}`
              : ""}
      </p>

      {busy ? (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-surface p-4">
          <Loader2 aria-hidden="true" className="size-5 shrink-0 animate-spin text-primary" />
          <div>
            <p className="text-sm font-medium text-foreground">
              Uploading and merging {files.length} PDFs…
            </p>
            <p className="text-sm text-muted">
              Your files are processed on the server and discarded as soon as the
              merged document is returned.
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
                Your merged PDF is ready
              </h3>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
                <FileText aria-hidden="true" className="size-4" />
                <span className="font-medium text-foreground">{result.fileName}</span>
                <span>· {formatBytes(result.size)}</span>
                {result.pages ? <span>· {result.pages} pages</span> : null}
              </p>

              <div className="mt-4 flex flex-wrap gap-3">
                <a
                  href={result.url}
                  download={result.fileName}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:h-10"
                >
                  <Download aria-hidden="true" className="size-4" />
                  Download merged PDF
                </a>
                <Button variant="secondary" onClick={handleStartOver}>
                  Merge different files
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
