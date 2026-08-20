"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import { Logo } from "@/components/layout/logo";
import { ButtonLink } from "@/components/ui/button";
import { primaryNav } from "@/lib/config/site";
import { cn } from "@/lib/utils/cn";

/**
 * Mobile navigation: a disclosure button that opens a full-width panel.
 * Escape closes it, focus moves into and back out of the panel, and background
 * scrolling is locked while it is open.
 */
export function MobileNav() {
  const [open, setOpen] = React.useState(false);
  const pathname = usePathname();
  const panelRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const panelId = React.useId();

  React.useEffect(() => {
    if (!open) return;

    const { body } = document;
    const previousOverflow = body.style.overflow;
    body.style.overflow = "hidden";

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    panelRef.current?.querySelector<HTMLElement>("a, button")?.focus();

    return () => {
      body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="lg:hidden">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "inline-flex size-11 items-center justify-center rounded-lg text-muted transition-colors",
          "hover:bg-surface-muted hover:text-foreground",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        )}
      >
        {open ? (
          <X aria-hidden="true" className="size-5" />
        ) : (
          <Menu aria-hidden="true" className="size-5" />
        )}
        <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex flex-col bg-background">
          <div className="flex h-16 items-center justify-between border-b border-border px-4">
            <Logo />
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                triggerRef.current?.focus();
              }}
              className={cn(
                "inline-flex size-11 items-center justify-center rounded-lg text-muted transition-colors",
                "hover:bg-surface-muted hover:text-foreground",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              )}
            >
              <X aria-hidden="true" className="size-5" />
              <span className="sr-only">Close navigation</span>
            </button>
          </div>

          <nav
            id={panelId}
            ref={panelRef}
            aria-label="Mobile"
            className="flex-1 overflow-y-auto px-4 py-6"
          >
            <ul className="flex flex-col gap-1">
              {primaryNav.map((item) => {
                const active = pathname === item.href;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      onClick={() => setOpen(false)}
                      className={cn(
                        "flex min-h-12 flex-col justify-center rounded-lg px-3 py-2 transition-colors",
                        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                        active
                          ? "bg-primary-soft text-primary-soft-foreground"
                          : "text-foreground hover:bg-surface-muted",
                      )}
                    >
                      <span className="text-base font-medium">{item.label}</span>
                      {item.description ? (
                        <span className="text-sm text-muted">{item.description}</span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>

            <ButtonLink
              href="/tools"
              size="lg"
              fullWidth
              className="mt-6"
              onClick={() => setOpen(false)}
            >
              Browse all tools
            </ButtonLink>
          </nav>
        </div>
      ) : null}
    </div>
  );
}
