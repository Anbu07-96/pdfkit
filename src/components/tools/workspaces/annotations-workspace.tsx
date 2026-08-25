"use client";

import {
  CheckCircle2,
  Download,
  FileText,
  Loader2,
  MessageSquare,
  ShieldAlert,
} from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ErrorState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { UploadZone, type SelectedFile } from "@/components/upload/upload-zone";
import {
  inspectPdfFile,
  ProcessingRequestError,
  runAnnotations,
  type ProcessedDocument,
} from "@/lib/processing/client";
import {
  MAX_ANNOTATION_AUTHOR_LENGTH,
  MAX_ANNOTATION_TEXT_LENGTH,
  MAX_ANNOTATION_URL_LENGTH,
  type AnnotationPageMode,
  type AnnotationPlacement,
  type AnnotationType,
} from "@/lib/processing/annotations";
import { formatBytes } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

export interface AnnotationsWorkspaceProps {
  limits: { maxFileSize: number };
}

type Status = "idle" | "reading" | "ready" | "processing" | "success" | "error";

interface FailureState {
  message: string;
  details?: string[];
}

const ANNOTATION_TYPE_OPTIONS: {
  value: AnnotationType;
  title: string;
  description: string;
}[] = [
  {
    value: "comment",
    title: "Comment (Sticky Note)",
    description: "Add a native PDF sticky note comment with an author name.",
  },
  {
    value: "link",
    title: "Link (Hyperlink)",
    description: "Add a clickable web URL link annotation.",
  },
];

const PLACEMENT_OPTIONS: {
  value: AnnotationPlacement;
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

const PAGE_OPTIONS: {
  value: AnnotationPageMode;
  title: string;
  description: string;
}[] = [
  { value: "all", title: "All pages", description: "Add annotation to every page." },
  { value: "first", title: "First page", description: "Add annotation to page 1 only." },
  { value: "last", title: "Last page", description: "Add annotation to final page only." },
];

function toFailure(error: unknown, fallback: string): FailureState {
  if (error instanceof ProcessingRequestError) {
    return { message: error.message, details: error.details };
  }
  return { message: fallback };
}

export function AnnotationsWorkspace({ limits }: AnnotationsWorkspaceProps) {
  const [files, setFiles] = React.useState<SelectedFile[]>([]);
  const [pageCount, setPageCount] = React.useState<number | null>(null);
  const [type, setType] = React.useState<AnnotationType>("comment");
  const [placement, setPlacement] = React.useState<AnnotationPlacement>("top-left");
  const [text, setText] = React.useState("");
  const [author, setAuthor] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [width, setWidth] = React.useState(150);
  const [height, setHeight] = React.useState(30);
  const [pages, setPages] = React.useState<AnnotationPageMode>("all");
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
  const validComment =
    type === "comment" &&
    text.trim().length > 0 &&
    text.trim().length <= MAX_ANNOTATION_TEXT_LENGTH &&
    author.trim().length <= MAX_ANNOTATION_AUTHOR_LENGTH;

  const validLink =
    type === "link" &&
    url.trim().length > 0 &&
    url.trim().length <= MAX_ANNOTATION_URL_LENGTH &&
    /^https?:\/\//i.test(url.trim());

  const canRun =
    Boolean(file) &&
    pageCount !== null &&
    !busy &&
    (validComment || validLink) &&
    status !== "error";

  async function handleAddAnnotation() {
    if (!canRun || !file) return;

    setResult(null);
    setFailure(null);
    setStatus("processing");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const document = await runAnnotations({
        file: file.file,
        type,
        placement,
        text,
        author,
        url,
        width: type === "comment" ? 30 : width,
        height: type === "comment" ? 30 : height,
        pages,
        signal: controller.signal,
      });
      setResult(document);
      setStatus("success");
      showToast({
        tone: "success",
        title: "Annotation added",
        description: `${document.annotatedPages ?? pageCount} ${
          (document.annotatedPages ?? pageCount) === 1 ? "page" : "pages"
        } annotated.`,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setStatus("ready");
        return;
      }
      setFailure(toFailure(error, "The annotation could not be added."));
      setStatus("error");
    } finally {
      abortRef.current = null;
    }
  }

  function handleStartOver() {
    abortRef.current?.abort();
    setFiles([]);
    setPageCount(null);
    setType("comment");
    setPlacement("top-left");
    setText("");
    setAuthor("");
    setUrl("");
    setWidth(150);
    setHeight(30);
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
            legend="Annotation type"
            name="annotation-type"
            value={type}
            onChange={setType}
            options={ANNOTATION_TYPE_OPTIONS}
            disabled={busy}
            columns={2}
          />

          <RadioGroup
            legend="Position on page"
            name="annotation-placement"
            value={placement}
            onChange={setPlacement}
            options={PLACEMENT_OPTIONS}
            disabled={busy}
            columns={3}
          />

          {type === "comment" ? (
            <div className="flex flex-col gap-4">
              <Textarea
                label="Comment text"
                placeholder="Enter feedback or notes for review..."
                value={text}
                disabled={busy}
                rows={3}
                onChange={(e) => setText(e.target.value)}
                hint={`Up to ${MAX_ANNOTATION_TEXT_LENGTH} characters.`}
              />
              <Input
                label="Author / Reviewer name (optional)"
                placeholder="e.g. Reviewer A"
                value={author}
                disabled={busy}
                onChange={(e) => setAuthor(e.target.value)}
              />
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <Input
                label="Target URL"
                placeholder="https://example.com"
                value={url}
                disabled={busy}
                onChange={(e) => setUrl(e.target.value)}
                hint="Must start with http:// or https://"
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="Link box width (pt)"
                  type="number"
                  value={String(width)}
                  disabled={busy}
                  onChange={(e) => setWidth(Number(e.target.value))}
                />
                <Input
                  label="Link box height (pt)"
                  type="number"
                  value={String(height)}
                  disabled={busy}
                  onChange={(e) => setHeight(Number(e.target.value))}
                />
              </div>
            </div>
          )}

          <RadioGroup
            legend="Target pages"
            name="annotation-pages"
            value={pages}
            onChange={setPages}
            options={PAGE_OPTIONS}
            disabled={busy}
          />

          <div className="rounded-xl border border-border bg-surface p-4">
            <h3 className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
              <ShieldAlert aria-hidden="true" className="size-4" />
              Native PDF Annotations
            </h3>
            <p className="mt-2 text-sm text-muted">
              Annotations are embedded directly into the document structure according to the PDF specification.
              Comments appear as sticky notes in PDF viewers; links open external URLs. Annotations do NOT alter or redact underlying page text.
            </p>
          </div>
        </div>
      ) : null}

      {status === "error" && failure ? (
        <ErrorState
          title="Annotation could not be added"
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
        <Button size="lg" onClick={handleAddAnnotation} disabled={!canRun}>
          {busy ? (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <MessageSquare aria-hidden="true" className="size-4" />
          )}
          {busy ? "Adding annotation…" : "Add Annotation"}
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
                Annotation added
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
