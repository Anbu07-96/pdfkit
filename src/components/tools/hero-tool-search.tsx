"use client";

import { ArrowRight, SearchX } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { ToolIcon } from "@/components/tools/tool-icon";
import { ToolStatusBadge } from "@/components/tools/tool-status-badge";
import { useToolSearch } from "@/components/tools/use-tool-search";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import { cn } from "@/lib/utils/cn";

const SUGGESTIONS = ["merge", "compress", "jpg", "word", "ocr", "ai"];
const MAX_RESULTS = 6;

/**
 * Hero search. Results appear immediately below the field; submitting the form
 * opens the full catalog filtered by the same query.
 */
export function HeroToolSearch({ className }: { className?: string }) {
  const router = useRouter();
  const { query, setQuery, results, hasQuery, isEmpty } = useToolSearch({
    limit: MAX_RESULTS,
  });
  const listId = React.useId();

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    router.push(query.trim() ? `/tools?q=${encodeURIComponent(query.trim())}` : "/tools");
  }

  return (
    <div className={cn("w-full", className)}>
      <form role="search" onSubmit={onSubmit} className="w-full">
        <SearchInput
          value={query}
          onValueChange={setQuery}
          label="What do you want to do with your PDF?"
          showLabel
          size="lg"
          placeholder="Search PDF tools…"
          aria-controls={hasQuery ? listId : undefined}
          aria-describedby={`${listId}-status`}
        />
        <button type="submit" className="sr-only">
          Search tools
        </button>
      </form>

      <p id={`${listId}-status`} role="status" aria-live="polite" className="sr-only">
        {hasQuery
          ? `${results.length} ${results.length === 1 ? "tool" : "tools"} found for ${query}`
          : ""}
      </p>

      {!hasQuery ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-subtle">Try:</span>
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => setQuery(suggestion)}
              className={cn(
                "rounded-full border border-border bg-surface px-2.5 py-1 text-xs text-muted",
                "transition-colors hover:border-border-strong hover:text-foreground",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              )}
            >
              {suggestion}
            </button>
          ))}
        </div>
      ) : null}

      {hasQuery ? (
        <div
          className="mt-3 overflow-hidden rounded-xl border border-border bg-surface shadow-sm"
          id={listId}
        >
          {isEmpty ? (
            <div className="flex flex-col items-center gap-2 px-5 py-8 text-center">
              <SearchX aria-hidden="true" className="size-5 text-subtle" />
              <p className="text-sm font-medium text-foreground">
                No tools match “{query}”
              </p>
              <p className="text-sm text-muted">
                Try a different word, or browse the full catalog.
              </p>
              <Button variant="secondary" size="sm" onClick={() => setQuery("")}>
                Clear search
              </Button>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {results.map((tool) => (
                <li key={tool.id}>
                  <Link
                    href={tool.route}
                    className={cn(
                      "flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-muted",
                      "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
                    )}
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-foreground">
                      <ToolIcon name={tool.icon} className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {tool.name}
                      </span>
                      <span className="block truncate text-xs text-muted">
                        {tool.description}
                      </span>
                    </span>
                    <ToolStatusBadge
                      status={tool.status}
                      plannedTier={tool.plannedTier}
                      className="hidden sm:inline-flex"
                    />
                  </Link>
                </li>
              ))}
              <li>
                <Link
                  href={`/tools?q=${encodeURIComponent(query.trim())}`}
                  className={cn(
                    "flex items-center justify-between gap-2 bg-surface-muted/60 px-4 py-3 text-sm font-medium text-primary",
                    "transition-colors hover:bg-surface-muted",
                    "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
                  )}
                >
                  See all matching tools
                  <ArrowRight aria-hidden="true" className="size-4" />
                </Link>
              </li>
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
