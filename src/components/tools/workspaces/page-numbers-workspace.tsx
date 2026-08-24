"use client";

import { CheckCircle2, Download, FileText, Hash, Loader2 } from "lucide-react";
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
  runPageNumbers,
  type ProcessedDocument,
} from "@/lib/processing/client";
import {
  MAX_FONT_SIZE,
  MAX_START_NUMBER,
  MIN_FONT_SIZE,
  MIN_START_NUMBER,
  type PageNumberFormat,
  type PageNumberPageMode,
  type PageNumberPosition,
} from "@/lib/processing/page-numbers";
import { formatBytes } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

export interface PageNumbersWorkspaceProps {
  /** Server-configured limits, so the UI matches the API exactly. */
  limits: { maxFileSize: number };
}

type Status = "idle" | "reading" | "ready" | "processing" | "success" | "error";

interface FailureState {
  message: string;
  details?: string[];
}

const POSITION_OPTIONS: { value: PageNumberPosition; title: string; description: string }[] = [
  { value: "bottom-left", title: "Bottom left", description: "The classic footer corner." },
  { value: "bottom-center", title: "Bottom center", description: "Centred under the content." },
  { value: "bottom-right", title: "Bottom right", description: "The other classic corner." },
];

const FORMAT_OPTIONS: { value: PageNumberFormat; title: string; description: string }[] = [
  { value: "number", title: "1", description: "Just the number." },
  { value: "page", title: "Page 1", description: "The word, then the number." },
  { value: "page-of", title: "Page 1 of 10", description: "Number plus the real page count." },
];

const PAGE_OPTIONS: { value: PageNumberPageMode; title: string; description: string }[] = [
  { value: "all", title: "All pages", description: "Number every page, sequentially." },
  { value: "first", title: "First page", description: "Number only page 1." },
  { value: "last", title: "Last page", description: "Number only the final page." },
];

function toFailure(error: unknown, fallback: string): FailureState {
  if (error instanceof ProcessingRequestError) {
    return { message: error.message, details: error.details };
  }
  return { message: fallback };
}

/** Is a whole-number input within [min, max]? */
function inRange(raw: string, min: number, max: number): boolean {
  const value = Number(raw);
  return Number.isInteger(value) && value >= min && value <= max;
}

/**
 * Page Numbers workspace.
 *
 * Interaction state only: every option is sent to the server, which validates
 * it again; the numbered-page count in the result comes from the response
 * header — never guessed in the browser.
 */
