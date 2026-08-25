"use client";

import {
  CheckCircle2,
  Download,
  FileText,
  Image as ImageIcon,
  Loader2,
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
  runAddImages,
  type ProcessedDocument,
} from "@/lib/processing/client";
import {
  MIN_IMAGE_DIMENSION,
  MAX_IMAGE_DIMENSION,
  type AddImagePageMode,
  type AddImagePlacement,
} from "@/lib/processing/add-images";
import { formatBytes } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

export interface AddImagesWorkspaceProps {
  limits: { maxFileSize: number };
}

type Status = "idle" | "reading" | "ready" | "processing" | "success" | "error";

interface FailureState {
  message: string;
  details?: string[];
}

const PLACEMENT_OPTIONS: {
  value: AddImagePlacement;
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

const PAGE_OPTIONS: { value: AddImagePageMode; title: string; description: string }[] = [
  { value: "all", title: "All pages", description: "Add image to every page." },
  { value: "first", title: "First page", description: "Add image to page 1 only." },
  { value: "last", title: "Last page", description: "Add image to final page only." },
];

function toFailure(error: unknown, fallback: string): FailureState {
  if (error instanceof ProcessingRequestError) {
    return { message: error.message, details: error.details };
  }
  return { message: fallback };
}

export function AddImagesWorkspace({ limits }: AddImagesWorkspaceProps) {
  const [files, setFiles] = React.useState<SelectedFile[]>([]);
  const [imageFiles, setImageFiles] = React.useState<SelectedFile[]>([]);
  const [pageCount, setPageCount] = React.useState<number | null>(null);
  const [placement, setPlacement] = React.useState<AddImagePlacement>("center");
  const [width, setWidth] = React.useState(150);
  const [height, setHeight] = React.useState(150);
  const [preserveAspect, setPreserveAspect] = React.useState(true);
  const [pages, setPages] = React.useState<AddImagePageMode>("all");
  const [status, setStatus] = React.useState<Status>("idle");
  const [result, setResult] = React.useState<ProcessedDocument | null>(null);
  const [failure, setFailure] = React.useState<FailureState | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);
  const { showToast } = useToast();

  const file = files[0] ?? null;
  const imageFile = imageFiles[0] ?? null;

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
  const validWidth = Number.isFinite(width) && width >= MIN_IMAGE_DIMENSION && width <= MAX_IMAGE_DIMENSION;
  const validHeight = Number.isFinite(height) && height >= MIN_IMAGE_DIMENSION && height <= MAX_IMAGE_DIMENSION;

  const canRun =
    Boolean(file) &&
    Boolean(imageFile) &&
    pageCount !== null &&
    !busy &&
    validWidth &&
    validHeight &&
    status !== "error";

  async function handleAdd() {
    if (!canRun || !file || !imageFile) return;

    setResult(null);
    setFailure(null);
    setStatus("processing");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const document = await runAddImages({
        pdfFile: file.file,
        imageFile: imageFile.file,
        placement,
        width,
        height,
        preserveAspectRatio: preserveAspect,
        pages,
        signal: controller.signal,
      });
      setResult(document);
      setStatus("success");
      showToast({
        tone: "success",
        title: "Image added",
        description: `${document.imagePages ?? pageCount} ${
          (document.imagePages ?? pageCount) === 1 ? "page" : "pages"
        } received the image.`,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setStatus("ready");
        return;
      }
      setFailure(toFailure(error, "The image could not be added."));
      setStatus("error");
    } finally {
      abortRef.current = null;
    }
  }

  function handleStartOver() {
    abortRef.current?.abort();
    setFiles([]);
    setImageFiles([]);
    setPageCount(null);
    setPlacement("center");
    setWidth(150);
    setHeight(150);
    setPreserveAspect(true);
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
          <UploadZone
            label="Upload an Image to insert (JPG or PNG)"
            hint="Select a logo, photo, or stamp to insert into the document."
            files={imageFiles}
            onFilesChange={setImageFiles}
            multiple={false}
            maxFiles={1}
            busy={busy}
            extensions={[".jpg", ".jpeg", ".png"]}
            mimeTypes={["image/jpeg", "image/png"]}
            maxFileSize={limits.maxFileSize}
          />

          {imageFile ? (
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
              <ImageIcon aria-hidden="true" className="size-4" />
              <span className="font-medium break-all text-foreground">{imageFile.name}</span>
              <span>· {formatBytes(imageFile.size)}</span>
            </div>
          ) : null}

          <RadioGroup
            legend="Position on page"
            name="add-image-placement"
            value={placement}
            onChange={setPlacement}
            options={PLACEMENT_OPTIONS}
            disabled={busy}
            columns={3}
          />

          <div className="grid gap-4 sm:grid-cols-2">
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
          </div>

          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={preserveAspect}
              disabled={busy}
              onChange={(e) => setPreserveAspect(e.target.checked)}
              className="size-4 rounded accent-[var(--color-primary)]"
            />
            Preserve image aspect ratio
          </label>

          <RadioGroup
            legend="Target pages"
            name="add-image-pages"
            value={pages}
            onChange={setPages}
            options={PAGE_OPTIONS}
            disabled={busy}
          />
        </div>
      ) : null}

      {status === "error" && failure ? (
        <ErrorState
          title="Image could not be added"
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
            <ImageIcon aria-hidden="true" className="size-4" />
          )}
          {busy ? "Adding image…" : "Add Image"}
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
                Image added
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
