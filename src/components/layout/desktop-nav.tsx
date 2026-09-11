"use client";

import { ArrowRight, ChevronDown } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import {
  CategoryToolsList,
  getNavMenuEntries,
} from "@/components/layout/header-category";
import { Badge } from "@/components/ui/badge";
import { ToolIcon } from "@/components/tools/tool-icon";
import { primaryNav } from "@/lib/config/site";
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
  // Menu entry ids ("convert", "edit", … "bulk") — see getNavMenuEntries.
  const [openId, setOpenIdState] = React.useState<string | null>(null);
  /** Mirrors openId so event handlers read the current value, not a stale
   * closure (also survives the grace-close timer). */
  const openIdRef = React.useRef<string | null>(null);
  /** How the next mounted panel animates: its box ("open", the menu was
   * closed) or only its content ("switch", another panel is already open —
   * the shared box position must not blink). */
  const [panelAnim, setPanelAnim] = React.useState<"open" | "switch">("open");
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // True while the pointer is inside the nav: a click right after a
  // hover-open (mouse click, or a touch tap that fired compat hover events)
  // must not close the panel it just opened.
  const hoverOpen = React.useRef(false);
  const menuEntries = React.useMemo(() => getNavMenuEntries(), []);
  const menuRoutes = React.useMemo(
    () => new Set(menuEntries.map((entry) => entry.route)),
    [menuEntries],
  );
  const triggerRefs = React.useRef<
    Record<string, HTMLButtonElement | null>
  >({});

  const setOpenId = React.useCallback((id: string | null) => {
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
    (id: string) => {
      cancelScheduledClose();
      if (openIdRef.current !== id) {
        setPanelAnim(openIdRef.current === null ? "open" : "switch");
        setOpenId(id);
      }
    },
    [cancelScheduledClose, setOpenId],
  );

  const openByHover = React.useCallback(
    (id: string) => {
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
        menuEntries[(index + menuEntries.length) % menuEntries.length];
      const node = triggerRefs.current[next.id];
      if (node) {
        node.focus();
        openCategory(next.id);
      }
    },
    [menuEntries, openCategory],
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
          if (!menuRoutes.has(item.href)) {
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

          const entry = menuEntries.find(
            (candidate) => candidate.route === item.href,
          )!;
          const index = menuEntries.indexOf(entry);
          const open = openId === entry.id;
          const panelId = `nav-panel-${entry.id}`;
          const availableCount = entry.items.filter(
            (tool) => tool.available,
          ).length;

          return (
            <li
              key={item.href}
              onMouseEnter={() => openByHover(entry.id)}
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
                  triggerRefs.current[entry.id] = node;
                }}
                type="button"
                data-nav-trigger={entry.id}
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
                    openCategory(entry.id);
                  }
                }}
                onFocus={() => openCategory(entry.id)}
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
                      {/* Heading strip: the category's own icon (existing
                          catalog data), its name and description, and the
                          catalog-derived count of available tools as a quiet
                          pill — name reads strongest, description softest. */}
                      <div className="flex items-center gap-2.5 border-b border-border px-3 py-2.5">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-foreground">
                          <ToolIcon name={entry.icon} className="size-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold text-foreground">
                              {entry.name}
                            </p>
                            <Badge tone="neutral" className="ml-auto">
                              {availableCount === 1
                                ? "1 tool available"
                                : `${availableCount} tools available`}
                            </Badge>
                          </div>
                          {entry.description ? (
                            <p className="mt-0.5 line-clamp-1 text-xs text-muted">
                              {entry.description}
                            </p>
                          ) : null}
                        </div>
                      </div>

                      <CategoryToolsList items={entry.items} />

                      <div className="border-t border-border p-1.5">
                        <Link
                          href={entry.route}
                          onClick={closeNow}
                          className={cn(
                            "group flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-primary",
                            "transition-colors hover:bg-surface-muted",
                            "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
                          )}
                        >
                          {entry.viewAllLabel}
                          <ArrowRight
                            aria-hidden="true"
                            className={cn(
                              "size-3.5 transition-transform duration-200 group-hover:translate-x-1",
                              "motion-reduce:transform-none",
                            )}
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
