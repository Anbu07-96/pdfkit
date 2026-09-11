"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import {
  CategoryToolsList,
  getCategoryNavEntries,
} from "@/components/layout/header-category";
import { primaryNav } from "@/lib/config/site";
import type { ToolCategoryId } from "@/lib/tools/types";
import { cn } from "@/lib/utils/cn";

/** How long the panel stays open after the pointer leaves the nav (ms). */
const CLOSE_DELAY_MS = 140;

/**
 * Desktop main navigation (Phase 75D): plain links for non-category entries,
 * a hover/focus mega-menu per tool category.
 *
 * Interaction contract:
 * - pointer over a category (or its open panel) opens that category's panel;
 * - moving to another category switches the panel immediately;
 * - leaving the nav entirely closes after a short grace delay, so diagonal
 *   pointer moves into a panel do not flicker;
 * - click/tap on the category button toggles its panel (touch screens);
 * - keyboard: focusing a category opens its panel, Tab reaches the panel's
 *   links, Escape closes and returns focus, ArrowLeft/Right hop between
 *   category triggers. The panel is never a focus trap.
 */
export function DesktopNav() {
  const pathname = usePathname();
  const [openId, setOpenId] = React.useState<ToolCategoryId | null>(null);
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // True while the pointer is inside the nav: a click right after a
  // hover-open (mouse click, or a touch tap that fired compat hover events)
  // must not close the panel it just opened.
  const hoverOpen = React.useRef(false);
  const categoryEntries = React.useMemo(() => getCategoryNavEntries(), []);
  const categoryRoutes = React.useMemo(
    () => new Set(categoryEntries.map((entry) => entry.category.route)),
    [categoryEntries],
  );
  const triggerRefs = React.useRef<
    Record<string, HTMLButtonElement | null>
  >({});

  const cancelScheduledClose = React.useCallback(() => {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const openCategory = React.useCallback(
    (id: ToolCategoryId) => {
      cancelScheduledClose();
      setOpenId(id);
    },
    [cancelScheduledClose],
  );

  const openByHover = React.useCallback(
    (id: ToolCategoryId) => {
      hoverOpen.current = true;
      openCategory(id);
    },
    [openCategory],
  );

  const closeNow = React.useCallback(() => {
    cancelScheduledClose();
    setOpenId(null);
  }, [cancelScheduledClose]);

  const scheduleClose = React.useCallback(() => {
    hoverOpen.current = false;
    cancelScheduledClose();
    closeTimer.current = setTimeout(() => setOpenId(null), CLOSE_DELAY_MS);
  }, [cancelScheduledClose]);

  React.useEffect(() => cancelScheduledClose, [cancelScheduledClose]);

  /** Move focus to the next/previous category trigger (arrow keys). */
  const focusCategory = React.useCallback(
    (index: number) => {
      const next =
        categoryEntries[
          (index + categoryEntries.length) % categoryEntries.length
        ];
      const node = triggerRefs.current[next.category.id];
      if (node) {
        node.focus();
        setOpenId(next.category.id);
      }
    },
    [categoryEntries],
  );

  return (
    <nav
      aria-label="Main"
      className="hidden lg:block"
      onMouseEnter={() => {
        // Re-entering the nav counts as hover again; the grace timer is
        // cancelled by the item's own mouseEnter that immediately follows.
        cancelScheduledClose();
      }}
      onMouseLeave={scheduleClose}
    >
      <ul className="flex items-center gap-1">
        {primaryNav.map((item) => {
          if (!categoryRoutes.has(item.href)) {
            const active = pathname === item.href;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "inline-flex h-10 items-center rounded-lg px-3 text-sm font-medium transition-colors",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                    active
                      ? "bg-surface-muted text-foreground"
                      : "text-muted hover:bg-surface-muted hover:text-foreground",
                  )}
                >
                  {item.label}
                </Link>
              </li>
            );
          }

          const entry = categoryEntries.find(
            (candidate) => candidate.category.route === item.href,
          )!;
          const index = categoryEntries.indexOf(entry);
          const open = openId === entry.category.id;
          const panelId = `nav-panel-${entry.category.id}`;

          return (
            <li
              key={item.href}
              className="relative"
              onMouseEnter={() => openByHover(entry.category.id)}
              onBlur={(event) => {
                // Focus leaving the whole menu item (trigger + panel) closes.
                if (!event.currentTarget.contains(event.relatedTarget)) {
                  closeNow();
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape" && open) {
                  event.preventDefault();
                  closeNow();
                }
              }}
            >
              <button
                ref={(node) => {
                  triggerRefs.current[entry.category.id] = node;
                }}
                type="button"
                aria-expanded={open}
                aria-haspopup="true"
                aria-controls={open ? panelId : undefined}
                onClick={() => {
                  // Pointer fallback for devices where hover does nothing:
                  // tap opens. When the panel was opened by this same
                  // pointer interaction (hover/click), a click must not
                  // close it again — panels close via pointer-away, Escape
                  // or focus loss instead.
                  if (!open || !hoverOpen.current) {
                    hoverOpen.current = false;
                    openCategory(entry.category.id);
                  }
                }}
                onFocus={() => openCategory(entry.category.id)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowRight") {
                    event.preventDefault();
                    focusCategory(index + 1);
                  } else if (event.key === "ArrowLeft") {
                    event.preventDefault();
                    focusCategory(index - 1);
                  }
                }}
                className={cn(
                  "inline-flex h-10 items-center gap-1 rounded-lg px-3 text-sm font-medium transition-colors",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  open
                    ? "bg-surface-muted text-foreground"
                    : "text-muted hover:bg-surface-muted hover:text-foreground",
                )}
              >
                {entry.label}
                <ChevronDown
                  aria-hidden="true"
                  className={cn(
                    "size-3.5 transition-transform",
                    open && "rotate-180",
                  )}
                />
              </button>

              {open ? (
                <div
                  id={panelId}
                  className="absolute left-0 top-full z-50 pt-2"
                >
                  <div
                    className={cn(
                      "w-72 max-w-[min(18rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-border",
                      "bg-surface-raised p-1.5 shadow-lg",
                      "max-h-[min(24rem,calc(100vh-6rem))]",
                    )}
                  >
                    <CategoryToolsList category={entry.category} />
                    <div className="border-t border-border p-1.5">
                      <Link
                        href={entry.category.route}
                        onClick={closeNow}
                        className={cn(
                          "flex min-h-10 items-center rounded-lg px-3 text-sm font-medium text-primary",
                          "transition-colors hover:bg-surface-muted",
                          "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
                        )}
                      >
                        View all {entry.category.name} tools
                      </Link>
                    </div>
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
