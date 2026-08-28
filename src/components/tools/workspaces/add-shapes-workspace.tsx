"use client";

import {
  CheckCircle2,
  Download,
  FileText,
  Loader2,
  Shapes,
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
  runAddShapes,
  type ProcessedDocument,
} from "@/lib/processing/client";
import {
  MIN_SHAPE_DIMENSION,
  MAX_SHAPE_DIMENSION,
  MIN_STROKE_WIDTH,
  MAX_STROKE_WIDTH,
  type AddShapePageMode,
  type AddShapePlacement,
  type AddShapeType,
} from "@/lib/processing/add-shapes";
import { formatBytes } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

export interface AddShapesWorkspaceProps {
  limits: { maxFileSize: number };
}

type Status = "idle" | "reading" | "ready" | "processing" | "success" | "error";

interface FailureState {
  message: string;
  details?: string[];
}

interface OptionGroup<T extends string> {
  legend: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; title: string; description: string }[];
}

const SHAPE_OPTIONS: { value: AddShapeType; title: string; description: string }[] = [
  { value: "rectangle", title: "Rectangle", description: "Box with customizable width and height." },
  { value: "circle", title: "Circle", description: "Symmetric circle with equal width and height." },
  { value: "ellipse", title: "Ellipse", description: "Oval shape with customizable radii." },
  { value: "line", title: "Line", description: "Straight line connecting anchor coordinates." },
];

const PLACEMENT_OPTIONS: {
  value: AddShapePlacement;
  title: string;
  description: string;
}[] = [
  { value: "top-left", title: "Top left", description: "Upper-left corner." },
  { value: "top-center", title: "Top center", description: "Centred at top edge." },
  { value: "top-right", title: "Top right", description: "Upper-right corner." },
  { value: "center-left", title: "Middle left", description: "Centred left edge." },
  { value: "center", title: "Middle center", description: "Page center." },
  { value: "center-right", title: "Middle right", description: "Centred right edge." },
  { value: "bottom-left", title: "Bottom left", description: "Lower-left corner." },
  { value: "bottom-center", title: "Bottom center", description: "Centred bottom edge." },
  { value: "bottom-right", title: "Bottom right", description: "Lower-right corner." },
];

const PAGE_OPTIONS: { value: AddShapePageMode; title: string; description: string }[] = [
  { value: "all", title: "All pages", description: "Add the shape to every page." },
  { value: "first", title: "First page", description: "Add the shape to page 1 only." },
  { value: "last", title: "Last page", description: "Add the shape to the final page only." },
];

const STROKE_COLORS = [
  { value: "#000000", label: "Black" },
  { value: "#2563eb", label: "Blue" },
  { value: "#dc2626", label: "Red" },
  { value: "#16a34a", label: "Green" },
  { value: "#d97706", label: "Amber" },
  { value: "none", label: "None" },
];

const FILL_COLORS = [
  { value: "transparent", label: "Transparent" },
  { value: "#e0e7ff", label: "Soft Blue" },
  { value: "#fee2e2", label: "Soft Red" },
  { value: "#dcfce7", label: "Soft Green" },
  { value: "#ffffff", label: "White" },
  { value: "#000000", label: "Black" },
];

function toFailure(error: unknown, fallback: string): FailureState {
  if (error instanceof ProcessingRequestError) {
    return { message: error.message, details: error.details };
  }
  return { message: fallback };
}