export function PageNumbersWorkspace({ limits }: PageNumbersWorkspaceProps) {
  const [files, setFiles] = React.useState<SelectedFile[]>([]);
  const [pageCount, setPageCount] = React.useState<number | null>(null);
  const [position, setPosition] = React.useState<PageNumberPosition>("bottom-center");
  const [start, setStart] = React.useState("1");
  const [size, setSize] = React.useState("11");
  const [format, setFormat] = React.useState<PageNumberFormat>("page-of");
  const [pages, setPages] = React.useState<PageNumberPageMode>("all");
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
  const inputsValid =
    inRange(start, MIN_START_NUMBER, MAX_START_NUMBER) &&
    inRange(size, MIN_FONT_SIZE, MAX_FONT_SIZE);
  const canRun =
    Boolean(file) && pageCount !== null && !busy && inputsValid && status !== "error";

  async function handleAdd() {
    if (!canRun || !file) return;

    setResult(null);
    setFailure(null);
    setStatus("processing");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const document = await runPageNumbers({
        file: file.file,
        position,
        start: Number(start),
        fontSize: Number(size),
        format,
        pages,
        signal: controller.signal,
      });
      setResult(document);
      setStatus("success");
      showToast({
        tone: "success",
        title: "Page numbers added",
        description: `${document.numberedPages ?? pageCount} ${
          (document.numberedPages ?? pageCount) === 1 ? "page" : "pages"
        } numbered.`,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setStatus("ready");
        return;
      }
      setFailure(toFailure(error, "The page numbers could not be added."));
      setStatus("error");
    } finally {
      abortRef.current = null;
    }
  }

  function handleStartOver() {
    abortRef.current?.abort();
    setFiles([]);
    setPageCount(null);
    setPosition("bottom-center");
    setStart("1");
    setSize("11");
    setFormat("page-of");
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
            legend="Position"
            name="number-position"
            value={position}
            onChange={setPosition}
            options={POSITION_OPTIONS}
            disabled={busy}
          />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Starting number"
              value={start}
              disabled={busy}
              onChange={(event) => setStart(event.target.value)}
              hint={`Whole number ${MIN_START_NUMBER}-${MAX_START_NUMBER}. Use a higher start when front matter should not count.`}
              error={
                inRange(start, MIN_START_NUMBER, MAX_START_NUMBER)
                  ? undefined
                  : `Enter a whole number between ${MIN_START_NUMBER} and ${MAX_START_NUMBER}.`
              }
              aria-invalid={!inRange(start, MIN_START_NUMBER, MAX_START_NUMBER)}
              inputMode="numeric"
              autoComplete="off"
            />
            <Input
              label="Font size"
              value={size}
              disabled={busy}
              onChange={(event) => setSize(event.target.value)}
              hint={`Whole number ${MIN_FONT_SIZE}-${MAX_FONT_SIZE} pt.`}
              error={
                inRange(size, MIN_FONT_SIZE, MAX_FONT_SIZE)
                  ? undefined
                  : `Enter a whole number between ${MIN_FONT_SIZE} and ${MAX_FONT_SIZE}.`
              }
              aria-invalid={!inRange(size, MIN_FONT_SIZE, MAX_FONT_SIZE)}
              inputMode="numeric"
              autoComplete="off"
            />
          </div>

          <RadioGroup
            legend="Format"
            name="number-format"
            value={format}
            onChange={setFormat}
            options={FORMAT_OPTIONS}
            disabled={busy}
          />
          <RadioGroup
            legend="Pages"
            name="number-pages"
            value={pages}
            onChange={setPages}
            options={PAGE_OPTIONS}
            disabled={busy}
          />

          <div className="rounded-xl border border-border bg-surface p-4">
            <h3 className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
              <Hash aria-hidden="true" className="size-4" />
              What gets added
            </h3>
            <p className="mt-2 text-sm text-muted">
              The numbers are ordinary visible text drawn near the bottom of the
              page — the document itself, its size and its rotation are not
              changed. In the{" "}
              <em>Page 1 of {pageCount}</em> format, the total is always this
              document&rsquo;s real page count
              {Number(start) !== 1
                ? `; with a starting number of ${Number(start)}, later pages can print numbers above it (e.g. Page ${
                    Number(start) + pageCount - 1
                  } of ${pageCount}) — an intentional front-matter offset`
                : ""}
              .
            </p>
          </div>
        </div>
      ) : null}

      {status === "error" && failure ? (
        <ErrorState
          title="Page numbers could not be added"
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
            <Hash aria-hidden="true" className="size-4" />
          )}
          {busy ? "Adding page numbers…" : "Add Page Numbers"}
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
            ? "Adding page numbers. This may take a moment."
            : status === "success" && result
              ? `Page numbers added to ${result.numberedPages ?? pageCount} ${
                  (result.numberedPages ?? pageCount) === 1 ? "page" : "pages"
                }. The PDF is ready to download.`
              : status === "error" && failure
                ? `Adding page numbers failed. ${failure.message}`
                : status === "ready" && pageCount !== null
                  ? `PDF loaded with ${pageCount} pages. Choose the numbering options.`
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
              Adding page numbers…
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
                Page numbers added
              </h3>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
                <FileText aria-hidden="true" className="size-4" />
                <span className="font-medium text-foreground">
                  {result.fileName}
                </span>
                <span>· {formatBytes(result.size)}</span>
                <span>
                  · {result.numberedPages ?? pageCount} of {result.pages ?? pageCount}{" "}
                  {(result.pages ?? pageCount) === 1 ? "page" : "pages"} numbered
                </span>
              </p>
              <p className="mt-2 text-sm text-muted">
                The numbers are ordinary visible text — the document stays a
                real, searchable PDF with its size, rotation and content
                unchanged.
              </p>

              <div className="mt-4 flex flex-wrap gap-3">
                <a
                  href={result.url}
                  download={result.fileName}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:h-10"
                >
                  <Download aria-hidden="true" className="size-4" />
                  Download numbered PDF
                </a>
                <Button variant="secondary" onClick={handleStartOver}>
                  Number another PDF
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

/** Accessible radio group for a numbering option (44px targets, keyboard). */
function RadioGroup<T extends string>(props: {
  legend: string;
  name: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; title: string; description: string }[];
  disabled: boolean;
}) {
  const { legend, name, value, onChange, options, disabled } = props;
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-sm font-medium text-foreground">{legend}</legend>
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <label
            key={option.value}
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
              value={option.value}
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
