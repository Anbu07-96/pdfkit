"use client";

import {
  CheckCircle2,
  Download,
  FileText,
  Loader2,
  Pencil,
} from "lucide-react";
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
  runDraw,
  type ProcessedDocument,
} from "@/lib/processing/client";
import {
  MIN_DRAW_DIMENSION,
  MAX_DRAW_DIMENSION,
  MIN_DRAW_STROKE,
  MAX_DRAW_STROKE,
  type DrawPageMode,
  type DrawPlacement,
  type DrawPreset,
} from "@/lib/processing/draw";
import { formatBytes } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

export interface DrawWorkspaceProps {
  limits: { maxFileSize: number };
}

type Status = "idle" | "reading" | "ready" | "processing" | "success" | "error";

interface FailureState {
  message: string;
  details?: string[];
}

const PRESET_OPTIONS: { value: DrawPreset; title: string; description: string }[] = [
  { value: "checkmark", title: "Checkmark", description: "Approval mark stroke." },
  { value: "cross", title: "Cross (X)", description: "Rejection / cancellation cross." },
  { value: "wave", title: "Wave", description: "Sine wave freehand line." },
  { value: "circle-loop", title: "Circle Loop", description: "Freehand loop." },
];

const PLACEMENT_OPTIONS: {
  value: DrawPlacement;
  title: string;
  description: string;
}[] = [
  { value: "top-left", title: "Top left", description: "Upper-left corner." },
  { value: "top-center", title: "Top center", description: "Centred top edge." },
  { value: "top-right", title: "Top right", description: "Upper-right corner." },
  { value: "center-left", title: "Middle left", description: "Centred left edge." },
  { value: "center", title: "Middle center", description: "Page center." },
  { value: "center-right", title: "Middle right", description: "Centred right edge." },
  { value: "bottom-left", title: "Bottom left", description: "Lower-left corner." },
  { value: "bottom-center", title: "Bottom center", description: "Centred bottom edge." },
  { value: "bottom-right", title: "Bottom right", description: "Lower-right corner." },
];

const PAGE_OPTIONS: { value: DrawPageMode; title: string; description: string }[] = [
  { value: "all", title: "All pages", description: "Draw on every page." },
  { value: "first", title: "First page", description: "Draw on page 1 only." },
  { value: "last", title: "Last page", description: "Draw on final page only." },
];

const STROKE_COLORS = [
  { value: "#000000", label: "Black" },
  { value: "#dc2626", label: "Red" },
  { value: "#2563eb", label: "Blue" },
  { value: "#16a34a", label: "Green" },
];

function toFailure(error: unknown, fallback: string): FailureState {
  if (error instanceof ProcessingRequestError) {
    return { message: error.message, details: error.details };
  }
  return { message: fallback };
}

