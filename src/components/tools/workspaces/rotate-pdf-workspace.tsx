"use client";

import {
  CheckCircle2,
  Download,
  FileText,
  Loader2,
  RotateCcw,
  RotateCw,
  Undo2,
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
  runRotatePdf,
  type PageThumbnailData,
  type ProcessedDocument,
} from "@/lib/processing/client";
import {
  formatRotation,
  hasRotations,
  rotateClockwise,
  rotateCounterClockwise,
  type PageRotation,
  type PageRotationMap,
} from "@/lib/processing/pages";
import { formatBytes } from "@/lib/utils/format";

export interface RotatePdfWorkspaceProps {
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

/** Cache key: a preview is identified by its page *and* its rotation. */
const cacheKey = (page: number, rotation: PageRotation) => `${page}:${rotation}`;

/**
 * Rotate PDF workspace.
 *
 * The Phase 5 page organiser, with rotation instead of ordering: real previews
 * per page, per-page and global rotate controls that work with keyboard and
 * touch, and previews that are re-rendered by the server so what you see is the
 * page as it will be saved. Rotations are held as an explicit map and sent in
 * full; the server validates and applies them.
 */
export function RotatePdfWorkspace({ limits }: RotatePdfWorkspaceProps) {
  const [files, setFiles] = React.useState<SelectedFile[]>([]);
  const [pageCount, setPageCount] = React.useState<number | null>(null);
  const [rotations, setRotations] = React.useState<PageRotationMap>({});
  const [previews, setPreviews] = React.useState<Map<string, PageThumbnailData>>(
    new Map(),
  );
  const [pendingPreviews, setPendingPreviews] = React.useState<Set<number>>(new Set());
  const [status, setStatus] = React.useState<Status>("idle");
  const [result, setResult] = React.useState<ProcessedDocument | null>(null);
  const [failure, setFailure] = React.useState<FailureState | null>(null);
  const [previewFailure, setPreviewFailure] = React.useState<string | null>(null);
  const [announcement, setAnnouncement] = React.useState("");

  const abortRef = React.useRef<AbortController | null>(null);
  const previewAbortRef = React.useRef<AbortController | null>(null);
  const { showToast } = useToast();

  const file = files[0] ?? null;

  React.useEffect(() => {
    if (!result) return;
    return () => URL.revokeObjectURL(result.url);
  }, [result]);

  React.useEffect(() => {
    return () => {
      abortRef.current?.abort();
      previewAbortRef.current?.abort();
    };
  }, []);

  const previewablePages = React.useMemo(() => {
    if (pageCount === null) return [];
    return Array.from(
      { length: Math.min(pageCount, limits.thumbnailMaxPages) },
      (_, index) => index + 1,
    );
  }, [pageCount, limits.thumbnailMaxPages]);

  /**
   * Fetch previews for the given pages at their current rotation, skipping any
   * the browser already holds. One request, whatever the number of pages.
   */
  const loadPreviews = React.useCallback(
    async (
      chosen: File,
      pages: number[],
      pageRotations: PageRotationMap,
      cache: Map<string, PageThumbnailData>,
    ) => {
      const missing = pages.filter(
        (page) => !cache.has(cacheKey(page, pageRotations[page] ?? 0)),
      );
      if (missing.length === 0) return;

      previewAbortRef.current?.abort();
      const controller = new AbortController();
      previewAbortRef.current = controller;

      setPendingPreviews(new Set(missing));

      try {
        const response = await fetchPageThumbnails(
          chosen,
          missing,
          controller.signal,
          pageRotations,
        );

        setPreviews((current) => {
          const next = new Map(current);
          for (const thumbnail of response.thumbnails) {
            next.set(cacheKey(thumbnail.pageNumber, thumbnail.rotation), thumbnail);
          }
          return next;
        });
        setPreviewFailure(null);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setPreviewFailure(
          error instanceof ProcessingRequestError
            ? error.message
            : "Page previews could not be generated.",
        );
      } finally {
        setPendingPreviews(new Set());
        previewAbortRef.current = null;
      }
    },
    [],
  );

  const loadDocument = React.useCallback(
    async (chosen: SelectedFile) => {
      let stage: "inspect" | "preview" = "inspect";

      setStatus("reading");
      setPreviewFailure(null);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const inspection = await inspectPdfFile(chosen.file, controller.signal);
        setPageCount(inspection.pageCount);
        setRotations({});

        stage = "preview";
        setStatus("previewing");

        const pages = Array.from(
          { length: Math.min(inspection.pageCount, limits.thumbnailMaxPages) },
          (_, index) => index + 1,
        );
        const response = await fetchPageThumbnails(
          chosen.file,
          pages,
          controller.signal,
        );

        setPreviews(
          new Map(
            response.thumbnails.map((thumbnail) => [
              cacheKey(thumbnail.pageNumber, thumbnail.rotation),
              thumbnail,
            ]),
          ),
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

        if (stage === "inspect") setFailure({ message });
        else setPreviewFailure(message);
        setStatus("error");
      } finally {
        abortRef.current = null;
      }
    },
    [limits.thumbnailMaxPages],
  );

  async function handleFilesChange(next: SelectedFile[]) {
    abortRef.current?.abort();
    previewAbortRef.current?.abort();
    abortRef.current = null;

    setFiles(next);
    setResult(null);
    setFailure(null);
    setPreviewFailure(null);
    setPreviews(new Map());
    setPendingPreviews(new Set());
    setPageCount(null);
    setRotations({});
    setAnnouncement("");

    const chosen = next[0];
    if (!chosen) {
      setStatus("idle");
      return;
    }

    await loadDocument(chosen);
  }

  /** Apply a rotation change and fetch whatever previews that needs. */
  function applyRotations(next: PageRotationMap, message: string) {
    setRotations(next);
    setAnnouncement(message);
    setResult(null);
    if (file) void loadPreviews(file.file, previewablePages, next, previews);
  }

  function rotatePage(page: number, direction: "cw" | "ccw") {
    const current = rotations[page] ?? 0;
    const rotation =
      direction === "cw" ? rotateClockwise(current) : rotateCounterClockwise(current);
    applyRotations(
      { ...rotations, [page]: rotation },
      `Page ${page} rotated to ${rotation} degrees.`,
    );
  }

  function resetPage(page: number) {
    applyRotations({ ...rotations, [page]: 0 }, `Page ${page} rotation reset.`);
  }

  function rotateAll(direction: "cw" | "ccw") {
    const next: PageRotationMap = { ...rotations };
    for (const page of previewablePages) {
      const current = next[page] ?? 0;
      next[page] =
        direction === "cw" ? rotateClockwise(current) : rotateCounterClockwise(current);
    }
    applyRotations(
      next,
      `All ${previewablePages.length} pages rotated ${
        direction === "cw" ? "clockwise" : "counter-clockwise"
      }.`,
    );
  }

  function resetAll() {
    applyRotations({}, "All page rotations reset.");
  }

  const busy = status === "processing";
  const previewsReady = previews.size > 0 && !previewFailure;
  const changed = hasRotations(rotations);
  const tooManyPages =
    pageCount !== null && pageCount > limits.thumbnailMaxPages;
  const canRun =
    Boolean(file) &&
    pageCount !== null &&
    previewsReady &&
    changed &&
    !tooManyPages &&
    !busy &&
    status !== "reading" &&
    status !== "previewing";

  async function handleRotate() {
    if (!canRun || !file) return;

    setResult(null);
    setFailure(null);
    setStatus("processing");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const document = await runRotatePdf({
        file: file.file,
        rotations,
        signal: controller.signal,
      });
      setResult(document);
      setStatus("success");
      showToast({
        tone: "success",
        title: "Pages rotated",
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
          : { message: "This PDF could not be rotated." },
      );
      setStatus("error");
    } finally {
      abortRef.current = null;
    }
  }

  function handleStartOver() {
    abortRef.current?.abort();
    previewAbortRef.current?.abort();
    setFiles([]);
    setPageCount(null);
    setRotations({});
    setPreviews(new Map());
    setPendingPreviews(new Set());
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

      {tooManyPages ? (
        <ErrorState
          title="This PDF has more pages than the preview limit"
          description={`Rotating uses page previews, and previews are limited to ${limits.thumbnailMaxPages} pages per document. This PDF has ${pageCount}, so it cannot be rotated here yet.`}
        />
      ) : null}

      {previewFailure ? (
        <ErrorState
          title="Page previews couldn’t be generated"
          description={`${previewFailure} Rotating needs the previews, so it stays disabled until they load.`}
          action={
            file ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setPreviewFailure(null);
                  void loadDocument(file);
                }}
              >
                Try again
              </Button>
            ) : null
          }
        />
      ) : null}

      {pageCount !== null && previewablePages.length > 0 && !tooManyPages ? (
        <section aria-labelledby="rotate-pages-heading" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 id="rotate-pages-heading" className="text-sm font-medium text-foreground">
                Page rotation
              </h3>
              <p className="text-sm text-muted">
                {changed
                  ? "Previews show how each page will be saved."
                  : "Rotate individual pages, or use the buttons to rotate them all."}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => rotateAll("ccw")}
                disabled={busy}
              >
                <RotateCcw aria-hidden="true" className="size-4" />
                Rotate all left
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => rotateAll("cw")}
                disabled={busy}
              >
                <RotateCw aria-hidden="true" className="size-4" />
                Rotate all right
              </Button>
              {changed ? (
                <Button variant="ghost" size="sm" onClick={resetAll} disabled={busy}>
                  <Undo2 aria-hidden="true" className="size-4" />
                  Reset all
                </Button>
              ) : null}
            </div>
          </div>

          <ul
            className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6"
            data-testid="rotate-page-grid"
          >
            {previewablePages.map((pageNumber) => {
              const rotation = rotations[pageNumber] ?? 0;
              const preview = previews.get(cacheKey(pageNumber, rotation));
              const fallback = previews.get(cacheKey(pageNumber, 0));
              const shown = preview ?? fallback;

              return (
                <li
                  key={pageNumber}
                  data-page={pageNumber}
                  data-rotation={rotation}
                >
                  <PdfPageThumbnail
                    pageNumber={pageNumber}
                    src={shown?.dataUrl}
                    width={shown?.width}
                    height={shown?.height}
                    state={previewFailure ? "error" : shown ? "ready" : "loading"}
                    refreshing={!preview && pendingPreviews.has(pageNumber)}
                    badge={formatRotation(rotation)}
                    selected={rotation !== 0}
                    actions={
                      <>
                        <IconButton
                          label={`Rotate page ${pageNumber} counter-clockwise`}
                          size="sm"
                          variant="subtle"
                          disabled={busy}
                          onClick={() => rotatePage(pageNumber, "ccw")}
                        >
                          <RotateCcw aria-hidden="true" className="size-4" />
                        </IconButton>
                        <IconButton
                          label={`Rotate page ${pageNumber} clockwise`}
                          size="sm"
                          variant="subtle"
                          disabled={busy}
                          onClick={() => rotatePage(pageNumber, "cw")}
                        >
                          <RotateCw aria-hidden="true" className="size-4" />
                        </IconButton>
                        <IconButton
                          label={`Reset rotation for page ${pageNumber}`}
                          size="sm"
                          variant="subtle"
                          disabled={busy || rotation === 0}
                          onClick={() => resetPage(pageNumber)}
                        >
                          <Undo2 aria-hidden="true" className="size-4" />
                        </IconButton>
                      </>
                    }
                  />
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {status === "error" && failure ? (
        <ErrorState
          title="Rotating failed"
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
        <Button size="lg" onClick={handleRotate} disabled={!canRun}>
          {busy ? (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <RotateCw aria-hidden="true" className="size-4" />
          )}
          {busy ? "Rotating your PDF…" : "Rotate PDF"}
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

        {file && previewsReady && !changed && !tooManyPages ? (
          <p className="text-sm text-muted">Rotate at least one page to continue.</p>
        ) : null}
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {announcement ||
          (status === "reading"
            ? "Reading the PDF to count its pages."
            : status === "previewing"
              ? "Generating page previews."
              : status === "processing"
                ? "Rotating your PDF. This may take a moment."
                : status === "success" && result
                  ? `Pages rotated. ${result.fileName} is ready to download.`
                  : status === "error" && failure
                    ? `Rotating failed. ${failure.message}`
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
            <p className="text-sm font-medium text-foreground">Rotating your PDF…</p>
            <p className="text-sm text-muted">
              Your file is processed on the server and discarded as soon as the result
              is returned. Cancel stops the request in your browser; the server may
              finish work already started.
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
                Your rotated PDF is ready
              </h3>
              <p className="mt-1 text-sm text-muted">
                {result.outputPages ?? pageCount} pages, with your rotations applied.
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
                  Rotate another PDF
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
