"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { ToolIcon } from "@/components/tools/tool-icon";
import { cn } from "@/lib/utils/cn";
import {
  TOOL_CATEGORIES,
  getTool,
  getToolsByCategory,
  isToolUsable,
} from "@/lib/tools";
import { BULK_OPERATIONS, BULK_UNAVAILABLE_CONVERSIONS } from "@/lib/tools/bulk";
import type { ToolCategory, ToolIconName } from "@/lib/tools/types";
import { primaryNav } from "@/lib/config/site";

/**
 * Header category menus (Phase 75D/75D.3): the data + item rendering shared
 * by the desktop mega-menu and the mobile accordion.
 *
 * Source of truth: the EXISTING registries — the tool catalog
 * (`getToolsByCategory`/`isToolUsable`) for categories, and the EXISTING bulk
 * registry (`BULK_OPERATIONS`/`BULK_UNAVAILABLE_CONVERSIONS`, Phase 61) for
 * the Bulk entry — plus the EXISTING primary navigation (`primaryNav`). No
 * tool list is duplicated here: entries and items are computed from those
 * registries on every call, so the header can never drift from the real tool
 * statuses. A bulk operation is only presented as usable when its underlying
 * single-file catalog tool is usable.
 *
 * Availability honesty: only usable tools render as links; everything else
 * renders in a clearly separated "Coming soon" strip of muted, dashed,
 * non-interactive chips so unavailable tools are never presented as
 * functional.
 */

/** The existing bulk landing route (see `primaryNav` / `footerNav`). */
const BULK_LANDING_ROUTE = "/bulk";

/** One tool rendered inside a header menu panel. */
export interface NavToolItem {
  name: string;
  description: string;
  /** Route of the tool's page (bulk operations link to their bulk pages). */
  route: string;
  /** Catalog icon key, resolved by the shared presentation registry. */
  icon: ToolIconName;
  /** Only usable tools (AVAILABLE/PRO) render as links. */
  available: boolean;
}

/** One header mega-menu: a tool category, or the bulk registry. */
export interface NavMenuEntry {
  /** Unique id (category id or "bulk") — used for panel ids and keys. */
  id: string;
  /** Trigger label, from primaryNav. */
  label: string;
  /** Panel heading (the category name, or the bulk landing page's title). */
  name: string;
  /** Panel heading description. */
  description: string;
  /** Heading icon key (existing presentation-layer registry). */
  icon: ToolIconName;
  /** "View all" target — the entry's existing route. */
  route: string;
  /** Label of the "View all" link. */
  viewAllLabel: string;
  /** The tools to list, derived from the catalog/registry. */
  items: NavToolItem[];
}

/** A tool category as a menu entry (items straight from the catalog). */
function categoryEntry(
  category: ToolCategory,
  label: string,
  description: string,
): NavMenuEntry {
  return {
    id: category.id,
    label,
    name: category.name,
    description,
    icon: category.icon,
    route: category.route,
    viewAllLabel: `View all ${category.name} tools`,
    items: getToolsByCategory(category.id).map((tool) => ({
      name: tool.name,
      description: tool.description,
      route: tool.route,
      icon: tool.icon,
      available: isToolUsable(tool),
    })),
  };
}

/**
 * The bulk registry as a menu entry. Bulk operations link to their existing
 * `/bulk/<id>` pages and are only presented as usable when the underlying
 * single-file catalog tool is usable; the conversions the bulk registry
 * itself lists as unavailable render as coming-soon chips.
 */
function bulkEntry(label: string, description: string, route: string): NavMenuEntry {
  return {
    id: "bulk",
    label,
    // Matches the bulk landing page's own title ("Bulk tools").
    name: "Bulk tools",
    description,
    // An existing icon key from the presentation registry ("flatten" is
    // the Layers glyph): a stack of files is the bulk metaphor.
    icon: "flatten",
    route,
    viewAllLabel: `View all ${label} tools`,
    items: [
      ...BULK_OPERATIONS.map((operation) => {
        const tool = getTool(operation.id);
        return {
          name: operation.name,
          description: operation.description,
          route: operation.route,
          icon: operation.icon,
          available: tool ? isToolUsable(tool) : false,
        };
      }),
      ...BULK_UNAVAILABLE_CONVERSIONS.map((conversion) => ({
        name: conversion.name,
        description: "",
        route: "",
        // Chips never render icons; the catalog tool's key is the honest
        // default when one exists.
        icon: getTool(conversion.id)?.icon ?? "pdf",
        available: false,
      })),
    ],
  };
}

