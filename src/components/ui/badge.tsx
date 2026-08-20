import * as React from "react";
import { cn } from "@/lib/utils/cn";

export type BadgeTone =
  | "neutral"
  | "primary"
  | "success"
  | "warning"
  | "danger"
  | "info";

const tones: Record<BadgeTone, string> = {
  neutral: "bg-surface-muted text-muted border-border",
  primary: "bg-primary-soft text-primary-soft-foreground border-transparent",
  success: "bg-success-soft text-success border-transparent",
  warning: "bg-warning-soft text-warning border-transparent",
  danger: "bg-danger-soft text-danger border-transparent",
  info: "bg-info-soft text-info border-transparent",
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  /** Optional leading icon. Decorative only — keep meaning in the text. */
  icon?: React.ReactNode;
}

export function Badge({
  className,
  tone = "neutral",
  icon,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5",
        "text-xs leading-5 font-medium whitespace-nowrap",
        tones[tone],
        className,
      )}
      {...props}
    >
      {icon ? (
        <span aria-hidden="true" className="flex items-center [&_svg]:size-3">
          {icon}
        </span>
      ) : null}
      {children}
    </span>
  );
}
