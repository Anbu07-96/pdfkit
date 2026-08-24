"use client";

import { ArrowDown, ArrowUp, FileText, Image as ImageIcon, X } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { formatBytes } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

export interface FileCardProps {
  name: string;
  size: number;
  type?: string;
  /** Optional problem with this file, e.g. "Larger than 50 MB". */
  error?: string;
  onRemove?: () => void;
  disabled?: boolean;
  className?: string;
  /** 1-based position, shown when the order of files matters. */
  position?: number;
  /** Total number of files, used for accessible move labels. */
  total?: number;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}

export function FileCard({
  name,
  size,
  type = "",
  error,
  onRemove,
  disabled = false,
  className,
  position,
  total,
  onMoveUp,
  onMoveDown,
}: FileCardProps) {
  const Icon = type.startsWith("image/") ? ImageIcon : FileText;
  const orderable = Boolean(onMoveUp || onMoveDown);
  const positionLabel =
    position !== undefined
      ? total !== undefined
        ? `Position ${position} of ${total}`
        : `Position ${position}`
      : undefined;

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border bg-surface p-3",
        error ? "border-danger/50 bg-danger-soft/40" : "border-border",
        className,
      )}
    >
      {position !== undefined ? (
        <span
          className="flex size-7 shrink-0 items-center justify-center rounded-md bg-surface-muted text-xs font-semibold text-foreground tabular-nums"
          aria-hidden="true"
        >
          {position}
        </span>
      ) : null}

      <span
        aria-hidden="true"
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-md",
          error ? "bg-danger-soft text-danger" : "bg-surface-muted text-muted",
        )}
      >
        <Icon className="size-4" />
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground" title={name}>
          {name}
        </p>
        <p className={cn("text-xs", error ? "text-danger" : "text-subtle")}>
          {positionLabel ? <span className="sr-only">{positionLabel}. </span> : null}
          {error ?? formatBytes(size)}
        </p>
      </div>

      {orderable ? (
        <div className="flex shrink-0 items-center">
          <IconButton
            label={`Move ${name} up`}
            size="sm"
            onClick={onMoveUp}
            disabled={disabled || !onMoveUp}
          >
            <ArrowUp aria-hidden="true" className="size-4" />
          </IconButton>
          <IconButton
            label={`Move ${name} down`}
            size="sm"
            onClick={onMoveDown}
            disabled={disabled || !onMoveDown}
          >
            <ArrowDown aria-hidden="true" className="size-4" />
          </IconButton>
        </div>
      ) : null}

      {onRemove ? (
        <IconButton
          label={`Remove ${name}`}
          size="sm"
          onClick={onRemove}
          disabled={disabled}
        >
          <X aria-hidden="true" className="size-4" />
        </IconButton>
      ) : null}
    </div>
  );
}
