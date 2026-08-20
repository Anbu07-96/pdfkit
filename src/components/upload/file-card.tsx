"use client";

import { FileText, Image as ImageIcon, X } from "lucide-react";
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
}

export function FileCard({
  name,
  size,
  type = "",
  error,
  onRemove,
  disabled = false,
  className,
}: FileCardProps) {
  const Icon = type.startsWith("image/") ? ImageIcon : FileText;

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border bg-surface p-3",
        error ? "border-danger/50 bg-danger-soft/40" : "border-border",
        className,
      )}
    >
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
          {error ?? formatBytes(size)}
        </p>
      </div>

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
