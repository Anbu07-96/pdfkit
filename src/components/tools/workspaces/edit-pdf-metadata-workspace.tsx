"use client";

import { CheckCircle2, Download, FileText, Loader2, Tags } from "lucide-react";
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
  runEditPdfMetadata,
  type DocumentMetadata,
  type ProcessedDocument,
} from "@/lib/processing/client";
import {
  formatKeywords,
  formatMetadataDate,
  MAX_METADATA_FIELD_LENGTH,
} from "@/lib/processing/metadata";
import { formatBytes } from "@/lib/utils/format";

export interface EditPdfMetadataWorkspaceProps {
  /** Server-configured limits, so the UI matches the API exactly. */
  limits: { maxFileSize: number };
}

type Status = "idle" | "reading" | "ready" | "processing" | "success" | "error";

interface FailureState {
  message: string;
  details?: string[];
}

interface Draft {
  title: string;
  author: string;
  subject: string;
  keywords: string;
  creator: string;
}

const EMPTY_DRAFT: Draft = {
  title: "",
  author: "",
  subject: "",
  keywords: "",
  creator: "",
};

const FIELDS: {
  id: keyof Draft;
  label: string;
  placeholder: string;
}[] = [
  {
    id: "title",
    label: "Title",
    placeholder: "Quarterly report",
  },
  {
    id: "author",
    label: "Author",
    placeholder: "A. Writer",
  },
  {
    id: "subject",
    label: "Subject",
    placeholder: "Financial results",
  },
  {
    id: "keywords",
    label: "Keywords (comma-separated)",
    placeholder: "finance, 2026, report",
  },
  {
    id: "creator",
    label: "Creator",
    placeholder: "The software that made this PDF",
  },
];

function toFailure(error: unknown, fallback: string): FailureState {
  if (error instanceof ProcessingRequestError) {
    return { message: error.message, details: error.details };
  }
  return { message: fallback };
}

/**
 * Edit PDF Metadata workspace.
 *
 * The current values always come from the server's inspection — never guessed
 * in the browser. Editing changes only the five supported Info fields; empty
 * means removed, and Producer/dates are displayed read-only because pdf-lib
 * re-stamps them on every save (stated in the interface, not hidden).
 */
export function EditPdfMetadataWorkspace({ limits }: EditPdfMetadataWorkspaceProps) {
  const [files, setFiles] = React.useState<SelectedFile[]>([]);
  const [pageCount, setPageCount] = React.useState<number | null>(null);
  const [metadata, setMetadata] = React.useState<DocumentMetadata | null>(null);
  const [draft, setDraft] = React.useState<Draft>(EMPTY_DRAFT);
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
    setDraft(EMPTY_DRAFT);

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
      setDraft({
        title: inspection.metadata.title ?? "",
        author: inspection.metadata.author ?? "",
        subject: inspection.metadata.subject ?? "",
        keywords: formatKeywords(inspection.metadata.keywords),
        creator: inspection.metadata.creator ?? "",
      });
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
  const editingDisabled = busy || status === "reading";

  async function handleSave() {
    if (!file || busy || metadata === null) return;

    setResult(null);
    setFailure(null);
    setStatus("processing");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const document = await runEditPdfMetadata({
        file: file.file,
        title: draft.title,
        author: draft.author,
        subject: draft.subject,
        keywords: draft.keywords,
        creator: draft.creator,
        signal: controller.signal,
      });
      setResult(document);
      setStatus("success");
      showToast({
        tone: "success",
        title: "Metadata saved",
        description: `${document.fileName} is ready to download.`,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setStatus("ready");
        return;
      }
      setFailure(toFailure(error, "The metadata could not be saved."));
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
    setDraft(EMPTY_DRAFT);
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
        <div className="flex flex-col gap-5">
          <fieldset className="flex flex-col gap-3" disabled={editingDisabled}>
            <legend className="mb-1 text-sm font-medium text-foreground">
              Editable properties
            </legend>
            {FIELDS.map((field) => (
              <Input
                key={field.id}
                label={field.label}
                placeholder={field.placeholder}
                value={draft[field.id]}
                disabled={editingDisabled}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    [field.id]: event.target.value,
                  }))
                }
                hint={
                  field.id === "keywords"
                    ? "Separate keywords with commas. Leave a field empty to remove it."
                    : "Leave a field empty to remove it."
                }
                maxLength={MAX_METADATA_FIELD_LENGTH}
                autoComplete="off"
              />
            ))}
            <div>
              <Button
                variant="ghost"
                size="lg"
                disabled={editingDisabled}
                onClick={() => setDraft(EMPTY_DRAFT)}
              >
                Clear all fields
              </Button>
            </div>
          </fieldset>

          <div className="rounded-xl border border-border bg-surface p-4">
            <h3 className="text-sm font-medium text-foreground">
              Read-only properties
            </h3>
            <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
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
            <p className="mt-3 text-xs text-subtle">
              pdf-lib re-stamps the producer and both dates whenever a document
              is saved, so editing them here would silently be lost — they are
              shown exactly as the file reports them.
            </p>
          </div>
        </div>
      ) : null}

      {status === "error" && failure ? (
        <ErrorState
          title="Metadata could not be saved"
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
        <Button size="lg" onClick={handleSave} disabled={busy || !metadata}>
          {busy ? (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <Tags aria-hidden="true" className="size-4" />
          )}
          {busy ? "Saving metadata…" : "Save metadata"}
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
          ? "Reading the PDF's properties."
          : status === "processing"
            ? "Saving metadata. This may take a moment."
            : status === "success" && result
              ? "Metadata saved. The updated PDF is ready to download."
              : status === "error" && failure
                ? `Saving metadata failed. ${failure.message}`
                : status === "ready"
                  ? "Properties loaded. Edit the fields and save."
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
              Saving metadata…
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
                Metadata saved
              </h3>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
                <FileText aria-hidden="true" className="size-4" />
                <span className="font-medium text-foreground">
                  {result.fileName}
                </span>
                <span>· {formatBytes(result.size)}</span>
                <span>
                  · {result.pages ?? pageCount}{" "}
                  {(result.pages ?? pageCount) === 1 ? "page" : "pages"},{" "}
                  unchanged
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
                  Edit another PDF
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
