"use client";

import * as React from "react";
import {
  searchTools,
  TOOLS,
  type Tool,
  type ToolCategoryId,
} from "@/lib/tools";

export type CategoryFilter = ToolCategoryId | "all";

export interface UseToolSearchOptions {
  initialQuery?: string;
  initialCategory?: CategoryFilter;
  limit?: number;
  tools?: readonly Tool[];
}

export interface UseToolSearchResult {
  query: string;
  setQuery: (query: string) => void;
  category: CategoryFilter;
  setCategory: (category: CategoryFilter) => void;
  results: Tool[];
  /** True when the user typed something. */
  hasQuery: boolean;
  /** True when a query returned nothing. */
  isEmpty: boolean;
  reset: () => void;
}

/**
 * Client-side search state shared by the hero search and the tool explorer.
 * Filtering is pure and synchronous (the catalog is small), so results update
 * immediately as the user types — no debouncing or network calls needed.
 */
export function useToolSearch({
  initialQuery = "",
  initialCategory = "all",
  limit,
  tools = TOOLS,
}: UseToolSearchOptions = {}): UseToolSearchResult {
  const [query, setQuery] = React.useState(initialQuery);
  const [category, setCategory] = React.useState<CategoryFilter>(initialCategory);

  const results = React.useMemo(
    () => searchTools(query, { category, limit, tools }),
    [query, category, limit, tools],
  );

  const hasQuery = query.trim().length > 0;

  const reset = React.useCallback(() => {
    setQuery("");
    setCategory("all");
  }, []);

  return {
    query,
    setQuery,
    category,
    setCategory,
    results,
    hasQuery,
    isEmpty: results.length === 0,
    reset,
  };
}
