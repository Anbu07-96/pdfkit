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
  /**
   * Controlled selection. When provided, the component renders exactly these
   * files and reports every change through `onFilesChange`.
   */
  files?: SelectedFile[];
  /** Notifies the page about the current selection. Never processes files. */
  onFilesChange?: (files: SelectedFile[]) => void;
  /**
   * Show position numbers and move up/down controls. Use for tools where the
   * order of the documents changes the result (for example Merge PDF).
   */
  orderable?: boolean;
  /**
   * Work is in progress elsewhere on the page: selection stays visible but
   * cannot be changed. Different from `disabled`, which means "not available".
   */
  busy?: boolean;
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
 * It is intentionally *only* a selection surface: it validates, lists and
 * orders files. It knows nothing about uploading, PDF processing or any
 * backend, so every tool can reuse it unchanged.
 */
export function UploadZone({
  label = "Upload your files",
  hint,
  multiple = true,
  disabled = false,
  disabledReason,
  disabledBadge,
  files: controlledFiles,
  onFilesChange,
  orderable = false,
  busy = false,
  className,
  extensions,
  mimeTypes,
  maxFileSize,
  maxFiles,
}: UploadZoneProps) {
  const [uncontrolledFiles, setUncontrolledFiles] = React.useState<SelectedFile[]>([]);
  const [rejections, setRejections] = React.useState<FileRejection[]>([]);
  const [dragOver, setDragOver] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const dragCounter = React.useRef(0);
  const descriptionId = React.useId();

  const isControlled = controlledFiles !== undefined;
  const files = isControlled ? controlledFiles : uncontrolledFiles;
  const locked = disabled || busy;

  const constraints: FileConstraints = React.useMemo(
    () => ({ extensions, mimeTypes, maxFileSize, maxFiles }),
    [extensions, mimeTypes, maxFileSize, maxFiles],
  );

  const update = React.useCallback(
    (next: SelectedFile[]) => {
      if (!isControlled) setUncontrolledFiles(next);
      onFilesChange?.(next);
    },
    [isControlled, onFilesChange],
  );

  const addFiles = React.useCallback(
    (incoming: FileList | File[]) => {
      if (locked) return;
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
    [constraints, locked, files, update],
  );

  function removeFile(id: string) {
    update(files.filter((file) => file.id !== id));
  }

  function moveFile(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= files.length) return;
    const next = [...files];
    [next[index], next[target]] = [next[target], next[index]];
    update(next);
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

  const state = disabled
    ? "disabled"
    : busy
      ? "busy"
      : dragOver
        ? "drag-over"
        : files.length
          ? "selected"
          : "empty";

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div
        data-testid="upload-zone"
        data-state={state}
        onDragEnter={(event) => {
          if (locked) return;
          event.preventDefault();
          dragCounter.current += 1;
          setDragOver(true);
        }}
        onDragOver={(event) => {
          if (locked) return;
          event.preventDefault();
        }}
        onDragLeave={(event) => {
          if (locked) return;
          event.preventDefault();
          dragCounter.current -= 1;
          if (dragCounter.current <= 0) {
            dragCounter.current = 0;
            setDragOver(false);
          }
        }}
        onDrop={(event) => {
          if (locked) return;
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
          busy && "opacity-70",
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
              disabled={busy}
              onChange={(event) => {
                if (event.target.files) addFiles(event.target.files);
                // Allow selecting the same file again after removing it.
                event.target.value = "";
              }}
            />
            <Button
              onClick={() => inputRef.current?.click()}
              variant="primary"
              disabled={busy}
            >
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
            <Button variant="ghost" size="sm" onClick={clearAll} disabled={locked}>
              Remove all
            </Button>
          </div>

          {orderable && files.length > 1 ? (
            <p className="text-xs text-subtle">
              Documents are processed in this order. Use the arrows to rearrange them.
            </p>
          ) : null}

          <ul className="flex flex-col gap-2">
            {files.map((file, index) => (
              <li key={file.id}>
                <FileCard
                  name={file.name}
                  size={file.size}
                  type={file.type}
                  disabled={locked}
                  onRemove={() => removeFile(file.id)}
                  {...(orderable
                    ? {
                        position: index + 1,
                        total: files.length,
                        onMoveUp: index > 0 ? () => moveFile(index, -1) : undefined,
                        onMoveDown:
                          index < files.length - 1
                            ? () => moveFile(index, 1)
                            : undefined,
                      }
                    : {})}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
