"use client";

import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Download,
  FileText,
  Loader2,
  RotateCcw,
  RotateCw,
  Shuffle,
  Trash2,
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
  runOrganizePdf,
  type PageThumbnailData,
  type ProcessedDocument,
} from "@/lib/processing/client";
import {
  formatRotation,
  identityPageOrder,
  movePageInOrder,
  rotateClockwise,
  rotateCounterClockwise,
  type PageRotationMap,
} from "@/lib/processing/pages";
import { formatBytes } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

export interface OrganizePdfWorkspaceProps {
  limits: {
    maxFileSize: number;
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

export function OrganizePdfWorkspace({ limits }: OrganizePdfWorkspaceProps) {
  const [files, setFiles] = React.useState<SelectedFile[]>([]);
  const [pageCount, setPageCount] = React.useState<number | null>(null);
  const [thumbnails, setThumbnails] = React.useState<
    Map<number, PageThumbnailData> | null
  >(null);
  const [order, setOrder] = React.useState<number[]>([]);
  const [rotations, setRotations] = React.useState<PageRotationMap>({});
  const [status, setStatus] = React.useState<Status>("idle");
  const [result, setResult] = React.useState<ProcessedDocument | null>(null);
  const [failure, setFailure] = React.useState<FailureState | null>(null);
  const [previewFailure, setPreviewFailure] = React.useState<string | null>(null);
  const [announcement, setAnnouncement] = React.useState("");
  const [dragIndex, setDragIndex] = React.useState<number | null>(null);

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

  const loadDocument = React.useCallback(async (chosen: SelectedFile) => {
    let stage: "inspect" | "preview" = "inspect";

    setStatus("reading");
    setPreviewFailure(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const inspection = await inspectPdfFile(chosen.file, controller.signal);
      setPageCount(inspection.pageCount);
      setOrder(identityPageOrder(inspection.pageCount));
      setRotations({});

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
    setRotations({});
    setAnnouncement("");

    const chosen = next[0];
    if (!chosen) {
      setStatus("idle");
      return;
    }

    await loadDocument(chosen);
  }

  function move(from: number, to: number) {
    if (to < 0 || to >= order.length || from === to) return;
    const page = order[from];
    setOrder(movePageInOrder(order, from, to));
    setAnnouncement(`Page ${page} moved to position ${to + 1} of ${order.length}.`);
  }

  function deletePage(index: number) {
    if (order.length <= 1) {
      setAnnouncement("Cannot delete the only remaining page.");
      return;
    }
    const pageNum = order[index]!;
    const nextOrder = order.filter((_, i) => i !== index);
    setOrder(nextOrder);
    setAnnouncement(`Page ${pageNum} deleted.`);
  }

  function rotatePage(pageNum: number, direction: "cw" | "ccw") {
    const current = rotations[pageNum] ?? 0;
    const nextAngle =
      direction === "cw"
        ? rotateClockwise(current)
        : rotateCounterClockwise(current);

    setRotations({ ...rotations, [pageNum]: nextAngle });
    setAnnouncement(`Page ${pageNum} rotated ${nextAngle} degrees.`);
  }

  function handleReset() {
    if (!pageCount) return;
    setOrder(identityPageOrder(pageCount));
    setRotations({});
    setAnnouncement("Page order and rotations reset to original.");
  }

  const busy = status === "processing";
  const previewsReady = Boolean(thumbnails) && !previewFailure;
  const canRun =
    Boolean(file) &&
    pageCount !== null &&
    previewsReady &&
    order.length >= 1 &&
    !busy &&
    status !== "reading" &&
    status !== "previewing";

  async function handleOrganize() {
    if (!canRun || !file || pageCount === null) return;

    setResult(null);
    setFailure(null);
    setStatus("processing");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const document = await runOrganizePdf({
        file: file.file,
        order,
        rotations,
        signal: controller.signal,
      });
      setResult(document);
      setStatus("success");
      showToast({
        tone: "success",
        title: "PDF organized",
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
          : { message: "This PDF could not be organized." },
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
    setRotations({});
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
              {order.length} of {pageCount} {pageCount === 1 ? "page" : "pages"}
            </Badge>
          ) : (
            <span>Page count unavailable</span>
          )}
        </div>
      ) : null}

      {pageCount !== null && order.length > 0 ? (
        <section aria-labelledby="organize-heading" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 id="organize-heading" className="text-sm font-medium text-foreground">
                Page Organization
              </h3>
              <p className="text-sm text-muted">
                Drag or use arrows to reorder, rotate pages, or click delete to remove pages.
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={handleReset} disabled={busy}>
              <RotateCcw aria-hidden="true" className="size-4" />
              Reset
            </Button>
          </div>

          <ul
            className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6"
            data-testid="organize-page-grid"
          >
            {order.map((pageNumber, index) => {
              const thumbnail = thumbnails?.get(pageNumber);
              const rotation = rotations[pageNumber] ?? 0;
              const isFirst = index === 0;
              const isLast = index === order.length - 1;

              return (
                <li
                  key={pageNumber}
                  draggable={!busy}
                  onDragStart={(event) => {
                    if (busy) return;
                    setDragIndex(index);
                    event.dataTransfer.effectAllowed = "move";
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
                  <div className="relative">
                    <PdfPageThumbnail
                      pageNumber={pageNumber}
                      src={thumbnail?.dataUrl}
                      width={thumbnail?.width}
                      height={thumbnail?.height}
                      badge={rotation !== 0 ? formatRotation(rotation) : undefined}
                      state={
                        previewFailure ? "error" : thumbnail ? "ready" : "loading"
                      }
                      positionLabel={`Position ${index + 1}`}
                      dragging={dragIndex === index}
                      showDragHandle={!busy}
                      actions={
                        <>
                          <IconButton
                            label={`Rotate page ${pageNumber} counter-clockwise`}
                            size="sm"
                            variant="subtle"
                            disabled={busy}
                            onClick={() => rotatePage(pageNumber, "ccw")}
                          >
                            <RotateCcw aria-hidden="true" className="size-3.5" />
                          </IconButton>
                          <IconButton
                            label={`Rotate page ${pageNumber} clockwise`}
                            size="sm"
                            variant="subtle"
                            disabled={busy}
                            onClick={() => rotatePage(pageNumber, "cw")}
                          >
                            <RotateCw aria-hidden="true" className="size-3.5" />
                          </IconButton>
                          <IconButton
                            label={`Move page ${pageNumber} left`}
                            size="sm"
                            variant="subtle"
                            disabled={isFirst || busy}
                            onClick={() => move(index, index - 1)}
                          >
                            <ArrowLeft aria-hidden="true" className="size-3.5" />
                          </IconButton>
                          <IconButton
                            label={`Move page ${pageNumber} right`}
                            size="sm"
                            variant="subtle"
                            disabled={isLast || busy}
                            onClick={() => move(index, index + 1)}
                          >
                            <ArrowRight aria-hidden="true" className="size-3.5" />
                          </IconButton>
                          <IconButton
                            label={`Delete page ${pageNumber}`}
                            size="sm"
                            variant="subtle"
                            disabled={order.length <= 1 || busy}
                            onClick={() => deletePage(index)}
                          >
                            <Trash2 aria-hidden="true" className="size-3.5 text-danger" />
                          </IconButton>
                        </>
                      }
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {status === "error" && failure ? (
        <ErrorState
          title="Organization failed"
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
        <Button size="lg" onClick={handleOrganize} disabled={!canRun}>
          {busy ? (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <Shuffle aria-hidden="true" className="size-4" />
          )}
          {busy ? "Organizing PDF…" : "Organize PDF"}
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
        {announcement}
      </p>

      {status === "success" && result ? (
        <div className="rounded-xl border border-success/40 bg-success-soft/50 p-5">
          <div className="flex items-start gap-3">
            <CheckCircle2
              aria-hidden="true"
              className="mt-0.5 size-5 shrink-0 text-success"
            />
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-semibold text-foreground">
                Your organized PDF is ready
              </h3>
              <p className="mt-1 text-sm text-muted">
                {result.outputPages ?? order.length} pages organized.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <a
                  href={result.url}
                  download={result.fileName}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:h-10"
                >
                  <Download aria-hidden="true" className="size-4" />
                  Download organized PDF
                </a>
                <Button variant="secondary" onClick={handleStartOver}>
                  Organize another PDF
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
