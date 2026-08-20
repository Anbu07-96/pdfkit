"use client";

import { CheckCircle2, Info, TriangleAlert, X } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils/cn";

export type ToastTone = "info" | "success" | "error";

export interface Toast {
  id: string;
  title: string;
  description?: string;
  tone: ToastTone;
}

interface ToastContextValue {
  toasts: Toast[];
  showToast: (toast: Omit<Toast, "id"> & { id?: string }) => string;
  dismissToast: (id: string) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

const AUTO_DISMISS_MS = 6000;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const timers = React.useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismissToast = React.useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const showToast = React.useCallback<ToastContextValue["showToast"]>(
    ({ id, ...toast }) => {
      const toastId = id ?? `toast-${Math.random().toString(36).slice(2, 10)}`;
      setToasts((current) => [
        ...current.filter((item) => item.id !== toastId),
        { ...toast, id: toastId },
      ]);
      timers.current.set(
        toastId,
        setTimeout(() => dismissToast(toastId), AUTO_DISMISS_MS),
      );
      return toastId;
    },
    [dismissToast],
  );

  React.useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach((timer) => clearTimeout(timer));
      pending.clear();
    };
  }, []);

  const value = React.useMemo(
    () => ({ toasts, showToast, dismissToast }),
    [toasts, showToast, dismissToast],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = React.useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside <ToastProvider>.");
  return context;
}

const toneStyles: Record<ToastTone, { icon: React.ReactNode; className: string }> = {
  info: {
    icon: <Info aria-hidden="true" className="size-4 text-info" />,
    className: "border-border",
  },
  success: {
    icon: <CheckCircle2 aria-hidden="true" className="size-4 text-success" />,
    className: "border-success/40",
  },
  error: {
    icon: <TriangleAlert aria-hidden="true" className="size-4 text-danger" />,
    className: "border-danger/40",
  },
};

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}) {
  return (
    <div
      role="region"
      aria-label="Notifications"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:items-end"
    >
      <div aria-live="polite" aria-atomic="false" className="contents">
        {toasts.map((toast) => {
          const tone = toneStyles[toast.tone];
          return (
            <div
              key={toast.id}
              className={cn(
                "pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border",
                "bg-surface-raised p-3.5 shadow-lg",
                tone.className,
              )}
            >
              <span className="mt-0.5 shrink-0">{tone.icon}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">{toast.title}</p>
                {toast.description ? (
                  <p className="mt-0.5 text-sm break-words text-muted">
                    {toast.description}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => onDismiss(toast.id)}
                className="shrink-0 rounded-md p-1 text-subtle transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <X aria-hidden="true" className="size-4" />
                <span className="sr-only">Dismiss notification</span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
