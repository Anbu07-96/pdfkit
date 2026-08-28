"use client";

import {
  CheckCircle2,
  Download,
  Eye,
  EyeOff,
  FileText,
  Info,
  Loader2,
  ShieldAlert,
  Unlock,
} from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { UploadZone, type SelectedFile } from "@/components/upload/upload-zone";
import {
  inspectPdfFile,
  ProcessingRequestError,
  runUnlockPdf,
  type ProcessedDocument,
} from "@/lib/processing/client";
import { MAX_UNLOCK_PASSWORD_LENGTH } from "@/lib/processing/unlock-pdf";
import { formatBytes } from "@/lib/utils/format";

export interface UnlockPdfWorkspaceProps {
  /** Server-configured limits, so the UI matches the API exactly. */
  limits: { maxFileSize: number };
}

type Status =
  | "idle"
  | "reading"
  | "ready"
  | "unprotected"
  | "processing"
  | "success"
  | "error";

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
 * Unlock PDF workspace.
 *
 * Interaction state only. On upload the file is inspected on the server: a
 * PDF that opens plainly has nothing to unlock (and says so), while one that
 * refuses with `ENCRYPTED_PDF` is confirmed protected. The password — when the
 * file needs one — is sent once, as a multipart field, and the server
 * validates and authenticates it there. It is never logged, stored or shown
 * back.
 */
export function UnlockPdfWorkspace({ limits }: UnlockPdfWorkspaceProps) {
  const [files, setFiles] = React.useState<SelectedFile[]>([]);
  const [password, setPassword] = React.useState("");
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

  /**
   * Inspect the upload on the server. Three honest outcomes:
   * - it opens → there is no protection to remove (`unprotected`);
   * - it refuses as encrypted → confirmed protected, ask for the password;
   * - it cannot be read → error, never a guess.
   */
  async function handleFilesChange(next: SelectedFile[]) {
    abortRef.current?.abort();
    abortRef.current = null;

    setFiles(next);
    setResult(null);
    setFailure(null);

    const chosen = next[0];
    if (!chosen) {
      setStatus("idle");
      return;
    }

    setStatus("reading");
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await inspectPdfFile(chosen.file, controller.signal);
      setStatus("unprotected");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (
        error instanceof ProcessingRequestError &&
        error.code === "ENCRYPTED_PDF"
      ) {
        setStatus("ready");
      } else {
        setFailure(toFailure(error, "This PDF could not be read."));
        setStatus("error");
      }
    } finally {
      abortRef.current = null;
    }
  }

  const busy = status === "processing";
  const passwordReady = password.length <= MAX_UNLOCK_PASSWORD_LENGTH;
  const canRun = Boolean(file) && status === "ready" && !busy && passwordReady;

  async function handleUnlock() {
    if (!canRun || !file) return;

    setResult(null);
    setFailure(null);
    setStatus("processing");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const document = await runUnlockPdf({
        file: file.file,
        password,
        signal: controller.signal,
      });
      setResult(document);
      setStatus("success");
      setPassword("");
      showToast({
        tone: "success",
        title: "PDF unlocked",
        description: "The password protection has been removed.",
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setStatus("ready");
        return;
      }
      setFailure(toFailure(error, "The PDF could not be unlocked."));
      setStatus("error");
    } finally {
      abortRef.current = null;
    }
  }

  function handleStartOver() {
    abortRef.current?.abort();
    setFiles([]);
    setPassword("");
    setShowPassword(false);
    setResult(null);
    setFailure(null);
    setStatus("idle");
  }

  return (
    <div className="flex flex-col gap-5">
      <UploadZone
        label="Upload a protected PDF"
        hint="Drag and drop a password-protected PDF here, or browse from your device."
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
          {status === "reading" ? (
            <span className="inline-flex items-center gap-1.5">
              <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
              Checking protection…
            </span>
          ) : null}
        </div>
      ) : null}

      {file && status === "unprotected" ? (
        <div className="flex items-start gap-3 rounded-xl border border-border bg-surface p-4">
          <Info aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" />
          <div>
            <h3 className="text-sm font-medium text-foreground">
              This PDF is not protected
            </h3>
            <p className="mt-1 text-sm text-muted">
              The server opened it without a password, so there is nothing to
              remove. Only files that genuinely require a password can be
              unlocked.
            </p>
          </div>
        </div>
      ) : null}

      {file && (status === "ready" || busy || status === "success") ? (
        <div className="flex flex-col gap-5">
          <Input
            label="Password"
            type={showPassword ? "text" : "password"}
            placeholder="The password for this file"
            value={password}
            disabled={busy || status === "success"}
            onChange={(event) => setPassword(event.target.value)}
            hint={`Enter the password you already have. Up to ${MAX_UNLOCK_PASSWORD_LENGTH} characters, used exactly as typed and never stored. Leave empty only if the file opens without asking but is restricted.`}
            aria-invalid={!passwordReady}
            autoComplete="off"
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

          <div className="rounded-xl border border-border bg-surface p-4">
            <h3 className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
              <ShieldAlert aria-hidden="true" className="size-4" />
              For files you own, with the password you have
            </h3>
            <p className="mt-2 text-sm text-muted">
              This authenticates the password you type and removes the
              protection — it cannot recover or guess a lost password. RC4
              protected files are supported (40-bit and 128-bit, including
              files from our Password Protect tool); AES-protected files are
              not supported yet, and the result will say so.
            </p>
          </div>
        </div>
      ) : null}

      {status === "error" && failure ? (
        <ErrorState
          title="PDF could not be unlocked"
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
        <Button size="lg" onClick={handleUnlock} disabled={!canRun}>
          {busy ? (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <Unlock aria-hidden="true" className="size-4" />
          )}
          {busy ? "Unlocking your PDF…" : "Unlock PDF"}
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
          <p className="text-sm text-muted">Upload a protected PDF to get started.</p>
        ) : null}
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {status === "reading"
          ? "Checking whether the PDF is protected."
          : status === "processing"
            ? "Unlocking your PDF. This may take a moment."
            : status === "success" && result
              ? "The PDF is unlocked and ready to download."
              : status === "error" && failure
                ? `Unlocking the PDF failed. ${failure.message}`
                : status === "ready"
                  ? "The PDF is protected. Enter its password to unlock it."
                  : status === "unprotected"
                    ? "This PDF is not protected. There is nothing to remove."
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
              Unlocking your PDF…
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
                PDF unlocked
              </h3>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
                <FileText aria-hidden="true" className="size-4" />
                <span className="font-medium text-foreground">
                  {result.fileName}
                </span>
                <span>· {formatBytes(result.size)}</span>
                <span>
                  · {result.outputPages ?? result.pages}{" "}
                  {(result.outputPages ?? result.pages) === 1 ? "page" : "pages"},
                  content unchanged
                </span>
              </p>
              <p className="mt-2 text-sm text-muted">
                The server verified the result: the password was authenticated
                and the document now opens without it. Every page is unchanged
                — only the protection was removed.
              </p>

              <div className="mt-4 flex flex-wrap gap-3">
                <a
                  href={result.url}
                  download={result.fileName}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:h-10"
                >
                  <Download aria-hidden="true" className="size-4" />
                  Download unlocked PDF
                </a>
                <Button variant="secondary" onClick={handleStartOver}>
                  Unlock another PDF
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
