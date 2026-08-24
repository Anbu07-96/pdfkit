"use client";

import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Download,
  FileText,
  Loader2,
  RotateCcw,
  Shuffle,
} from "lucide-react";
import * as React from "react";
import { PdfPageThumbnail } from "@/components/tools/pdf-page-thumbnail";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { ErrorState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { UploadZone, type SelectedFile } from "@/components/upload/upload-zone";
import {
  fetchPageThumbnails,
  inspectPdfFile,
  ProcessingRequestError,
  runReorderPdfPages,
  type PageThumbnailData,
  type ProcessedDocument,
} from "@/lib/processing/client";
import {
  identityPageOrder,
  isIdentityPageOrder,
  movePageInOrder,
  validatePageOrder,
} from "@/lib/processing/pages";
import { formatBytes } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

export interface ReorderPdfPagesWorkspaceProps {
  limits: {
    maxFileSize: number;
    /** Pages the server will render previews for in one request. */
    thumbnailMaxPages: number;
  };
}

type Status =
  | "idle"
  | "reading"
  | "previewing"
  | "ready"
  | "processing"
  | "success"
  | "error";

interface FailureState {
  message: string;
  details?: string[];
}

/**
 * Reorder PDF Pages workspace.
 *
 * A visual page organiser: real server-rendered page previews, an explicit page
 * order held in state, move controls that work with keyboard and touch, and
 * drag and drop as an enhancement on top. The full order is always submitted —
 * the server never infers it.
 */
export function ReorderPdfPagesWorkspace({ limits }: ReorderPdfPagesWorkspaceProps) {
  const [files, setFiles] = React.useState<SelectedFile[]>([]);
  const [pageCount, setPageCount] = React.useState<number | null>(null);
  const [thumbnails, setThumbnails] = React.useState<
    Map<number, PageThumbnailData> | null
  >(null);
  const [order, setOrder] = React.useState<number[]>([]);
  const [status, setStatus] = React.useState<Status>("idle");
  const [result, setResult] = React.useState<ProcessedDocument | null>(null);
  const [failure, setFailure] = React.useState<FailureState | null>(null);
  const [previewFailure, setPreviewFailure] = React.useState<string | null>(null);
  const [announcement, setAnnouncement] = React.useState("");
  const [dragIndex, setDragIndex] = React.useState<number | null>(null);

  const abortRef = React.useRef<AbortController | null>(null);
  const { showToast } = useToast();

  const file = files[0] ?? null;

  // Release the produced object URL when it is replaced, and on unmount.
  React.useEffect(() => {
    if (!result) return;
    return () => URL.revokeObjectURL(result.url);
  }, [result]);

  React.useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const loadDocument = React.useCallback(async (chosen: SelectedFile) => {
    // Which step failed matters: a failed inspection is fatal, a failed
    // preview is reported on its own. Tracked locally because React state is
    // not yet updated inside this function.
    let stage: "inspect" | "preview" = "inspect";

    setStatus("reading");
    setPreviewFailure(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const inspection = await inspectPdfFile(chosen.file, controller.signal);
      setPageCount(inspection.pageCount);
      setOrder(identityPageOrder(inspection.pageCount));

      stage = "preview";
      setStatus("previewing");
      const previews = await fetchPageThumbnails(
        chosen.file,
        undefined,
        controller.signal,
      );
      setThumbnails(
        new Map(previews.thumbnails.map((thumb) => [thumb.pageNumber, thumb])),
      );
      setStatus("ready");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;

      const message =
        error instanceof ProcessingRequestError
          ? error.message
          : stage === "inspect"
            ? "This PDF could not be read."
            : "Page previews could not be generated.";

      if (stage === "inspect") {
        setFailure({ message });
      } else {
        setPreviewFailure(message);
      }
      setStatus("error");
    } finally {
      abortRef.current = null;
    }
  }, []);

  async function handleFilesChange(next: SelectedFile[]) {
    abortRef.current?.abort();
    abortRef.current = null;

    setFiles(next);
    setResult(null);
    setFailure(null);
    setPreviewFailure(null);
    setThumbnails(null);
    setPageCount(null);
    setOrder([]);
    setAnnouncement("");

    const chosen = next[0];
    if (!chosen) {
      setStatus("idle");
      return;
    }

    await loadDocument(chosen);
  }

  async function handleRetryPreviews() {
    if (!file) return;
    setPreviewFailure(null);
    setThumbnails(null);
    await loadDocument(file);
  }

  function move(from: number, to: number) {
    if (to < 0 || to >= order.length || from === to) {
      const page = order[from];
      setAnnouncement(
        to < 0
          ? `Page ${page} is already first.`
          : `Page ${page} is already last.`,
      );
      return;
    }

    const page = order[from];
    setOrder(movePageInOrder(order, from, to));
    setAnnouncement(`Page ${page} moved to position ${to + 1} of ${order.length}.`);
  }

  function handleReset() {
    setOrder(identityPageOrder(pageCount ?? 0));
    setAnnouncement("Page order reset to the original document order.");
  }

  const busy = status === "processing";
  const previewsReady = Boolean(thumbnails) && !previewFailure;
  const orderProblem =
    pageCount === null ? null : validatePageOrder(order, pageCount);
  const unchanged = order.length > 0 && isIdentityPageOrder(order);
  const canRun =
    Boolean(file) &&
    pageCount !== null &&
    previewsReady &&
    !orderProblem &&
    !busy &&
    status !== "reading" &&
    status !== "previewing";

  async function handleReorder() {
    if (!canRun || !file || pageCount === null) return;

    setResult(null);
    setFailure(null);
    setStatus("processing");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const document = await runReorderPdfPages({
        file: file.file,
        order,
        signal: controller.signal,
      });
      setResult(document);
      setStatus("success");
      showToast({
        tone: "success",
        title: "Pages reordered",
        description: `${document.fileName} is ready to download.`,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setStatus("ready");
        return;
      }
      setFailure(
        error instanceof ProcessingRequestError
          ? { message: error.message, details: error.details }
          : { message: "This PDF could not be reordered." },
      );
      setStatus("error");
    } finally {
      abortRef.current = null;
    }
  }

  function handleStartOver() {
    abortRef.current?.abort();
    setFiles([]);
    setPageCount(null);
    setThumbnails(null);
    setOrder([]);
    setResult(null);
    setFailure(null);
    setPreviewFailure(null);
    setAnnouncement("");
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
        busy={busy || status === "reading" || status === "previewing"}
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
          {status === "previewing" ? (
            <span className="inline-flex items-center gap-1.5">
              <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
              Generating page previews…
            </span>
          ) : null}
        </div>
      ) : null}

      {pageCount !== null && pageCount > limits.thumbnailMaxPages ? (
        <p className="text-sm text-muted">
          Previews are shown for the first {limits.thumbnailMaxPages} pages; longer
          documents cannot be reordered here yet.
        </p>
      ) : null}

      {previewFailure ? (
        <ErrorState
          title="Page previews couldn’t be generated"
          description={`${previewFailure} Reordering needs the previews, so it stays disabled until they load.`}
          action={
            <Button variant="secondary" size="sm" onClick={handleRetryPreviews}>
              Try again
            </Button>
          }
        />
      ) : null}

      {pageCount !== null && order.length > 0 ? (
        <section aria-labelledby="page-order-heading" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3
                id="page-order-heading"
                className="text-sm font-medium text-foreground"
              >
                Page order
              </h3>
              <p className="text-sm text-muted">
                {unchanged
                  ? "Move pages to change the order. Nothing has been moved yet."
                  : "This is the order your new PDF will use."}
              </p>
            </div>
            {!unchanged ? (
              <Button variant="ghost" size="sm" onClick={handleReset} disabled={busy}>
                <RotateCcw aria-hidden="true" className="size-4" />
                Reset order
              </Button>
            ) : null}
          </div>

          <ul
            className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6"
            data-testid="page-order-grid"
          >
            {order.map((pageNumber, index) => {
              const thumbnail = thumbnails?.get(pageNumber);
              const isFirst = index === 0;
              const isLast = index === order.length - 1;

              return (
                <li
                  key={pageNumber}
                  data-page={pageNumber}
                  data-position={index + 1}
                  draggable={!busy}
                  onDragStart={(event) => {
                    if (busy) return;
                    setDragIndex(index);
                    event.dataTransfer.effectAllowed = "move";
                    // Some browsers require data for a drag to start at all.
                    event.dataTransfer.setData("text/plain", String(pageNumber));
                  }}
                  onDragOver={(event) => {
                    if (dragIndex === null || busy) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(event) => {
                    if (dragIndex === null || busy) return;
                    event.preventDefault();
                    move(dragIndex, index);
                    setDragIndex(null);
                  }}
                  onDragEnd={() => setDragIndex(null)}
                  className={cn(dragIndex === index && "cursor-grabbing")}
                >
                  <PdfPageThumbnail
                    pageNumber={pageNumber}
                    src={thumbnail?.dataUrl}
                    width={thumbnail?.width}
                    height={thumbnail?.height}
                    state={
                      previewFailure ? "error" : thumbnail ? "ready" : "loading"
                    }
                    positionLabel={`Position ${index + 1}`}
                    dragging={dragIndex === index}
                    showDragHandle={!busy}
                    actions={
                      <>
                        <IconButton
                          label={
                            isFirst
                              ? `Page ${pageNumber} is already first`
                              : `Move page ${pageNumber} earlier`
                          }
                          size="sm"
                          variant="subtle"
                          disabled={isFirst || busy}
                          onClick={() => move(index, index - 1)}
                        >
                          <ArrowLeft aria-hidden="true" className="size-4" />
                        </IconButton>
                        <IconButton
                          label={
                            isLast
                              ? `Page ${pageNumber} is already last`
                              : `Move page ${pageNumber} later`
                          }
                          size="sm"
                          variant="subtle"
                          disabled={isLast || busy}
                          onClick={() => move(index, index + 1)}
                        >
                          <ArrowRight aria-hidden="true" className="size-4" />
                        </IconButton>
                      </>
                    }
                  />
                </li>
              );
            })}
          </ul>

          <p className="text-xs text-subtle">
            Drag a page onto another position, or use the arrow buttons — they work
            with a keyboard and on touch screens.
          </p>
        </section>
      ) : null}

      {status === "error" && failure ? (
        <ErrorState
          title="Reordering failed"
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
        <Button size="lg" onClick={handleReorder} disabled={!canRun}>
          {busy ? (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <Shuffle aria-hidden="true" className="size-4" />
          )}
          {busy ? "Reordering your PDF…" : "Reorder PDF"}
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

        {file && canRun && unchanged ? (
          <p className="text-sm text-muted">
            The order is unchanged — you can still create a copy.
          </p>
        ) : null}
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {announcement ||
          (status === "reading"
            ? "Reading the PDF to count its pages."
            : status === "previewing"
              ? "Generating page previews."
              : status === "processing"
                ? "Reordering your PDF. This may take a moment."
                : status === "success" && result
                  ? `Pages reordered. ${result.fileName} is ready to download.`
                  : status === "error" && failure
                    ? `Reordering failed. ${failure.message}`
                    : status === "ready" && pageCount !== null
                      ? `PDF loaded with ${pageCount} pages and previews ready.`
                      : "")}
      </p>

      {busy ? (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-surface p-4">
          <Loader2
            aria-hidden="true"
            className="size-5 shrink-0 animate-spin text-primary"
          />
          <div>
            <p className="text-sm font-medium text-foreground">Reordering your PDF…</p>
            <p className="text-sm text-muted">
              Your file is processed on the server and discarded as soon as the result
              is returned. Cancelling stops the browser waiting; work already started
              on the server may still finish.
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
                Your reordered PDF is ready
              </h3>
              <p className="mt-1 text-sm text-muted">
                {result.outputPages ?? order.length} pages in the order you chose.
              </p>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
                <FileText aria-hidden="true" className="size-4" />
                <span className="font-medium break-all text-foreground">
                  {result.fileName}
                </span>
                <span>· {formatBytes(result.size)}</span>
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
                  Reorder another PDF
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
