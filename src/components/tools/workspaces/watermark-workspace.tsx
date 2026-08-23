"use client";

import { CheckCircle2, Download, Droplets, FileText, Loader2, ShieldAlert } from "lucide-react";
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
  runWatermark,
  type ProcessedDocument,
} from "@/lib/processing/client";
import {
  MAX_WATERMARK_TEXT_LENGTH,
  type WatermarkPageMode,
  type WatermarkPlacement,
  type WatermarkRotationDegrees,
  type WatermarkOpacityPercent,
} from "@/lib/processing/watermark";
import { formatBytes } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

export interface WatermarkWorkspaceProps {
  /** Server-configured limits, so the UI matches the API exactly. */
  limits: { maxFileSize: number };
}

type Status = "idle" | "reading" | "ready" | "processing" | "success" | "error";

interface FailureState {
  message: string;
  details?: string[];
}

interface OptionGroup<T extends string | number> {
  legend: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; title: string; description: string }[];
}

const OPACITY_OPTIONS: { value: WatermarkOpacityPercent; title: string; description: string }[] = [
  { value: 25, title: "25%", description: "Faint — barely intrudes on the content." },
  { value: 50, title: "50%", description: "Balanced — clearly visible, content stays readable." },
  { value: 75, title: "75%", description: "Strong — hard to miss." },
];

const ROTATION_OPTIONS: { value: WatermarkRotationDegrees; title: string; description: string }[] = [
  { value: 0, title: "0°", description: "Horizontal." },
  { value: 45, title: "45°", description: "Diagonal, rising left to right." },
  { value: -45, title: "-45°", description: "Diagonal, falling left to right." },
];

const PLACEMENT_OPTIONS: { value: WatermarkPlacement; title: string; description: string }[] = [
  { value: "center", title: "Center", description: "One stamp in the middle of each page." },
  { value: "diagonal-tiled", title: "Diagonal tiles", description: "Repeating stamps across the whole page." },
  { value: "corner", title: "Corner", description: "One small stamp in the bottom-right corner." },
];

const PAGE_OPTIONS: { value: WatermarkPageMode; title: string; description: string }[] = [
  { value: "all", title: "All pages", description: "Stamp every page." },
  { value: "first", title: "First page", description: "Stamp only page 1." },
  { value: "last", title: "Last page", description: "Stamp only the final page." },
];

function toFailure(error: unknown, fallback: string): FailureState {
  if (error instanceof ProcessingRequestError) {
    return { message: error.message, details: error.details };
  }
  return { message: fallback };
}

/**
 * Watermark workspace.
 *
 * Interaction state only: every option is sent to the server, which validates
 * it again, and the stamped-page count in the result comes from the response
 * header — never guessed in the browser.
 */