/**
 * The primary-nav entries that carry a mega-menu: every tool category in the
 * header plus the bulk registry — in primaryNav order, so keyboard arrow
 * navigation walks the menu in the order it is displayed.
 */
export function getNavMenuEntries(): NavMenuEntry[] {
  return primaryNav.flatMap((item) => {
    const category = CATEGORY_BY_ROUTE.get(item.href);
    if (category) {
      return [
        categoryEntry(
          category,
          item.label,
          item.description ?? category.description,
        ),
      ];
    }
    if (item.href === BULK_LANDING_ROUTE) {
      return [bulkEntry(item.label, item.description ?? "", item.href)];
    }
    return [];
  });
}

const CATEGORY_BY_ROUTE = new Map<string, ToolCategory>(
  TOOL_CATEGORIES.map((category) => [category.route, category]),
);

/**
 * A menu entry's items (Phase 75D.2 layout).
 *
 * Available tools form a responsive grid of compact tiles — the item's icon
 * in a soft primary chip, the name and a one-line description, with the
 * whole tile as the link. Each tile is a card: its own surface and border, a
 * subtle hover lift (disabled under prefers-reduced-motion via the global
 * rule plus an explicit motion-reduce guard) and a directional cue that only
 * appears on hover/keyboard focus. Tiles fill their grid row's height, and
 * with an odd number of tiles the last one spans the full width so the grid
 * ends on a balanced edge instead of a half-empty row.
 *
 * Coming-soon tools follow in a divided strip of dashed chips: visibly
 * unlike the tiles, and not interactive in any way.
 *
 * Horizontal rhythm: every section pads with `px-3`, so the list aligns
 * with the desktop panel's heading strip and with the mobile accordion's
 * trigger text.
 */
export function CategoryToolsList({
  items,
  onNavigate,
}: {
  items: NavToolItem[];
  /** Called when a link is clicked (e.g. to close the surrounding panel). */
  onNavigate?: () => void;
}) {
  const available = items.filter((item) => item.available);
  const comingSoon = items.filter((item) => !item.available);

  if (available.length === 0 && comingSoon.length === 0) {
    return (
      <p className="px-3 py-6 text-center text-sm text-muted">
        No tools in this category yet.
      </p>
    );
  }

  return (
    <>
      {available.length === 0 ? (
        <p className="px-3 pb-2.5 pt-3 text-sm text-muted">
          No tools available yet — the ones below are coming soon.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-2 px-3 pb-3 pt-2.5 sm:grid-cols-2">
          {available.map((tool, index) => {
            const spansFullRow =
              available.length % 2 === 1 && index === available.length - 1;
            return (
              <li
                key={tool.name}
                className={cn(spansFullRow && "sm:col-span-2")}
              >
                <Link
                  href={tool.route}
                  onClick={onNavigate}
                  className={cn(
                    "group flex h-full min-h-11 items-start gap-2.5 rounded-lg border border-border bg-surface px-2.5 py-1.5",
                    "transition duration-150 ease-out",
                    "hover:-translate-y-0.5 hover:border-border-strong hover:bg-surface-muted hover:shadow-xs",
                    "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
                    "motion-reduce:transform-none",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-foreground",
                      "transition-transform duration-200 group-hover:scale-105",
                      "motion-reduce:transform-none",
                    )}
                  >
                    <ToolIcon name={tool.icon} className="size-4" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-sm font-medium text-foreground transition-colors group-hover:text-primary">
                      {tool.name}
                    </span>
                    <span className="line-clamp-1 text-xs text-muted">
                      {tool.description}
                    </span>
                  </span>
                  {/* Directional cue: decorative, and invisible until the
                      tile is hovered or keyboard-focused. */}
                  <ArrowRight
                    aria-hidden="true"
                    className={cn(
                      "size-3.5 shrink-0 self-center text-subtle opacity-0 -translate-x-0.5",
                      "transition duration-150",
                      "group-hover:translate-x-0 group-hover:opacity-100",
                      "group-focus-visible:translate-x-0 group-focus-visible:opacity-100",
                      "motion-reduce:transform-none",
                    )}
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {comingSoon.length > 0 ? (
        <div className="border-t border-border">
          <p className="px-3 pb-1.5 pt-2 text-xs font-medium uppercase tracking-wide text-subtle">
            Coming soon
          </p>
          <ul className="flex flex-wrap gap-1.5 px-3 pb-3">
            {comingSoon.map((tool) => (
              <li
                key={tool.name}
                className="rounded-full border border-dashed border-border px-2.5 py-1 text-xs text-subtle"
              >
                {tool.name}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}
