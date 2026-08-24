import * as React from "react";
import { cn } from "@/lib/utils/cn";

export type IconButtonVariant = "ghost" | "secondary" | "subtle";
export type IconButtonSize = "sm" | "md";

const variants: Record<IconButtonVariant, string> = {
  ghost: "text-muted hover:bg-surface-muted hover:text-foreground",
  secondary:
    "border border-border-strong bg-surface text-foreground shadow-xs hover:bg-surface-muted",
  subtle: "bg-surface-muted text-foreground hover:bg-border/60",
};

const sizes: Record<IconButtonSize, string> = {
  // 40/44px targets keep pointer and touch interaction comfortable.
  sm: "size-9",
  md: "size-11 sm:size-10",
};

export interface IconButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required: icon-only controls must expose an accessible name. */
  label: string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  ref?: React.Ref<HTMLButtonElement>;
}

export function IconButton({
  className,
  label,
  variant = "ghost",
  size = "md",
  type = "button",
  children,
  ...props
}: IconButtonProps) {
  return (
      <button
        type={type}
        aria-label={label}
        title={label}
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-lg transition-colors duration-150",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          "disabled:pointer-events-none disabled:opacity-55",
          variants[variant],
          sizes[size],
          className,
        )}
        {...props}
      >
        {children}
      </button>
  );
}
