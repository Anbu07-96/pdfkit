"use client";

import { Search, X } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils/cn";

export interface SearchInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value" | "size"> {
  value: string;
  onValueChange: (value: string) => void;
  label: string;
  /** Show the label above the field instead of only to screen readers. */
  showLabel?: boolean;
  size?: "md" | "lg";
  containerClassName?: string;
  ref?: React.Ref<HTMLInputElement>;
}

/**
 * Accessible search field: `role="searchbox"` semantics via `type="search"`,
 * a visible clear action, and Escape to clear.
 */
export function SearchInput({
  id,
  value,
  onValueChange,
  label,
  showLabel = false,
  size = "md",
  className,
  containerClassName,
  ref,
  onKeyDown,
  ...props
}: SearchInputProps) {
  const generatedId = React.useId();
  const inputId = id ?? generatedId;
  const innerRef = React.useRef<HTMLInputElement>(null);

  React.useImperativeHandle(ref, () => innerRef.current as HTMLInputElement, []);

  function clear() {
    onValueChange("");
    innerRef.current?.focus();
  }

  return (
    <div className={cn("w-full", containerClassName)}>
      <label
        htmlFor={inputId}
        className={cn(
          "mb-2 block text-sm font-medium text-foreground",
          !showLabel && "sr-only",
        )}
      >
        {label}
      </label>
      <div
        className={cn(
          "flex items-center gap-2 rounded-xl border border-border-strong bg-surface px-3 shadow-xs",
          "transition-colors duration-150",
          "focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring",
          size === "lg" ? "h-14 px-4" : "h-11 sm:h-10",
          className,
        )}
      >
        <Search aria-hidden="true" className="size-5 shrink-0 text-subtle" />
        <input
          ref={innerRef}
          id={inputId}
          type="search"
          value={value}
          autoComplete="off"
          onChange={(event) => onValueChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && value) {
              event.preventDefault();
              clear();
            }
            onKeyDown?.(event);
          }}
          className={cn(
            "w-full min-w-0 bg-transparent text-foreground placeholder:text-subtle focus:outline-none",
            "[&::-webkit-search-cancel-button]:appearance-none",
            size === "lg" ? "text-base" : "text-sm",
          )}
          {...props}
        />
        {value ? (
          <button
            type="button"
            onClick={clear}
            className={cn(
              "inline-flex shrink-0 items-center justify-center rounded-md text-subtle",
              "transition-colors hover:bg-surface-muted hover:text-foreground",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              size === "lg" ? "size-9" : "size-8",
            )}
          >
            <X aria-hidden="true" className="size-4" />
            <span className="sr-only">Clear search</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
