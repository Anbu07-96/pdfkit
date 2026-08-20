"use client";

import { SearchX } from "lucide-react";
import * as React from "react";
import { ToolCard } from "@/components/tools/tool-card";
import {
  useToolSearch,
  type CategoryFilter,
} from "@/components/tools/use-tool-search";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import { EmptyState } from "@/components/ui/states";
import { TOOL_CATEGORIES } from "@/lib/tools";
import { cn } from "@/lib/utils/cn";

export interface ToolExplorerProps {
  initialQuery?: string;
  initialCategory?: CategoryFilter;
  /** Hide the category filter when the page is already scoped to one. */
  showCategoryFilter?: boolean;
  /** Keep the query in the URL so results can be shared. */
  syncQueryToUrl?: boolean;
}

const FILTERS: { id: CategoryFilter; label: string }[] = [
  { id: "all", label: "All" },
  ...TOOL_CATEGORIES.map((category) => ({
    id: category.id as CategoryFilter,
    label: category.shortName,
  })),
];

export function ToolExplorer({
  initialQuery = "",
  initialCategory = "all",
  showCategoryFilter = true,
  syncQueryToUrl = false,
}: ToolExplorerProps) {
  const { query, setQuery, category, setCategory, results, hasQuery, isEmpty, reset } =
    useToolSearch({ initialQuery, initialCategory });

  // Keep the address bar in sync without triggering a navigation.
  React.useEffect(() => {
    if (!syncQueryToUrl || typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (query.trim()) url.searchParams.set("q", query.trim());
    else url.searchParams.delete("q");
    window.history.replaceState(null, "", url.toString());
  }, [query, syncQueryToUrl]);

  const countLabel = `${results.length} ${results.length === 1 ? "tool" : "tools"}`;

  return (
    <div>
      <div className="flex flex-col gap-4">
        <SearchInput
          value={query}
          onValueChange={setQuery}
          label="Search tools by name, description or category"
          placeholder="Search PDF tools…"
        />

        {showCategoryFilter ? (
          <div
            role="group"
            aria-label="Filter tools by category"
            className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1"
          >
            {FILTERS.map((filter) => {
              const active = filter.id === category;
              return (
                <button
                  key={filter.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setCategory(filter.id)}
                  className={cn(
                    "shrink-0 snap-start rounded-full border px-3.5 py-2 text-sm font-medium transition-colors",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                    active
                      ? "border-transparent bg-primary text-primary-foreground"
                      : "border-border bg-surface text-muted hover:border-border-strong hover:text-foreground",
                  )}
                >
                  {filter.label}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      <p role="status" aria-live="polite" className="mt-5 text-sm text-muted">
        {hasQuery ? `${countLabel} matching “${query.trim()}”` : `${countLabel} in the catalog`}
      </p>

      {isEmpty ? (
        <EmptyState
          className="mt-4"
          icon={<SearchX />}
          title="No tools found"
          description="Nothing in the catalog matches that search. Try a shorter word such as “merge”, “convert” or “ocr”."
          action={
            <Button variant="secondary" onClick={reset}>
              Clear search and filters
            </Button>
          }
        />
      ) : (
        <ul className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {results.map((tool) => (
            <ToolCard key={tool.id} tool={tool} />
          ))}
        </ul>
      )}
    </div>
  );
}