export function AddShapesWorkspace({ limits }: AddShapesWorkspaceProps) {
  const [files, setFiles] = React.useState<SelectedFile[]>([]);
  const [pageCount, setPageCount] = React.useState<number | null>(null);
  const [shape, setShape] = React.useState<AddShapeType>("rectangle");
  const [placement, setPlacement] = React.useState<AddShapePlacement>("center");
  const [width, setWidth] = React.useState(120);
  const [height, setHeight] = React.useState(80);
  const [strokeWidth, setStrokeWidth] = React.useState(2);
  const [strokeColor, setStrokeColor] = React.useState("#000000");
  const [fillColor, setFillColor] = React.useState("transparent");
  const [pages, setPages] = React.useState<AddShapePageMode>("all");
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
  const validWidth = Number.isFinite(width) && width >= MIN_SHAPE_DIMENSION && width <= MAX_SHAPE_DIMENSION;
  const validHeight = Number.isFinite(height) && height >= MIN_SHAPE_DIMENSION && height <= MAX_SHAPE_DIMENSION;
  const validStroke = Number.isFinite(strokeWidth) && strokeWidth >= MIN_STROKE_WIDTH && strokeWidth <= MAX_STROKE_WIDTH;

  const isStrokeNone = strokeColor === "none" || strokeWidth === 0;
  const isFillNone = fillColor === "transparent" || fillColor === "none";
  const validColors = shape === "line" ? !isStrokeNone : !(isStrokeNone && isFillNone);

  const canRun =
    Boolean(file) &&
    pageCount !== null &&
    !busy &&
    validWidth &&
    validHeight &&
    validStroke &&
    validColors &&
    status !== "error";

  async function handleAdd() {
    if (!canRun || !file) return;

    setResult(null);
    setFailure(null);
    setStatus("processing");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const document = await runAddShapes({
        file: file.file,
        shape,
        placement,
        width,
        height,
        strokeWidth,
        strokeColor,
        fillColor,
        pages,
        signal: controller.signal,
      });
      setResult(document);
      setStatus("success");
      showToast({
        tone: "success",
        title: "Shape added",
        description: `${document.shapePages ?? pageCount} ${
          (document.shapePages ?? pageCount) === 1 ? "page" : "pages"
        } received the shape.`,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setStatus("ready");
        return;
      }
      setFailure(toFailure(error, "The shape could not be added."));
      setStatus("error");
    } finally {
      abortRef.current = null;
    }
  }

  function handleStartOver() {
    abortRef.current?.abort();
    setFiles([]);
    setPageCount(null);
    setShape("rectangle");
    setPlacement("center");
    setWidth(120);
    setHeight(80);
    setStrokeWidth(2);
    setStrokeColor("#000000");
    setFillColor("transparent");
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
            legend="Shape type"
            name="add-shape-type"
            value={shape}
            onChange={setShape}
            options={SHAPE_OPTIONS}
            disabled={busy}
            columns={2}
          />

          <RadioGroup
            legend="Position on page"
            name="add-shape-placement"
            value={placement}
            onChange={setPlacement}
            options={PLACEMENT_OPTIONS}
            disabled={busy}
            columns={3}
          />

          <div className="grid gap-4 sm:grid-cols-3">
            <Input
              label={shape === "circle" ? "Diameter (pt)" : "Width (pt)"}
              type="number"
              value={String(width)}
              disabled={busy}
              onChange={(e) => setWidth(Number(e.target.value))}
              hint="Width in points"
            />
            {shape !== "circle" ? (
              <Input
                label="Height (pt)"
                type="number"
                value={String(height)}
                disabled={busy}
                onChange={(e) => setHeight(Number(e.target.value))}
                hint="Height in points"
              />
            ) : null}
            <Input
              label="Stroke width (pt)"
              type="number"
              value={String(strokeWidth)}
              disabled={busy}
              onChange={(e) => setStrokeWidth(Number(e.target.value))}
              hint="Border thickness (0 = none)"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
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
                    {c.value !== "none" ? (
                      <span
                        className="size-3.5 rounded-full border border-border"
                        style={{ backgroundColor: c.value }}
                      />
                    ) : null}
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            {shape !== "line" ? (
              <div>
                <label className="mb-2 block text-sm font-medium text-foreground">
                  Fill color
                </label>
                <div className="flex flex-wrap gap-2">
                  {FILL_COLORS.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      disabled={busy}
                      onClick={() => setFillColor(c.value)}
                      className={cn(
                        "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                        fillColor === c.value
                          ? "border-primary bg-primary-soft text-primary-foreground"
                          : "border-border bg-surface text-foreground hover:border-border-strong",
                      )}
                    >
                      {c.value !== "transparent" && c.value !== "none" ? (
                        <span
                          className="size-3.5 rounded-full border border-border"
                          style={{ backgroundColor: c.value }}
                        />
                      ) : null}
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <RadioGroup
            legend="Target pages"
            name="add-shape-pages"
            value={pages}
            onChange={setPages}
            options={PAGE_OPTIONS}
            disabled={busy}
          />

          <div className="rounded-xl border border-border bg-surface p-4">
            <h3 className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
              <Shapes aria-hidden="true" className="size-4" />
              Real vector shapes, strictly bounded
            </h3>
            <p className="mt-2 text-sm text-muted">
              Shapes are drawn as real PDF vector content on the selected pages.
              Shapes are constrained to stay within page boundaries and never overflow off the page.
            </p>
          </div>
        </div>
      ) : null}

      {status === "error" && failure ? (
        <ErrorState
          title="Shape could not be added"
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
            <Shapes aria-hidden="true" className="size-4" />
          )}
          {busy ? "Adding shape…" : "Add Shape"}
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
                Shape added
              </h3>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
                <FileText aria-hidden="true" className="size-4" />
                <span className="font-medium text-foreground">
                  {result.fileName}
                </span>
                <span>· {formatBytes(result.size)}</span>
                <span>
                  · {result.shapePages ?? pageCount} of{" "}
                  {result.pages ?? pageCount}{" "}
                  {(result.pages ?? pageCount) === 1 ? "page" : "pages"} received
                  the shape
                </span>
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

function RadioGroup<T extends string>(
  props: OptionGroup<T> & { name: string; disabled: boolean; columns?: 1 | 2 | 3 },
) {
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
