"use client";

import {
  CheckCircle2,
  Download,
  FileText,
  Loader2,
  Type,
} from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/states";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { UploadZone, type SelectedFile } from "@/components/upload/upload-zone";
import {
  inspectPdfFile,
  ProcessingRequestError,
  runAddText,
  type ProcessedDocument,
} from "@/lib/processing/client";
import {
  MAX_ADD_TEXT_LENGTH,
  MAX_ADD_TEXT_LINES,
  type AddTextFontSize,
  type AddTextPageMode,
  type AddTextPlacement,
} from "@/lib/processing/add-text";
import { formatBytes } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

export interface AddTextWorkspaceProps {
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

const PLACEMENT_OPTIONS: {
  value: AddTextPlacement;
  title: string;
  description: string;
}[] = [
  { value: "top-left", title: "Top left", description: "Upper-left corner of the page." },
  { value: "top-center", title: "Top center", description: "Centred at the top edge." },
  { value: "top-right", title: "Top right", description: "Upper-right corner of the page." },
  { value: "center-left", title: "Middle left", description: "Centred vertically, left edge." },
  { value: "center", title: "Middle center", description: "The middle of the page." },
  { value: "center-right", title: "Middle right", description: "Centred vertically, right edge." },
  { value: "bottom-left", title: "Bottom left", description: "Lower-left corner of the page." },
  { value: "bottom-center", title: "Bottom center", description: "Centred at the bottom edge." },
  { value: "bottom-right", title: "Bottom right", description: "Lower-right corner of the page." },
];

const SIZE_OPTIONS: {
  value: AddTextFontSize;
  title: string;
  description: string;
}[] = [
  { value: 12, title: "Small (12 pt)", description: "Notes and labels." },
  { value: 16, title: "Medium (16 pt)", description: "Clearly readable lines of text." },
  { value: 24, title: "Large (24 pt)", description: "Headings and call-outs." },
  { value: 36, title: "Extra large (36 pt)", description: "A few words, hard to miss." },
];

const PAGE_OPTIONS: { value: AddTextPageMode; title: string; description: string }[] = [
  { value: "all", title: "All pages", description: "Add the text to every page." },
  { value: "first", title: "First page", description: "Add the text to page 1 only." },
  { value: "last", title: "Last page", description: "Add the text to the final page only." },
];

function toFailure(error: unknown, fallback: string): FailureState {
  if (error instanceof ProcessingRequestError) {
    return { message: error.message, details: error.details };
  }
  return { message: fallback };
}

/**
 * Add Text workspace.
 *
 * Interaction state only: every option is sent to the server, which validates
 * it again, and the stamped-page count in the result comes from the response
 * header — never guessed in the browser.
 */
export function AddTextWorkspace({ limits }: AddTextWorkspaceProps) {
  const [files, setFiles] = React.useState<SelectedFile[]>([]);
  const [pageCount, setPageCount] = React.useState<number | null>(null);
  const [text, setText] = React.useState("");
  const [placement, setPlacement] = React.useState<AddTextPlacement>("top-left");
  const [fontSize, setFontSize] = React.useState<AddTextFontSize>(16);
  const [pages, setPages] = React.useState<AddTextPageMode>("all");
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
  const trimmed = text.trim();
  const lineCount = trimmed === "" ? 0 : trimmed.split("\n").length;
  const textReady =
    trimmed.length > 0 &&
    trimmed.length <= MAX_ADD_TEXT_LENGTH &&
    lineCount <= MAX_ADD_TEXT_LINES;
  const canRun =
    Boolean(file) && pageCount !== null && !busy && textReady && status !== "error";

  async function handleAdd() {
    if (!canRun || !file) return;

    setResult(null);
    setFailure(null);
    setStatus("processing");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const document = await runAddText({
        file: file.file,
        text,
        placement,
        fontSize,
        pages,
        signal: controller.signal,
      });
      setResult(document);
      setStatus("success");
      showToast({
        tone: "success",
        title: "Text added",
        description: `${document.textPages ?? pageCount} ${
          (document.textPages ?? pageCount) === 1 ? "page" : "pages"
        } received the text.`,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setStatus("ready");
        return;
      }
      setFailure(toFailure(error, "The text could not be added."));
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
    setPlacement("top-left");
    setFontSize(16);
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
          <Textarea
            label="Text to add"
            placeholder={"Fragile — handle with care"}
            value={text}
            disabled={busy}
            rows={4}
            onChange={(event) => setText(event.target.value)}
            hint={`Real vector text, standard Latin characters. Up to ${MAX_ADD_TEXT_LENGTH} characters on ${MAX_ADD_TEXT_LINES} lines — ${trimmed.length}/${MAX_ADD_TEXT_LENGTH} characters, ${lineCount}/${MAX_ADD_TEXT_LINES} lines used.`}
            error={
              text.trim().length > MAX_ADD_TEXT_LENGTH
                ? `The text must be ${MAX_ADD_TEXT_LENGTH} characters or fewer.`
                : lineCount > MAX_ADD_TEXT_LINES
                  ? `The text must fit on ${MAX_ADD_TEXT_LINES} lines or fewer.`
                  : undefined
            }
            aria-invalid={!textReady}
            autoComplete="off"
          />

          <RadioGroup
            legend="Position on the page"
            name="add-text-placement"
            value={placement}
            onChange={setPlacement}
            options={PLACEMENT_OPTIONS}
            disabled={busy}
            columns={3}
          />
          <RadioGroup
            legend="Font size"
            name="add-text-size"
            value={fontSize}
            onChange={setFontSize}
            options={SIZE_OPTIONS}
            disabled={busy}
          />
          <RadioGroup
            legend="Pages"
            name="add-text-pages"
            value={pages}
            onChange={setPages}
            options={PAGE_OPTIONS}
            disabled={busy}
          />

          <div className="rounded-xl border border-border bg-surface p-4">
            <h3 className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
              <Type aria-hidden="true" className="size-4" />
              What this adds, honestly
            </h3>
            <p className="mt-2 text-sm text-muted">
              The text is drawn as real, searchable vector text (standard Latin
              characters) at the position you chose — not as an image. Text
              that would overflow the page is scaled down to fit instead of
              being clipped.
            </p>
          </div>
        </div>
      ) : null}

      {status === "error" && failure ? (
        <ErrorState
          title="Text could not be added"
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
            <Type aria-hidden="true" className="size-4" />
          )}
          {busy ? "Adding your text…" : "Add Text"}
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
            ? "Adding your text. This may take a moment."
            : status === "success" && result
              ? `Text added to ${result.textPages ?? pageCount} ${
                  (result.textPages ?? pageCount) === 1 ? "page" : "pages"
                }. The PDF is ready to download.`
              : status === "error" && failure
                ? `Adding the text failed. ${failure.message}`
                : status === "ready" && pageCount !== null
                  ? `PDF loaded with ${pageCount} pages. Enter the text to add.`
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
              Adding your text…
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
                Text added
              </h3>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
                <FileText aria-hidden="true" className="size-4" />
                <span className="font-medium text-foreground">
                  {result.fileName}
                </span>
                <span>· {formatBytes(result.size)}</span>
                <span>
                  · {result.textPages ?? pageCount} of{" "}
                  {result.pages ?? pageCount}{" "}
                  {(result.pages ?? pageCount) === 1 ? "page" : "pages"} received
                  the text
                </span>
                <span>
                  · {result.outputPages ?? pageCount}{" "}
                  {(result.outputPages ?? pageCount) === 1 ? "page" : "pages"},
                  content otherwise unchanged
                </span>
              </p>
              <p className="mt-2 text-sm text-muted">
                The text is vector text drawn on the page — the document stays
                a real, searchable PDF.
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

/** Accessible radio group for an add-text option (44px targets, keyboard). */
function RadioGroup<T extends string | number>(
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