export function WatermarkWorkspace({ limits }: WatermarkWorkspaceProps) {
  const [files, setFiles] = React.useState<SelectedFile[]>([]);
  const [pageCount, setPageCount] = React.useState<number | null>(null);
  const [text, setText] = React.useState("");
  const [opacity, setOpacity] = React.useState<WatermarkOpacityPercent>(50);
  const [rotation, setRotation] = React.useState<WatermarkRotationDegrees>(45);
  const [placement, setPlacement] = React.useState<WatermarkPlacement>("center");
  const [pages, setPages] = React.useState<WatermarkPageMode>("all");
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
  const textReady = text.trim().length > 0 && text.trim().length <= MAX_WATERMARK_TEXT_LENGTH;
  const canRun = Boolean(file) && pageCount !== null && !busy && textReady && status !== "error";

  async function handleAdd() {
    if (!canRun || !file) return;

    setResult(null);
    setFailure(null);
    setStatus("processing");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const document = await runWatermark({
        file: file.file,
        text,
        opacityPercent: opacity,
        rotationDegrees: rotation,
        placement,
        pages,
        signal: controller.signal,
      });
      setResult(document);
      setStatus("success");
      showToast({
        tone: "success",
        title: "Watermark added",
        description: `${document.watermarkedPages ?? pageCount} ${
          (document.watermarkedPages ?? pageCount) === 1 ? "page" : "pages"
        } stamped.`,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setStatus("ready");
        return;
      }
      setFailure(toFailure(error, "The watermark could not be added."));
      setStatus("error");
    } finally {
      abortRef.current = null;
    }
  }

  function handleStartOver() {
    abortRef.current?.abort();
    setFiles([]);
    setPageCount(null);
    setText("");
    setOpacity(50);
    setRotation(45);
    setPlacement("center");
    setPages("all");
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
        <div className="flex flex-col gap-5">
          <Input
            label="Watermark text"
            placeholder="CONFIDENTIAL"
            value={text}
            disabled={busy}
            onChange={(event) => setText(event.target.value)}
            hint={`Up to ${MAX_WATERMARK_TEXT_LENGTH} characters, standard Latin letters. ${text.trim().length}/${MAX_WATERMARK_TEXT_LENGTH} used.`}
            aria-invalid={!textReady}
            autoComplete="off"
          />

          <RadioGroup
            legend="Opacity"
            name="watermark-opacity"
            value={opacity}
            onChange={setOpacity}
            options={OPACITY_OPTIONS}
            disabled={busy}
          />
          <RadioGroup
            legend="Rotation"
            name="watermark-rotation"
            value={rotation}
            onChange={setRotation}
            options={ROTATION_OPTIONS}
            disabled={busy}
          />
          <RadioGroup
            legend="Placement"
            name="watermark-placement"
            value={placement}
            onChange={setPlacement}
            options={PLACEMENT_OPTIONS}
            disabled={busy}
          />
          <RadioGroup
            legend="Pages"
            name="watermark-pages"
            value={pages}
            onChange={setPages}
            options={PAGE_OPTIONS}
            disabled={busy}
          />

          <div className="rounded-xl border border-border bg-surface p-4">
            <h3 className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
              <ShieldAlert aria-hidden="true" className="size-4" />
              A watermark is a deterrent, not protection
            </h3>
            <p className="mt-2 text-sm text-muted">
              A visible watermark discourages casual sharing, but anyone with a
              PDF editor can crop, cover or remove it. For confidentiality,
              combine it with actual access control on your side.
            </p>
          </div>
        </div>
      ) : null}

      {status === "error" && failure ? (
        <ErrorState
          title="Watermark could not be added"
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
        <Button size="lg" onClick={handleAdd} disabled={!canRun}>
          {busy ? (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <Droplets aria-hidden="true" className="size-4" />
          )}
          {busy ? "Adding your watermark…" : "Add Watermark"}
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
            ? "Adding your watermark. This may take a moment."
            : status === "success" && result
              ? `Watermark added to ${result.watermarkedPages ?? pageCount} ${
                  (result.watermarkedPages ?? pageCount) === 1 ? "page" : "pages"
                }. The PDF is ready to download.`
              : status === "error" && failure
                ? `Adding the watermark failed. ${failure.message}`
                : status === "ready" && pageCount !== null
                  ? `PDF loaded with ${pageCount} pages. Enter the watermark text.`
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
              Adding your watermark…
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
                Watermark added
              </h3>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
                <FileText aria-hidden="true" className="size-4" />
                <span className="font-medium text-foreground">
                  {result.fileName}
                </span>
                <span>· {formatBytes(result.size)}</span>
                <span>
                  · {result.watermarkedPages ?? pageCount} of{" "}
                  {result.pages ?? pageCount}{" "}
                  {(result.pages ?? pageCount) === 1 ? "page" : "pages"} stamped
                </span>
                <span>
                  · {result.outputPages ?? pageCount}{" "}
                  {(result.outputPages ?? pageCount) === 1 ? "page" : "pages"},
                  content unchanged
                </span>
              </p>
              <p className="mt-2 text-sm text-muted">
                The watermark is vector text drawn on top of the page — the
                document stays a real, searchable PDF. Remember: a visible
                watermark is a deterrent, not protection.
              </p>

              <div className="mt-4 flex flex-wrap gap-3">
                <a
                  href={result.url}
                  download={result.fileName}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:h-10"
                >
                  <Download aria-hidden="true" className="size-4" />
                  Download watermarked PDF
                </a>
                <Button variant="secondary" onClick={handleStartOver}>
                  Watermark another PDF
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

/** Accessible radio group for a watermark option (44px targets, keyboard). */
function RadioGroup<T extends string | number>(props: OptionGroup<T> & { name: string; disabled: boolean }) {
  const { legend, name, value, onChange, options, disabled } = props;
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-sm font-medium text-foreground">{legend}</legend>
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <label
            key={String(option.value)}
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors",
              "focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring",
              selected
                ? "border-primary bg-primary-soft/40"
                : "border-border bg-surface hover:border-border-strong",
              disabled && "pointer-events-none opacity-60",
            )}
          >
            <input
              type="radio"
              name={name}
              value={String(option.value)}
              checked={selected}
              disabled={disabled}
              onChange={() => onChange(option.value)}
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
  );
}