export function DrawWorkspace({ limits }: DrawWorkspaceProps) {
  const [files, setFiles] = React.useState<SelectedFile[]>([]);
  const [pageCount, setPageCount] = React.useState<number | null>(null);
  const [preset, setPreset] = React.useState<DrawPreset>("checkmark");
  const [placement, setPlacement] = React.useState<DrawPlacement>("bottom-right");
  const [width, setWidth] = React.useState(100);
  const [height, setHeight] = React.useState(60);
  const [strokeWidth, setStrokeWidth] = React.useState(3);
  const [strokeColor, setStrokeColor] = React.useState("#000000");
  const [pages, setPages] = React.useState<DrawPageMode>("all");
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
  const validWidth = Number.isFinite(width) && width >= MIN_DRAW_DIMENSION && width <= MAX_DRAW_DIMENSION;
  const validHeight = Number.isFinite(height) && height >= MIN_DRAW_DIMENSION && height <= MAX_DRAW_DIMENSION;
  const validStroke = Number.isFinite(strokeWidth) && strokeWidth >= MIN_DRAW_STROKE && strokeWidth <= MAX_DRAW_STROKE;

  const canRun =
    Boolean(file) &&
    pageCount !== null &&
    !busy &&
    validWidth &&
    validHeight &&
    validStroke &&
    status !== "error";

  async function handleDraw() {
    if (!canRun || !file) return;

    setResult(null);
    setFailure(null);
    setStatus("processing");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const document = await runDraw({
        file: file.file,
        preset,
        placement,
        width,
        height,
        strokeWidth,
        strokeColor,
        pages,
        signal: controller.signal,
      });
      setResult(document);
      setStatus("success");
      showToast({
        tone: "success",
        title: "Drawing complete",
        description: `${document.drawnPages ?? pageCount} ${
          (document.drawnPages ?? pageCount) === 1 ? "page" : "pages"
        } received drawing marks.`,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setStatus("ready");
        return;
      }
      setFailure(toFailure(error, "Drawing failed."));
      setStatus("error");
    } finally {
      abortRef.current = null;
    }
  }

  function handleStartOver() {
    abortRef.current?.abort();
    setFiles([]);
    setPageCount(null);
    setPreset("checkmark");
    setPlacement("bottom-right");
    setWidth(100);
    setHeight(60);
    setStrokeWidth(3);
    setStrokeColor("#000000");
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
          <RadioGroup
            legend="Drawing shape"
            name="draw-preset"
            value={preset}
            onChange={setPreset}
            options={PRESET_OPTIONS}
            disabled={busy}
            columns={2}
          />

          <RadioGroup
            legend="Position on page"
            name="draw-placement"
            value={placement}
            onChange={setPlacement}
            options={PLACEMENT_OPTIONS}
            disabled={busy}
            columns={3}
          />

          <div className="grid gap-4 sm:grid-cols-3">
            <Input
              label="Width (pt)"
              type="number"
              value={String(width)}
              disabled={busy}
              onChange={(e) => setWidth(Number(e.target.value))}
            />
            <Input
              label="Height (pt)"
              type="number"
              value={String(height)}
              disabled={busy}
              onChange={(e) => setHeight(Number(e.target.value))}
            />
            <Input
              label="Stroke width (pt)"
              type="number"
              value={String(strokeWidth)}
              disabled={busy}
              onChange={(e) => setStrokeWidth(Number(e.target.value))}
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-foreground">
              Stroke color
            </label>
            <div className="flex flex-wrap gap-2">
              {STROKE_COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  disabled={busy}
                  onClick={() => setStrokeColor(c.value)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                    strokeColor === c.value
                      ? "border-primary bg-primary-soft text-primary-foreground"
                      : "border-border bg-surface text-foreground hover:border-border-strong",
                  )}
                >
                  <span
                    className="size-3.5 rounded-full border border-border"
                    style={{ backgroundColor: c.value }}
                  />
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <RadioGroup
            legend="Target pages"
            name="draw-pages"
            value={pages}
            onChange={setPages}
            options={PAGE_OPTIONS}
            disabled={busy}
          />

          <div className="rounded-xl border border-border bg-surface p-4">
            <h3 className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
              <Pencil aria-hidden="true" className="size-4" />
              Real vector strokes
            </h3>
            <p className="mt-2 text-sm text-muted">
              Drawings are placed as real vector strokes on page content streams.
              Original PDF page content is preserved without rasterization.
            </p>
          </div>
        </div>
      ) : null}

      {status === "error" && failure ? (
        <ErrorState
          title="Drawing failed"
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
        <Button size="lg" onClick={handleDraw} disabled={!canRun}>
          {busy ? (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <Pencil aria-hidden="true" className="size-4" />
          )}
          {busy ? "Drawing..." : "Draw on PDF"}
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

      {status === "success" && result ? (
        <div className="rounded-xl border border-success/40 bg-success-soft/50 p-5">
          <div className="flex items-start gap-3">
            <CheckCircle2
              aria-hidden="true"
              className="mt-0.5 size-5 shrink-0 text-success"
            />
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-semibold text-foreground">
                Drawing complete
              </h3>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
                <FileText aria-hidden="true" className="size-4" />
                <span className="font-medium text-foreground">
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
                  Download edited PDF
                </a>
                <Button variant="secondary" onClick={handleStartOver}>
                  Edit another PDF
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function RadioGroup<T extends string>(props: {
  legend: string;
  name: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; title: string; description: string }[];
  disabled: boolean;
  columns?: 1 | 2 | 3;
}) {
  const { legend, name, value, onChange, options, disabled, columns = 1 } = props;
  return (
    <fieldset
      className={cn(
        "grid gap-3",
        columns === 3 ? "sm:grid-cols-3" : columns === 2 ? "sm:grid-cols-2" : "",
      )}
    >
      <legend className="mb-1 text-sm font-medium text-foreground">{legend}</legend>
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <label
            key={String(option.value)}
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors",
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
