"use client";

import { CheckCircle2, Download, FileText, Loader2, ShieldCheck } from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { UploadZone, type SelectedFile } from "@/components/upload/upload-zone";
import {
  inspectPdfFile,
  ProcessingRequestError,
  runRemoveMetadata,
  type DocumentMetadata,
  type ProcessedDocument,
} from "@/lib/processing/client";
import { formatMetadataDate } from "@/lib/processing/metadata";
import { formatBytes } from "@/lib/utils/format";

export interface RemoveMetadataWorkspaceProps {
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

/** The five Info fields this tool removes, with display names. */
const TARGET_FIELDS: { key: keyof DocumentMetadata; label: string }[] = [
  { key: "title", label: "Title" },
  { key: "author", label: "Author" },
  { key: "subject", label: "Subject" },
  { key: "keywords", label: "Keywords" },
  { key: "creator", label: "Creator" },
];

/**
 * Remove Metadata workspace.
 *
 * Detection always comes from the server's inspection, and the result always
 * comes from the server's verified removal — the browser reports nothing it
 * was not told. Producer and timestamps are explicitly called out as remaining,
 * because the saving library re-stamps them on every write.
 */
export function RemoveMetadataWorkspace({ limits }: RemoveMetadataWorkspaceProps) {
  const [files, setFiles] = React.useState<SelectedFile[]>([]);
  const [pageCount, setPageCount] = React.useState<number | null>(null);
  const [metadata, setMetadata] = React.useState<DocumentMetadata | null>(null);
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

  /** Read the document's real page count and metadata from the server. */
  async function handleFilesChange(next: SelectedFile[]) {
    abortRef.current?.abort();
    abortRef.current = null;

    setFiles(next);
    setResult(null);
    setFailure(null);
    setPageCount(null);
    setMetadata(null);

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
      setMetadata(inspection.metadata);
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
  const foundCount = metadata
    ? TARGET_FIELDS.filter(({ key }) => metadata[key] !== null).length
    : 0;

  async function handleRemove() {
    if (!file || busy || metadata === null) return;

    setResult(null);
    setFailure(null);
    setStatus("processing");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const document = await runRemoveMetadata({
        file: file.file,
        signal: controller.signal,
      });
      setResult(document);
      setStatus("success");
      showToast({
        tone: "success",
        title: "Metadata removed",
        description: `${document.fileName} is ready to download.`,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setStatus("ready");
        return;
      }
      setFailure(toFailure(error, "The metadata could not be removed."));
      setStatus("error");
    } finally {
      abortRef.current = null;
    }
  }

  function handleStartOver() {
    abortRef.current?.abort();
    setFiles([]);
    setPageCount(null);
    setMetadata(null);
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

      {file && metadata ? (
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-border bg-surface p-4">
            <h3 className="text-sm font-medium text-foreground">
              Metadata found in this document
            </h3>
            <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              {TARGET_FIELDS.map(({ key, label }) => {
                const value = metadata[key];
                return (
                  <div key={key}>
                    <dt className="text-muted">{label}</dt>
                    <dd className="break-all text-foreground">
                      {value === null
                        ? "—"
                        : key === "keywords"
                          ? (value as string[]).join(", ") || "—"
                          : (value as string)}
                    </dd>
                  </div>
                );
              })}
              <div>
                <dt className="text-muted">XMP metadata</dt>
                <dd className="text-foreground">
                  {metadata.xmpPresent ? "Present" : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-muted">Producer</dt>
                <dd className="break-all text-foreground">
                  {metadata.producer ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-muted">Creation date</dt>
                <dd className="text-foreground">
                  {formatMetadataDate(metadata.creationDate)}
                </dd>
              </div>
              <div>
                <dt className="text-muted">Modification date</dt>
                <dd className="text-foreground">
                  {formatMetadataDate(metadata.modificationDate)}
                </dd>
              </div>
            </dl>
          </div>

          <div className="rounded-xl border border-border bg-surface p-4">
            <h3 className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
              <ShieldCheck aria-hidden="true" className="size-4" />
              What removing does
            </h3>
            <p className="mt-2 text-sm text-muted">
              Title, author, subject, keywords and creator{" "}
              {foundCount > 0
                ? `— ${foundCount} of the 5 fields contain data here —`
                : "— none of these fields contain data in this document —"}{" "}
              and the XMP metadata stream
              {metadata.xmpPresent ? "" : " (none present)"} will be removed, and
              the removal is verified by re-reading the result. Every page,
              its order and its content stay exactly as they are.
            </p>
            <p className="mt-2 text-sm text-muted">
              Two library limits, stated plainly: the creator field is emptied
              rather than deleted (the saving library re-inserts its own text
              when the field is missing), and the producer string plus the
              modification timestamp are rewritten on save and cannot be
              removed — this document will not be completely metadata-free.
            </p>
          </div>
        </div>
      ) : null}

      {status === "error" && failure ? (
        <ErrorState
          title="Metadata could not be removed"
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
        <Button size="lg" onClick={handleRemove} disabled={busy || !metadata}>
          {busy ? (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <ShieldCheck aria-hidden="true" className="size-4" />
          )}
          {busy ? "Removing metadata…" : "Remove Metadata"}
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
          ? "Reading the PDF's metadata."
          : status === "processing"
            ? "Removing metadata. This may take a moment."
            : status === "success" && result
              ? "Metadata removed and verified. The cleaned PDF is ready to download."
              : status === "error" && failure
                ? `Removing metadata failed. ${failure.message}`
                : status === "ready" && metadata
                  ? `Metadata loaded. ${foundCount} of 5 fields contain data.`
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
              Removing metadata…
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
                Metadata removed and verified
              </h3>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
                <FileText aria-hidden="true" className="size-4" />
                <span className="font-medium text-foreground">
                  {result.fileName}
                </span>
                <span>· {formatBytes(result.size)}</span>
                <span>
                  · {result.removal?.removedFields ?? foundCount} fields removed
                </span>
                {result.removal?.xmp === "yes" ? (
                  <span>· XMP data removed</span>
                ) : null}
                <span>
                  · {result.pages ?? pageCount}{" "}
                  {(result.pages ?? pageCount) === 1 ? "page" : "pages"},{" "}
                  unchanged
                </span>
              </p>
              <p className="mt-2 text-sm text-muted">
                The removal was verified by re-reading the result. The creator
                field is empty rather than deleted, and the producer string and
                timestamps were rewritten by the saving library — they remain in
                the file.
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
                  Remove metadata from another PDF
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
