"use client";

import { X } from "lucide-react";
import * as React from "react";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/utils/cn";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

/**
 * Modal dialog built on the native `<dialog>` element, which provides focus
 * trapping, inertness of the background and Escape-to-close without extra
 * dependencies.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
}: DialogProps) {
  const ref = React.useRef<HTMLDialogElement>(null);
  const titleId = React.useId();
  const descriptionId = React.useId();

  React.useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal?.();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
      onClick={(event) => {
        // Clicking the backdrop (outside the panel) closes the dialog.
        if (event.target === ref.current) onClose();
      }}
      className={cn(
        "m-auto w-[calc(100vw-2rem)] max-w-lg rounded-xl border border-border bg-surface p-0",
        "text-foreground shadow-lg backdrop:bg-overlay",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-4 p-5 pb-0">
        <div>
          <h2 id={titleId} className="text-lg font-semibold text-foreground">
            {title}
          </h2>
          {description ? (
            <p id={descriptionId} className="mt-1 text-sm text-muted">
              {description}
            </p>
          ) : null}
        </div>
        <IconButton label="Close dialog" size="sm" onClick={onClose}>
          <X aria-hidden="true" className="size-4" />
        </IconButton>
      </div>

      {children ? <div className="p-5 text-sm text-muted">{children}</div> : null}
      {footer ? (
        <div className="flex flex-wrap justify-end gap-3 border-t border-border p-5">
          {footer}
        </div>
      ) : null}
    </dialog>
  );
}
