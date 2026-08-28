"use client";

import {
  CheckCircle2,
  Download,
  FileText,
  Highlighter,
  Loader2,
  ShieldAlert,
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
  runHighlight,
  type ProcessedDocument,
} from "@/lib/processing/client";
import {
  MIN_HIGHLIGHT_DIMENSION,
  MAX_HIGHLIGHT_DIMENSION,
  type HighlightPageMode,
  type HighlightPlacement,
} from "@/lib/processing/highlight";
import { formatBytes } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

export interface HighlightWorkspaceProps {
  limits: { maxFileSize: number };
}

type Status = "idle" | "reading" | "ready" | "processing" | "success" | "error";

interface FailureState {
  message: string;
  details?: string[];
}

const PLACEMENT_OPTIONS: {
  value: HighlightPlacement;
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

const PAGE_OPTIONS: { value: HighlightPageMode; title: string; description: string }[] = [
  { value: "all", title: "All pages", description: "Highlight area on every page." },
  { value: "first", title: "First page", description: "Highlight area on page 1 only." },
  { value: "last", title: "Last page", description: "Highlight area on final page only." },
];

const HIGHLIGHT_COLORS = [
  { value: "#fef08a", label: "Yellow" },
  { value: "#bbf7d0", label: "Green" },
  { value: "#bfdbfe", label: "Blue" },
  { value: "#fbcfe8", label: "Pink" },
  { value: "#fde68a", label: "Amber" },
];

function toFailure(error: unknown, fallback: string): FailureState {
  if (error instanceof ProcessingRequestError) {
    return { message: error.message, details: error.details };
  }
  return { message: fallback };
}

export function HighlightWorkspace({ limits }: HighlightWorkspaceProps) {
  const [files, setFiles] = React.useState<SelectedFile[]>([]);
  const [pageCount, setPageCount] = React.useState<number | null>(null);
  const [placement, setPlacement] = React.useState<HighlightPlacement>("top-left");
  const [width, setWidth] = React.useState(200);
  const [height, setHeight] = React.useState(24);
  const [color, setColor] = React.useState("#fef08a");
  const [opacity, setOpacity] = React.useState(0.5);
  const [pages, setPages] = React.useState<HighlightPageMode>("all");
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
  const validWidth = Number.isFinite(width) && width >= MIN_HIGHLIGHT_DIMENSION && width <= MAX_HIGHLIGHT_DIMENSION;
  const validHeight = Number.isFinite(height) && height >= MIN_HIGHLIGHT_DIMENSION && height <= MAX_HIGHLIGHT_DIMENSION;
  const validOpacity = Number.isFinite(opacity) && opacity >= 0.05 && opacity <= 1.0;

  const canRun =
    Boolean(file) &&
    pageCount !== null &&
    !busy &&
    validWidth &&
    validHeight &&
    validOpacity &&
    status !== "error";

  async function handleHighlight() {
    if (!canRun || !file) return;

    setResult(null);
    setFailure(null);
    setStatus("processing");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const document = await runHighlight({
        file: file.file,
        placement,
        width,
        height,
        color,
        opacity,
        pages,
        signal: controller.signal,
      });
      setResult(document);
      setStatus("success");
      showToast({
        tone: "success",
        title: "PDF highlighted",
        description: `${document.highlightedPages ?? pageCount} ${
          (document.highlightedPages ?? pageCount) === 1 ? "page" : "pages"
        } highlighted.`,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setStatus("ready");
        return;
      }
      setFailure(toFailure(error, "Highlighting failed."));
      setStatus("error");
    } finally {
      abortRef.current = null;
    }
  }

  function handleStartOver() {
    abortRef.current?.abort();
    setFiles([]);
    setPageCount(null);
    setPlacement("top-left");
    setWidth(200);
    setHeight(24);
    setColor("#fef08a");
    setOpacity(0.5);
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
            legend="Position on page"
            name="highlight-placement"
            value={placement}
            onChange={setPlacement}
            options={PLACEMENT_OPTIONS}
            disabled={busy}
            columns={3}
          />

          <div className="grid gap-4 sm:grid-cols-3">
            <Input
              label="Highlight width (pt)"
              type="number"
              value={String(width)}
              disabled={busy}
              onChange={(e) => setWidth(Number(e.target.value))}
            />
            <Input
              label="Highlight height (pt)"
              type="number"
              value={String(height)}
              disabled={busy}
              onChange={(e) => setHeight(Number(e.target.value))}
            />
            <Input
              label="Opacity (0.1 - 1.0)"
              type="number"
              step="0.1"
              value={String(opacity)}
              disabled={busy}
              onChange={(e) => setOpacity(Number(e.target.value))}
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-foreground">
              Highlight color
            </label>
            <div className="flex flex-wrap gap-2">
              {HIGHLIGHT_COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  disabled={busy}
                  onClick={() => setColor(c.value)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                    color === c.value
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
            name="highlight-pages"
            value={pages}
            onChange={setPages}
            options={PAGE_OPTIONS}
            disabled={busy}
          />

          <div className="rounded-xl border border-border bg-surface p-4">
            <h3 className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
              <ShieldAlert aria-hidden="true" className="size-4" />
              Highlighting is NOT redaction
            </h3>
            <p className="mt-2 text-sm text-muted">
              Highlighting applies a semi-transparent color overlay to mark areas.
              It does NOT remove, erase, sanitize, or redact underlying text or images.
              Do not use Highlighting to hide confidential information.
            </p>
          </div>
        </div>
      ) : null}

      {status === "error" && failure ? (
        <ErrorState
          title="Highlighting failed"
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
        <Button size="lg" onClick={handleHighlight} disabled={!canRun}>
          {busy ? (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <Highlighter aria-hidden="true" className="size-4" />
          )}
          {busy ? "Highlighting…" : "Highlight PDF"}
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
                Highlighting complete
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
                  Download highlighted PDF
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
