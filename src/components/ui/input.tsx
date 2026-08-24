"use client";

import * as React from "react";
import { cn } from "@/lib/utils/cn";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  /** Visually hide the label but keep it for screen readers. */
  hideLabel?: boolean;
  hint?: string;
  error?: string;
  leadingIcon?: React.ReactNode;
  trailingSlot?: React.ReactNode;
  ref?: React.Ref<HTMLInputElement>;
}

export function Input({
  id,
  className,
  label,
  hideLabel = false,
  hint,
  error,
  leadingIcon,
  trailingSlot,
  disabled,
  ...props
}: InputProps) {
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
          "flex items-center gap-2 rounded-lg border bg-surface px-3",
          "transition-colors duration-150",
          "focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring",
          error ? "border-danger" : "border-border-strong hover:border-border-strong",
          disabled && "opacity-60",
          className,
        )}
      >
        {leadingIcon ? (
          <span aria-hidden="true" className="flex shrink-0 items-center text-subtle [&_svg]:size-4">
            {leadingIcon}
          </span>
        ) : null}

        <input
          id={inputId}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={cn(errorId, hintId) || undefined}
          className={cn(
            "h-11 w-full min-w-0 bg-transparent text-sm text-foreground sm:h-10",
            "placeholder:text-subtle focus:outline-none disabled:cursor-not-allowed",
          )}
          {...props}
        />

        {trailingSlot ? <span className="flex shrink-0 items-center">{trailingSlot}</span> : null}
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
