"use client";

import Link from "next/link";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
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
 * everything else renders as a muted, non-interactive row with a "Soon"
 * badge so unavailable tools are never presented as functional.
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

/** The catalog tools of a category, rendered as the shared item list. */
export function CategoryToolsList({
  category,
  onNavigate,
  itemClassName,
}: {
  category: ToolCategory;
  /** Called when a link is clicked (e.g. to close the surrounding panel). */
  onNavigate?: () => void;
  itemClassName?: string;
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
        <p className="px-3 pb-2 pt-1 text-sm text-muted">
          No tools available yet — the ones below are coming soon.
        </p>
      ) : null}
      <ul>
        {available.map((tool) => (
          <li key={tool.id}>
            <Link
              href={tool.route}
              onClick={onNavigate}
              className={cn(
                "flex min-h-11 flex-col justify-center rounded-lg px-3 py-1.5 transition-colors",
                "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
                "hover:bg-surface-muted",
                itemClassName,
              )}
            >
              <span className="text-sm font-medium text-foreground">
                {tool.name}
              </span>
              <span className="line-clamp-1 text-xs text-muted">
                {tool.description}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {comingSoon.length > 0 ? (
        <div className="border-t border-border">
          <p className="px-3 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-subtle">
            Coming soon
          </p>
          <ul>
            {comingSoon.map((tool) => (
              <li
                key={tool.id}
                className="flex min-h-11 items-center justify-between gap-2 rounded-lg px-3 py-1.5"
              >
                <span className="text-sm text-subtle">{tool.name}</span>
                <Badge tone="neutral">Soon</Badge>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}
