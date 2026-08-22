"use client";

import {
  CheckCircle2,
  Download,
  FileText,
  Images,
  Loader2,
} from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { UploadZone, type SelectedFile } from "@/components/upload/upload-zone";
import {
  ProcessingRequestError,
  runImagesToPdf,
  type ProcessedDocument,
} from "@/lib/processing/client";
import { formatBytes } from "@/lib/utils/format";

export interface ImagesToPdfWorkspaceProps {
  /** Server-configured limits, so the UI matches the API exactly. */
  limits: {
    maxFiles: number;
    maxFileSize: number;
  };
}

type Status = "idle" | "processing" | "success" | "error";

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
 * Images to PDF workspace.
 *
 * The UploadZone's orderable mode provides the ordering model (arrange, move,
 * remove) — the same one Merge PDF uses; this workspace only owns the
 * conversion call and result. Order is sent to the server exactly as shown.
 */
export function ImagesToPdfWorkspace({ limits }: ImagesToPdfWorkspaceProps) {
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

  React.useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  function handleFilesChange(next: SelectedFile[]) {
    setFiles(next);
    setResult(null);
    setFailure(null);
    setStatus("idle");
  }

  const busy = status === "processing";
  const canConvert = files.length > 0 && !busy;

  async function handleConvert() {
    if (!canConvert) return;

    setResult(null);
    setFailure(null);
    setStatus("processing");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const document = await runImagesToPdf({
        files: files.map((file) => file.file),
        signal: controller.signal,
      });
      setResult(document);
      setStatus("success");
      showToast({
        tone: "success",
        title: "PDF ready",
        description: `${files.length} ${files.length === 1 ? "image" : "images"} became a ${document.pages ?? files.length}-page PDF.`,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setStatus("idle");
        return;
      }
      setFailure(toFailure(error, "The images could not be converted."));
      setStatus("error");
    } finally {
      abortRef.current = null;
    }
  }

  function handleStartOver() {
    abortRef.current?.abort();
    setFiles([]);
    setResult(null);
    setFailure(null);
    setStatus("idle");
  }

  return (
    <div className="flex flex-col gap-5">
      <UploadZone
        label="Upload images"
        hint="Drag and drop JPG or PNG images here, or browse from your device."
        files={files}
        onFilesChange={handleFilesChange}
        multiple
        orderable
        busy={busy}
        extensions={[".jpg", ".jpeg", ".png"]}
        mimeTypes={["image/jpeg", "image/png"]}
        maxFiles={limits.maxFiles}
        maxFileSize={limits.maxFileSize}
      />

      {files.length > 0 ? (
        <p className="text-sm text-muted">
          <span className="font-medium text-foreground">
            {files.length} {files.length === 1 ? "image" : "images"}
          </span>{" "}
          will become a {files.length}-page PDF, in the order shown above.
        </p>
      ) : (
        <p className="text-sm text-muted">
          Upload one or more JPG or PNG images to get started.
        </p>
      )}

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
            <Images aria-hidden="true" className="size-4" />
          )}
          {busy ? "Creating your PDF…" : "Convert to PDF"}
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
            Clear images
          </Button>
        ) : null}
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {status === "processing"
          ? "Creating your PDF. This may take a moment."
          : status === "success" && result
            ? `PDF ready with ${result.pages ?? files.length} pages.`
            : status === "error" && failure
              ? `Conversion failed. ${failure.message}`
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
              Creating your PDF…
            </p>
            <p className="text-sm text-muted">
              Your images are processed on the server and discarded as soon as
              the result is returned. Cancelling stops the download; work that
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
                PDF created successfully
              </h3>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
                <FileText aria-hidden="true" className="size-4" />
                <span className="font-medium text-foreground">
                  {result.fileName}
                </span>
                <span>· {formatBytes(result.size)}</span>
                <span>
                  · {result.pages ?? files.length}{" "}
                  {(result.pages ?? files.length) === 1 ? "page" : "pages"}
                </span>
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
                  Convert another
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
