"use client";

import { CheckCircle2, Crop as CropIcon, Download, FileText, Loader2, ShieldAlert } from "lucide-react";
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
  runCrop,
  type ProcessedDocument,
} from "@/lib/processing/client";
import {
  parseAndValidatePageRanges,
  PAGE_RANGE_SYNTAX_HINT,
} from "@/lib/processing/pages";
import { formatBytes } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

export interface CropWorkspaceProps {
  /** Server-configured limits, so the UI matches the API exactly. */
  limits: { maxFileSize: number };
}

type Status = "idle" | "reading" | "ready" | "processing" | "success" | "error";
type Mode = "rectangle" | "margins";

interface FailureState {
  message: string;
  details?: string[];
}

const MODES: { id: Mode; title: string; description: string }[] = [
  {
    id: "rectangle",
    title: "Rectangle",
    description:
      "One absolute rectangle (x, y, width, height), applied to every selected page.",
  },
  {
    id: "margins",
    title: "Margins",
    description:
      "Trim the same amount from each page's edges — works across mixed page sizes.",
  },
];

function toFailure(error: unknown, fallback: string): FailureState {
  if (error instanceof ProcessingRequestError) {
    return { message: error.message, details: error.details };
  }
  return { message: fallback };
}

/** Finite numeric input check (NaN/Infinity are rejected by the server too). */
function isFiniteNumber(raw: string): boolean {
  if (raw.trim() === "") return false;
  return Number.isFinite(Number(raw));
}

/**
 * Crop workspace — CropBox only, never redaction.
 *
 * The privacy warning is a first-class part of the flow, not fine print: it is
 * shown while configuring and again in the success state. Every value is sent
 * to the server, which validates it again (reject, never clamp).
 */
