"use client";

import Link from "next/link";
import { ToolIcon } from "@/components/tools/tool-icon";
import { cn } from "@/lib/utils/cn";
import { TOOL_CATEGORIES, getToolsByCategory, isToolUsable } from "@/lib/tools";
import type { Tool, ToolCategory } from "@/lib/tools/types";
import { primaryNav } from "@/lib/config/site";

/**
 * Header category menus (Phase 75D): the data + item rendering shared by the
 * desktop mega-menu and the mobile accordion.
 *
 * Source of truth: the EXISTING catalog (`getToolsByCategory`) and the
 * EXISTING primary navigation (`primaryNav`). No tool list is duplicated
 * here — the split below is computed from the catalog on every render, so
 * the header can never drift from the real tool statuses.
 *
 * Availability honesty: only usable tools (AVAILABLE/PRO) render as links;
 * everything else renders in a clearly separated "Coming soon" strip of
 * muted, dashed, non-interactive chips so unavailable tools are never
 * presented as functional.
 */

/** Split a category's tools into usable links and honest "soon" rows. */
export function splitCategoryTools(category: ToolCategory): {
  available: Tool[];
  comingSoon: Tool[];
} {
  const tools = getToolsByCategory(category.id);
  return {
    available: tools.filter(isToolUsable),
    comingSoon: tools.filter((tool) => !isToolUsable(tool)),
  };
}

/** The primary-nav entries that are tool categories (dropdown targets). */
export function getCategoryNavEntries(): {
  category: ToolCategory;
  label: string;
}[] {
  return primaryNav.flatMap((item) => {
    const category = CATEGORY_BY_ROUTE.get(item.href);
    return category ? [{ category, label: item.label }] : [];
  });
}

const CATEGORY_BY_ROUTE = new Map<string, ToolCategory>(
  TOOL_CATEGORIES.map((category) => [category.route, category]),
);

/**
 * The catalog tools of a category (Phase 75D.1 layout).
 *
 * Available tools form a responsive grid of compact cards — the catalog's
 * icon, the tool name and a one-line description, with the whole card as
 * the link. Coming-soon tools follow in a divided strip of dashed chips:
 * visually distinct from the cards, and not interactive in any way.
 *
 * Horizontal rhythm: every section pads with `px-3`, so the list aligns
 * with the desktop panel's heading strip and with the mobile accordion's
 * trigger text.
 */
export function CategoryToolsList({
  category,
  onNavigate,
}: {
  category: ToolCategory;
  /** Called when a link is clicked (e.g. to close the surrounding panel). */
  onNavigate?: () => void;
}) {
  const { available, comingSoon } = splitCategoryTools(category);

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
        <p className="px-3 pb-2 pt-3 text-sm text-muted">
          No tools available yet — the ones below are coming soon.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-1.5 px-3 pb-2.5 pt-2.5 sm:grid-cols-2">
          {available.map((tool) => (
            <li key={tool.id}>
              <Link
                href={tool.route}
                onClick={onNavigate}
                className={cn(
                  "group flex min-h-11 items-start gap-2.5 rounded-lg border border-border bg-surface px-2.5 py-2",
                  "transition-colors duration-150 hover:border-border-strong hover:bg-surface-muted",
                  "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
                )}
              >
                <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary-soft-foreground">
                  <ToolIcon name={tool.icon} className="size-4" />
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm font-medium text-foreground transition-colors group-hover:text-primary">
                    {tool.name}
                  </span>
                  <span className="line-clamp-1 text-xs text-muted">
                    {tool.description}
                  </span>
                </span>
              </Link>
            </li>
          ))}
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
                key={tool.id}
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
