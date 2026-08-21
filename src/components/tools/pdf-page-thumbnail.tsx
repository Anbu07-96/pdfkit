"use client";

import { FileWarning, GripVertical, Loader2 } from "lucide-react";
import * as React from "react";
import { Skeleton } from "@/components/ui/states";
import { cn } from "@/lib/utils/cn";

/**
 * A single rendered PDF page.
 *
 * Reusable on purpose: Reorder uses it today, and Split, Extract, Delete and a
 * future page organiser can use the same card. It renders whatever image the
 * server produced — it never invents a placeholder that looks like a page.
 */
export interface PdfPageThumbnailProps {
  /** 1-based source page number. This is identity, not position. */
  pageNumber: number;
  /** Rendered image. Omit while loading or when rendering failed. */
  src?: string;
  width?: number;
  height?: number;
  /** Position label shown under the page, e.g. "Position 3". */
  positionLabel?: string;
  state?: "loading" | "ready" | "error";
  selected?: boolean;
  dragging?: boolean;
  /** Shown as a visual affordance when the card is draggable. */
  showDragHandle?: boolean;
  /** Controls rendered under the page (move buttons, remove, …). */
  actions?: React.ReactNode;
  className?: string;
}

export function PdfPageThumbnail({
  pageNumber,
  src,
  width,
  height,
  positionLabel,
  state = src ? "ready" : "loading",
  selected = false,
  dragging = false,
  showDragHandle = false,
  actions,
  className,
}: PdfPageThumbnailProps) {
  const aspectRatio = width && height ? `${width} / ${height}` : "3 / 4";

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-xl border bg-surface p-2 shadow-xs transition-[box-shadow,border-color,opacity]",
        selected ? "border-primary" : "border-border",
        dragging && "opacity-50",
        className,
      )}
    >
      <div
        className="relative flex items-center justify-center overflow-hidden rounded-lg bg-surface-muted"
        style={{ aspectRatio }}
      >
        {state === "ready" && src ? (
          // eslint-disable-next-line @next/next/no-img-element -- data URL from our own API, not an optimisable asset
          <img
            src={src}
            alt={`Preview of page ${pageNumber}`}
            width={width}
            height={height}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-contain"
          />
        ) : state === "error" ? (
          <span className="flex flex-col items-center gap-1 p-2 text-center text-xs text-muted">
            <FileWarning aria-hidden="true" className="size-5 text-warning" />
            Preview unavailable
          </span>
        ) : (
          <span className="flex h-full w-full items-center justify-center">
            <Skeleton className="h-full w-full rounded-none" />
            <Loader2
              aria-hidden="true"
              className="absolute size-5 animate-spin text-subtle"
            />
          </span>
        )}

        {showDragHandle ? (
          <span
            aria-hidden="true"
            className="absolute start-1 top-1 rounded-md bg-surface/90 p-0.5 text-subtle shadow-xs"
          >
            <GripVertical className="size-4" />
          </span>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-2 px-1">
        <span className="text-xs font-medium text-foreground tabular-nums">
          Page {pageNumber}
        </span>
        {positionLabel ? (
          <span className="text-xs text-subtle tabular-nums">{positionLabel}</span>
        ) : null}
      </div>

      {actions ? <div className="flex items-center justify-center gap-1">{actions}</div> : null}
    </div>
  );
}
