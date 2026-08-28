"use client";

import {
  CheckCircle2,
  Download,
  Eye,
  EyeOff,
  FileText,
  Loader2,
  Lock,
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
  runPasswordProtect,
  type ProcessedDocument,
} from "@/lib/processing/client";
import {
  isProtectPasswordAcceptable,
  MAX_PROTECT_PASSWORD_LENGTH,
} from "@/lib/processing/password-protect";
import { formatBytes } from "@/lib/utils/format";

export interface PasswordProtectWorkspaceProps {
  /** Server-configured limits, so the UI matches the API exactly. */
  limits: { maxFileSize: number };
}

type Status = "idle" | "reading" | "ready" | "processing" | "success" | "error";

interface FailureState {
  message: string;
  details?: string[];
}

function toFailure(error: unknown, fallback: string): FailureState {
  if (error instanceof ProcessingRequestError) {
    return { message: error.message, details: error.details };
  }
  return { message: fallback };
}

/**
 * Password Protect workspace.
 *
 * Interaction state only: the password is sent once, as a multipart field,
 * and the server validates it again before encrypting. The confirmation field
 * never leaves the browser — it only guards against typos. Nothing about the
 * password is logged, stored or shown back.
 */
export function PasswordProtectWorkspace({ limits }: PasswordProtectWorkspaceProps) {
  const [files, setFiles] = React.useState<SelectedFile[]>([]);
  const [pageCount, setPageCount] = React.useState<number | null>(null);
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
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
  const passwordReady = isProtectPasswordAcceptable(password);
  const passwordsMatch = password === confirm;
  const confirmTouched = confirm.length > 0;
  const canRun =
    Boolean(file) &&
    pageCount !== null &&
    !busy &&
    passwordReady &&
    passwordsMatch &&
    status !== "error";

  async function handleProtect() {
    if (!canRun || !file) return;

    setResult(null);
    setFailure(null);
    setStatus("processing");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      // Only the password is sent. The confirmation field stays in the browser.
      const document = await runPasswordProtect({
        file: file.file,
        password,
        signal: controller.signal,
      });
      setResult(document);
      setStatus("success");
      setPassword("");
      setConfirm("");
      showToast({
        tone: "success",
        title: "PDF protected",
        description: "Opening the document now asks for the password.",
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setStatus("ready");
        return;
      }
      setFailure(toFailure(error, "The PDF could not be protected."));
      setStatus("error");
    } finally {
      abortRef.current = null;
    }
  }

  function handleStartOver() {
    abortRef.current?.abort();
    setFiles([]);
    setPageCount(null);
    setPassword("");
    setConfirm("");
    setShowPassword(false);
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
            label="Password"
            type={showPassword ? "text" : "password"}
            placeholder="The password readers will need"
            value={password}
            disabled={busy}
            onChange={(event) => setPassword(event.target.value)}
            hint={`Up to ${MAX_PROTECT_PASSWORD_LENGTH} characters, standard Latin letters, digits and punctuation. Used exactly as typed and never stored.`}
            aria-invalid={!passwordReady}
            autoComplete="new-password"
            trailingSlot={
              <button
                type="button"
                onClick={() => setShowPassword((shown) => !shown)}
                aria-label={showPassword ? "Hide the password" : "Show the password"}
                aria-pressed={showPassword}
                className="rounded p-1 text-subtle transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
              >
                {showPassword ? (
                  <EyeOff aria-hidden="true" className="size-4" />
                ) : (
                  <Eye aria-hidden="true" className="size-4" />
                )}
              </button>
            }
          />

          <Input
            label="Confirm password"
            type={showPassword ? "text" : "password"}
            placeholder="Type the same password again"
            value={confirm}
            disabled={busy}
            onChange={(event) => setConfirm(event.target.value)}
            error={
              confirmTouched && !passwordsMatch
                ? "The passwords do not match."
                : undefined
            }
            aria-invalid={confirmTouched && !passwordsMatch}
            autoComplete="new-password"
          />

          <div className="rounded-xl border border-border bg-surface p-4">
            <h3 className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
              <ShieldAlert aria-hidden="true" className="size-4" />
              Real protection, honestly described
            </h3>
            <p className="mt-2 text-sm text-muted">
              The document is encrypted with RC4 128-bit (the classic PDF
              Standard Security scheme) — opening it genuinely requires the
              password. It is not AES-256: RC4 is the widely compatible older
              scheme and is less resistant to a determined attack. For highly
              sensitive documents, prefer a dedicated encrypted channel.
            </p>
            <p className="mt-2 text-sm text-muted">
              Your password is used in memory for this request only. It is never
              stored, logged or shown again — if you lose it, the PDF cannot be
              recovered here.
            </p>
          </div>
        </div>
      ) : null}

      {status === "error" && failure ? (
        <ErrorState
          title="PDF could not be protected"
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
        <Button size="lg" onClick={handleProtect} disabled={!canRun}>
          {busy ? (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <Lock aria-hidden="true" className="size-4" />
          )}
          {busy ? "Protecting your PDF…" : "Protect PDF"}
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
            ? "Encrypting your PDF. This may take a moment."
            : status === "success" && result
              ? "The PDF is protected and ready to download."
              : status === "error" && failure
                ? `Protecting the PDF failed. ${failure.message}`
                : status === "ready" && pageCount !== null
                  ? `PDF loaded with ${pageCount} pages. Choose a password.`
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
              Protecting your PDF…
            </p>
            <p className="text-sm text-muted">
              Your file and password are used in memory on the server and
              discarded as soon as the result is returned. Cancelling stops the
              download; work that already started may finish on the server.
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
                PDF protected
              </h3>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
                <FileText aria-hidden="true" className="size-4" />
                <span className="font-medium text-foreground">
                  {result.fileName}
                </span>
                <span>· {formatBytes(result.size)}</span>
                <span>
                  · {result.outputPages ?? pageCount}{" "}
                  {(result.outputPages ?? pageCount) === 1 ? "page" : "pages"},
                  content unchanged
                </span>
              </p>
              <p className="mt-2 text-sm text-muted">
                The server verified the result: the document refuses to open
                without the password, and the password you set opens it again.
                Encryption is RC4 128-bit — real, but not AES-256.
              </p>

              <div className="mt-4 flex flex-wrap gap-3">
                <a
                  href={result.url}
                  download={result.fileName}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:h-10"
                >
                  <Download aria-hidden="true" className="size-4" />
                  Download protected PDF
                </a>
                <Button variant="secondary" onClick={handleStartOver}>
                  Protect another PDF
                </Button>
              </div>

              <p className="mt-3 text-xs text-subtle">
                The download link points at the file in your browser&rsquo;s
                memory. It disappears when you leave or reload this page. Keep
                your password somewhere safe — it is not stored anywhere here.
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
