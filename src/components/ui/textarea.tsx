"use client";

import * as React from "react";
import { cn } from "@/lib/utils/cn";

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  /** Visually hide the label but keep it for screen readers. */
  hideLabel?: boolean;
  hint?: string;
  error?: string;
  ref?: React.Ref<HTMLTextAreaElement>;
}

/** Multi-line text input, styled exactly like `Input`. */
export function Textarea({
  id,
  className,
  label,
  hideLabel = false,
  hint,
  error,
  disabled,
  rows = 4,
  ...props
}: TextareaProps) {
  const generatedId = React.useId();
  const inputId = id ?? generatedId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;

  return (
    <div className="w-full">
      {label ? (
        <label
          htmlFor={inputId}
          className={cn(
            "mb-1.5 block text-sm font-medium text-foreground",
            hideLabel && "sr-only",
          )}
        >
          {label}
        </label>
      ) : null}

      <div
        className={cn(
          "rounded-lg border bg-surface px-3 py-2.5",
          "transition-colors duration-150",
          "focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring",
          error ? "border-danger" : "border-border-strong hover:border-border-strong",
          disabled && "opacity-60",
          className,
        )}
      >
        <textarea
          id={inputId}
          rows={rows}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={cn(errorId, hintId) || undefined}
          className={cn(
            "w-full min-w-0 resize-y bg-transparent text-sm text-foreground",
            "placeholder:text-subtle focus:outline-none disabled:cursor-not-allowed",
          )}
          {...props}
        />
      </div>

      {hint && !error ? (
        <p id={hintId} className="mt-1.5 text-xs text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="mt-1.5 text-xs font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
