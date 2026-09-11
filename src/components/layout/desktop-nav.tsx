"use client";

import { ArrowRight, ChevronDown } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import {
  CategoryToolsList,
  getCategoryNavEntries,
  splitCategoryTools,
} from "@/components/layout/header-category";
import { primaryNav } from "@/lib/config/site";
import type { ToolCategoryId } from "@/lib/tools/types";
import { cn } from "@/lib/utils/cn";

/** How long the panel stays open after the pointer leaves the nav (ms). */
const CLOSE_DELAY_MS = 140;

/**
 * Desktop main navigation (Phase 75D.1): plain links for non-category
 * entries, a hover/focus mega-menu per tool category.
 *
 * Layout: every open panel is anchored to the NAV (the positioned
 * ancestor), not to its trigger, so all categories share one panel
 * position — switching swaps content in place, and the wide panel sits
 * underneath every trigger, which keeps pointer travel into it short. The
 * box is capped to the viewport and scrolls internally when needed.
 *
 * Animation: opening from closed animates the box in (CSS class
 * `nav-panel-in`); switching categories animates only the content
 * (`nav-panel-content-in`), so the container never blinks. Both are plain
 * CSS animations, disabled entirely by the global prefers-reduced-motion
 * rule.
 *
 * Interaction contract (unchanged from Phase 75D):
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
  const [openId, setOpenIdState] = React.useState<ToolCategoryId | null>(null);
  /** Mirrors openId so event handlers read the current value, not a stale
   * closure (also survives the grace-close timer). */
  const openIdRef = React.useRef<ToolCategoryId | null>(null);
  /** How the next mounted panel animates: its box ("open", the menu was
   * closed) or only its content ("switch", another panel is already open —
   * the shared box position must not blink). */
  const [panelAnim, setPanelAnim] = React.useState<"open" | "switch">("open");
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

  const setOpenId = React.useCallback((id: ToolCategoryId | null) => {
    openIdRef.current = id;
    setOpenIdState(id);
  }, []);

  const cancelScheduledClose = React.useCallback(() => {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const openCategory = React.useCallback(
    (id: ToolCategoryId) => {
      cancelScheduledClose();
      if (openIdRef.current !== id) {
        setPanelAnim(openIdRef.current === null ? "open" : "switch");
        setOpenId(id);
      }
    },
    [cancelScheduledClose, setOpenId],
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
  }, [cancelScheduledClose, setOpenId]);

  const scheduleClose = React.useCallback(() => {
    hoverOpen.current = false;
    cancelScheduledClose();
    closeTimer.current = setTimeout(() => setOpenId(null), CLOSE_DELAY_MS);
  }, [cancelScheduledClose, setOpenId]);

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
        openCategory(next.category.id);
      }
    },
    [categoryEntries, openCategory],
  );

  return (
    <nav
      aria-label="Main"
      className="relative hidden lg:block"
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
          const { available } = splitCategoryTools(entry.category);

          return (
            <li
              key={item.href}
              onMouseEnter={() => openByHover(entry.category.id)}
              onBlur={(event) => {
                // Focus leaving the whole menu item (trigger + panel) closes —
                // unless it moves straight to another category trigger, whose
                // own focus handling switches the panel in place (a content
                // swap, not a close-and-reopen with a replayed animation).
                const related = event.relatedTarget;
                if (event.currentTarget.contains(related)) return;
                if (
                  related instanceof HTMLElement &&
                  related.dataset.navTrigger !== undefined
                ) {
                  return;
                }
                closeNow();
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
                data-nav-trigger={entry.category.id}
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
                /* Anchored to the nav (its positioned ancestor), so every
                   category's panel shares one position. The pt-3 padding
                   spans the 12px between the nav bar's bottom edge and the
                   header's bottom edge (h-16 header, h-10 nav): the pointer
                   stays inside the nav's DOM all the way down, and the box
                   hangs flush from the header. */
                <div className="absolute left-0 top-full z-50 pt-3">
                  <div
                    id={panelId}
                    className={cn(
                      "w-[34rem] max-w-[min(34rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain rounded-xl border border-border",
                      "bg-surface-raised shadow-lg",
                      "max-h-[min(30rem,calc(100vh-6rem))]",
                      panelAnim === "open" && "nav-panel-in",
                    )}
                  >
                    <div
                      className={cn(
                        panelAnim === "switch" && "nav-panel-content-in",
                      )}
                    >
                      {/* Heading strip: category name, catalog-derived count
                          and the category's own description. */}
                      <div className="border-b border-border px-3 pb-2.5 pt-2.5">
                        <div className="flex items-baseline justify-between gap-3">
                          <p className="text-sm font-semibold text-foreground">
                            {entry.category.name}
                          </p>
                          <p className="shrink-0 text-xs text-subtle">
                            {available.length === 1
                              ? "1 tool available"
                              : `${available.length} tools available`}
                          </p>
                        </div>
                        <p className="mt-0.5 line-clamp-1 text-xs text-muted">
                          {entry.category.description}
                        </p>
                      </div>

                      <CategoryToolsList category={entry.category} />

                      <div className="border-t border-border p-1.5">
                        <Link
                          href={entry.category.route}
                          onClick={closeNow}
                          className={cn(
                            "group flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-primary",
                            "transition-colors hover:bg-surface-muted",
                            "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
                          )}
                        >
                          View all {entry.category.name} tools
                          <ArrowRight
                            aria-hidden="true"
                            className="size-3.5 transition-transform group-hover:translate-x-0.5"
                          />
                        </Link>
                      </div>
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
