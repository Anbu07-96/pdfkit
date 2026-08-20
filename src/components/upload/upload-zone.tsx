"use client";

import { CloudUpload, Lock } from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/states";
import { FileCard } from "@/components/upload/file-card";
import {
  buildAcceptAttribute,
  validateFiles,
  type FileConstraints,
  type FileRejection,
} from "@/lib/upload/file-validation";
import { formatBytes, formatExtensionList } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

export interface SelectedFile {
  id: string;
  file: File;
  name: string;
  size: number;
  type: string;
}

export interface UploadZoneProps extends FileConstraints {
  /** Accessible label describing what should be uploaded. */
  label?: string;
  hint?: string;
  multiple?: boolean;
  disabled?: boolean;
  /**
   * Explains why selection is unavailable. Rendered instead of the browse
   * control so users are never misled into thinking a tool works.
   */
  disabledReason?: React.ReactNode;
  /** Short badge shown in the corner, e.g. "Coming soon". */
  disabledBadge?: string;
  /** Notifies the page about the current selection. Never processes files. */
  onFilesChange?: (files: SelectedFile[]) => void;
  className?: string;
}

let fileCounter = 0;
function nextFileId() {
  fileCounter += 1;
  return `file-${fileCounter}-${Date.now().toString(36)}`;
}

/**
 * Reusable file selection area.
 *
 * It is intentionally *only* a selection surface: it validates and lists files
 * and nothing else. It has no knowledge of PDF processing, uploading or any
 * backend, so it can be reused unchanged once real tools are implemented.
 */
export function UploadZone({
  label = "Upload your files",
  hint,
  multiple = true,
  disabled = false,
  disabledReason,
  disabledBadge,
  onFilesChange,
  className,
  extensions,
  mimeTypes,
  maxFileSize,
  maxFiles,
}: UploadZoneProps) {
  const [files, setFiles] = React.useState<SelectedFile[]>([]);
  const [rejections, setRejections] = React.useState<FileRejection[]>([]);
  const [dragOver, setDragOver] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const dragCounter = React.useRef(0);
  const descriptionId = React.useId();

  const constraints: FileConstraints = React.useMemo(
    () => ({ extensions, mimeTypes, maxFileSize, maxFiles }),
    [extensions, mimeTypes, maxFileSize, maxFiles],
  );

  const update = React.useCallback(
    (next: SelectedFile[]) => {
      setFiles(next);
      onFilesChange?.(next);
    },
    [onFilesChange],
  );

  const addFiles = React.useCallback(
    (incoming: FileList | File[]) => {
      if (disabled) return;
      const list = Array.from(incoming);
      const { accepted, rejected } = validateFiles(list, constraints, files);

      setRejections(rejected);
      if (accepted.length === 0) return;

      update([
        ...files,
        ...accepted.map((file) => ({
          id: nextFileId(),
          file,
          name: file.name,
          size: file.size,
          type: file.type,
        })),
      ]);
    },
    [constraints, disabled, files, update],
  );

  function removeFile(id: string) {
    update(files.filter((file) => file.id !== id));
  }

  function clearAll() {
    setRejections([]);
    update([]);
  }

  const accept = buildAcceptAttribute(constraints);
  const typeHint = extensions?.length
    ? `${formatExtensionList(extensions)} files`
    : "Supported files";
  const sizeHint = maxFileSize ? `up to ${formatBytes(maxFileSize, 0)} each` : null;
  const countHint = maxFiles ? `${maxFiles} file${maxFiles === 1 ? "" : "s"} max` : null;
  const details = [typeHint, sizeHint, countHint].filter(Boolean).join(" · ");

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div
        data-testid="upload-zone"
        data-state={disabled ? "disabled" : dragOver ? "drag-over" : files.length ? "selected" : "empty"}
        onDragEnter={(event) => {
          if (disabled) return;
          event.preventDefault();
          dragCounter.current += 1;
          setDragOver(true);
        }}
        onDragOver={(event) => {
          if (disabled) return;
          event.preventDefault();
        }}
        onDragLeave={(event) => {
          if (disabled) return;
          event.preventDefault();
          dragCounter.current -= 1;
          if (dragCounter.current <= 0) {
            dragCounter.current = 0;
            setDragOver(false);
          }
        }}
        onDrop={(event) => {
          if (disabled) return;
          event.preventDefault();
          dragCounter.current = 0;
          setDragOver(false);
          if (event.dataTransfer?.files?.length) addFiles(event.dataTransfer.files);
        }}
        className={cn(
          "relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed",
          "px-6 py-12 text-center transition-colors duration-150 sm:py-16",
          disabled
            ? "cursor-not-allowed border-border bg-surface-muted/50"
            : dragOver
              ? "border-primary bg-primary-soft/70"
              : "border-border bg-surface-muted/40 hover:border-border-strong hover:bg-surface-muted/70",
        )}
      >
        {disabledBadge ? (
          <Badge tone="neutral" className="absolute end-3 top-3">
            {disabledBadge}
          </Badge>
        ) : null}

        <span
          aria-hidden="true"
          className={cn(
            "flex size-12 items-center justify-center rounded-full",
            disabled ? "bg-surface text-subtle" : "bg-surface text-primary shadow-xs",
          )}
        >
          {disabled ? <Lock className="size-5" /> : <CloudUpload className="size-6" />}
        </span>

        <div>
          <p className="text-base font-semibold text-foreground">{label}</p>
          {disabled ? null : (
            <p id={descriptionId} className="mt-1 text-sm text-muted">
              {hint ?? "Drag and drop files here, or browse from your device."}
            </p>
          )}
          {details && !disabled ? (
            <p className="mt-1 text-xs text-subtle">{details}</p>
          ) : null}
        </div>

        {disabled ? (
          <div className="max-w-md text-sm text-muted">{disabledReason}</div>
        ) : (
          <>
            <input
              ref={inputRef}
              type="file"
              className="sr-only"
              multiple={multiple}
              accept={accept || undefined}
              aria-describedby={descriptionId}
              aria-label={label}
              onChange={(event) => {
                if (event.target.files) addFiles(event.target.files);
                // Allow selecting the same file again after removing it.
                event.target.value = "";
              }}
            />
            <Button onClick={() => inputRef.current?.click()} variant="primary">
              Browse files
            </Button>
          </>
        )}
      </div>

      {rejections.length > 0 ? (
        <ErrorState
          title={
            rejections.length === 1
              ? "1 file was not added"
              : `${rejections.length} files were not added`
          }
          description={
            <ul className="mt-1 list-disc space-y-1 ps-4">
              {rejections.map((rejection, index) => (
                <li key={`${rejection.file.name}-${index}`}>{rejection.message}</li>
              ))}
            </ul>
          }
          action={
            <Button variant="secondary" size="sm" onClick={() => setRejections([])}>
              Dismiss
            </Button>
          }
        />
      ) : null}

      {files.length > 0 ? (
        <section aria-label="Selected files" className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-foreground">
              {files.length} {files.length === 1 ? "file" : "files"} selected
            </p>
            <Button variant="ghost" size="sm" onClick={clearAll}>
              Remove all
            </Button>
          </div>
          <ul className="flex flex-col gap-2">
            {files.map((file) => (
              <li key={file.id}>
                <FileCard
                  name={file.name}
                  size={file.size}
                  type={file.type}
                  onRemove={() => removeFile(file.id)}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
