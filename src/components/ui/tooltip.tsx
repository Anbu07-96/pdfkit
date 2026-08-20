"use client";

import * as React from "react";
import { cn } from "@/lib/utils/cn";

export interface TooltipProps {
  /** Tooltip text. Keep it short — it must never hold essential information. */
  content: string;
  children: React.ReactElement<{ "aria-describedby"?: string }>;
  side?: "top" | "bottom";
  className?: string;
}

/**
 * Lightweight tooltip shown on hover and on keyboard focus. The trigger keeps
 * its own accessible name; the tooltip is only supplementary, referenced with
 * `aria-describedby`.
 */
export function Tooltip({ content, children, side = "top", className }: TooltipProps) {
  const id = React.useId();
  const [visible, setVisible] = React.useState(false);

  return (
    <span
      className={cn("relative inline-flex", className)}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocusCapture={() => setVisible(true)}
      onBlurCapture={() => setVisible(false)}
      onKeyDown={(event) => {
        if (event.key === "Escape") setVisible(false);
      }}
    >
      {React.cloneElement(children, { "aria-describedby": id })}
      <span
        role="tooltip"
        id={id}
        hidden={!visible}
        className={cn(
          "pointer-events-none absolute left-1/2 z-50 w-max max-w-56 -translate-x-1/2 rounded-lg",
          "border border-border bg-surface-raised px-2.5 py-1.5 text-xs text-foreground shadow-md",
          side === "top" ? "bottom-[calc(100%+0.5rem)]" : "top-[calc(100%+0.5rem)]",
        )}
      >
        {content}
      </span>
    </span>
  );
}