export function CropWorkspace({ limits }: CropWorkspaceProps) {
  const [files, setFiles] = React.useState<SelectedFile[]>([]);
  const [pageCount, setPageCount] = React.useState<number | null>(null);
  const [mode, setMode] = React.useState<Mode>("margins");
  const [rect, setRect] = React.useState({ x: "", y: "", width: "", height: "" });
  const [margins, setMargins] = React.useState({ top: "", right: "", bottom: "", left: "" });
  const [ranges, setRanges] = React.useState("");
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

  const rectValid = [
    isFiniteNumber(rect.x),
    isFiniteNumber(rect.y),
    isFiniteNumber(rect.width),
    isFiniteNumber(rect.height),
  ].every(Boolean);
  const marginsValid = [
    isFiniteNumber(margins.top),
    isFiniteNumber(margins.right),
    isFiniteNumber(margins.bottom),
    isFiniteNumber(margins.left),
  ].every(Boolean);

  const trimmedRanges = ranges.trim();
  const rangeCheck =
    trimmedRanges === "" || pageCount === null
      ? null
      : parseAndValidatePageRanges(trimmedRanges, pageCount);

  const canRun =
    Boolean(file) &&
    pageCount !== null &&
    !busy &&
    status !== "error" &&
    (mode === "rectangle" ? rectValid : marginsValid) &&
    (trimmedRanges === "" || Boolean(rangeCheck?.ok));

  async function handleCrop() {
    if (!canRun || !file) return;

    setResult(null);
    setFailure(null);
    setStatus("processing");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const document =
        mode === "rectangle"
          ? await runCrop({
              file: file.file,
              mode,
              x: Number(rect.x),
              y: Number(rect.y),
              width: Number(rect.width),
              height: Number(rect.height),
              ranges: trimmedRanges || undefined,
              signal: controller.signal,
            })
          : await runCrop({
              file: file.file,
              mode,
              top: Number(margins.top),
              right: Number(margins.right),
              bottom: Number(margins.bottom),
              left: Number(margins.left),
              ranges: trimmedRanges || undefined,
              signal: controller.signal,
            });
      setResult(document);
      setStatus("success");
      showToast({
        tone: "success",
        title: "Pages cropped",
        description: `${document.croppedPages ?? pageCount} ${
          (document.croppedPages ?? pageCount) === 1 ? "page" : "pages"
        } cropped.`,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setStatus("ready");
        return;
      }
      setFailure(toFailure(error, "The PDF could not be cropped."));
      setStatus("error");
    } finally {
      abortRef.current = null;
    }
  }

  function handleStartOver() {
    abortRef.current?.abort();
    setFiles([]);
    setPageCount(null);
    setMode("margins");
    setRect({ x: "", y: "", width: "", height: "" });
    setMargins({ top: "", right: "", bottom: "", left: "" });
    setRanges("");
    setResult(null);
    setFailure(null);
    setStatus("idle");
  }

  const rangeError =
    rangeCheck && !rangeCheck.ok ? rangeCheck.issue.message : undefined;

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
        <div className="rounded-xl border border-border bg-surface p-4">
          <h3 className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
            <ShieldAlert aria-hidden="true" className="size-4 text-primary" />
            Cropping hides content from view — it does not remove it
          </h3>
          <p className="mt-2 text-sm text-muted">
            Cropped-out content remains inside the PDF and may be recovered with
            a PDF editor or text extractor. Do not use Crop PDF as a security
            or redaction tool — confidential content must not be protected this
            way.
          </p>
        </div>
      ) : null}

      {file && pageCount !== null ? (
        <div className="flex flex-col gap-5">
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1 text-sm font-medium text-foreground">
              Crop mode
            </legend>
            {MODES.map((option) => {
              const selected = mode === option.id;
              return (
                <label
                  key={option.id}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors",
                    "focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring",
                    selected
                      ? "border-primary bg-primary-soft/40"
                      : "border-border bg-surface hover:border-border-strong",
                    busy && "pointer-events-none opacity-60",
                  )}
                >
                  <input
                    type="radio"
                    name="crop-mode"
                    value={option.id}
                    checked={selected}
                    disabled={busy}
                    onChange={() => setMode(option.id)}
                    className="mt-1 size-4 accent-[var(--color-primary)] focus:outline-none"
                  />
                  <span>
                    <span className="block text-sm font-medium text-foreground">
                      {option.title}
                    </span>
                    <span className="block text-sm text-muted">{option.description}</span>
                  </span>
                </label>
              );
            })}
          </fieldset>

          {mode === "rectangle" ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {(["x", "y", "width", "height"] as const).map((key) => (
                <Input
                  key={key}
                  label={key === "width" ? "Width" : key === "height" ? "Height" : key === "x" ? "X" : "Y"}
                  value={rect[key]}
                  disabled={busy}
                  onChange={(event) =>
                    setRect((current) => ({ ...current, [key]: event.target.value }))
                  }
                  hint={
                    key === "width" || key === "height"
                      ? `At least 10 pt. Units: points (pt).`
                      : `0 or larger. Units: points (pt).`
                  }
                  error={
                    isFiniteNumber(rect[key])
                      ? undefined
                      : "Enter a finite number (NaN and Infinity are not accepted)."
                  }
                  aria-invalid={!isFiniteNumber(rect[key])}
                  inputMode="decimal"
                  autoComplete="off"
                />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {(["top", "right", "bottom", "left"] as const).map((key) => (
                <Input
                  key={key}
                  label={key === "top" ? "Top" : key === "right" ? "Right" : key === "bottom" ? "Bottom" : "Left"}
                  value={margins[key]}
                  disabled={busy}
                  onChange={(event) =>
                    setMargins((current) => ({ ...current, [key]: event.target.value }))
                  }
                  hint="How much to trim from this edge. Units: points (pt); 0 or larger."
                  error={
                    isFiniteNumber(margins[key])
                      ? undefined
                      : "Enter a finite number (NaN and Infinity are not accepted)."
                  }
                  aria-invalid={!isFiniteNumber(margins[key])}
                  inputMode="decimal"
                  autoComplete="off"
                />
              ))}
            </div>
          )}

          <p className="text-sm text-muted">
            PDF coordinates use a bottom-left origin and are measured in points
            (1 pt = 1/72 inch). Values apply to the page&rsquo;s unrotated
            coordinate space.
          </p>

          <Input
            label="Pages to crop"
            placeholder="1-3, 5"
            value={ranges}
            disabled={busy}
            onChange={(event) => setRanges(event.target.value)}
            hint={`${PAGE_RANGE_SYNTAX_HINT} Leave empty to crop all ${pageCount} ${
              pageCount === 1 ? "page" : "pages"
            }.`}
            error={rangeError}
            aria-invalid={Boolean(rangeError)}
            inputMode="numeric"
            autoComplete="off"
          />
        </div>
      ) : null}

      {status === "error" && failure ? (
        <ErrorState
          title="Crop failed"
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
        <Button size="lg" onClick={handleCrop} disabled={!canRun}>
          {busy ? (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <CropIcon aria-hidden="true" className="size-4" />
          )}
          {busy ? "Cropping your PDF…" : "Crop PDF"}
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
          ? "Reading the PDF to count its pages."
          : status === "processing"
            ? "Cropping your PDF. This may take a moment."
            : status === "success" && result
              ? `Cropped ${result.croppedPages ?? pageCount} ${
                  (result.croppedPages ?? pageCount) === 1 ? "page" : "pages"
                }. The PDF is ready to download.`
              : status === "error" && failure
                ? `Crop failed. ${failure.message}`
                : status === "ready" && pageCount !== null
                  ? `PDF loaded with ${pageCount} pages. Choose the crop.`
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
              Cropping your PDF…
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
                Pages cropped
              </h3>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
                <FileText aria-hidden="true" className="size-4" />
                <span className="font-medium text-foreground">
                  {result.fileName}
                </span>
                <span>· {formatBytes(result.size)}</span>
                <span>
                  · {result.croppedPages ?? pageCount} of {result.pages ?? pageCount}{" "}
                  {(result.pages ?? pageCount) === 1 ? "page" : "pages"} cropped
                </span>
              </p>
              <p className="mt-2 text-sm text-muted">
                The pages keep their size, rotation and content — only the
                visible area changed. Cropped-out content is still in the file;
                this was not redaction.
              </p>

              <div className="mt-4 flex flex-wrap gap-3">
                <a
                  href={result.url}
                  download={result.fileName}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:h-10"
                >
                  <Download aria-hidden="true" className="size-4" />
                  Download cropped PDF
                </a>
                <Button variant="secondary" onClick={handleStartOver}>
                  Crop another PDF
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
