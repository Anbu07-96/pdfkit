import { TOOL_CATEGORIES } from "./categories";
import { TOOLS } from "./catalog";
import { BULK_OPERATIONS, type BulkOperation } from "./bulk";
import type { Tool, ToolCategoryId } from "./types";

/** Lower-cased, trimmed, whitespace-collapsed query. */
export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

const CATEGORY_NAME_BY_ID = new Map<ToolCategoryId, string>(
  TOOL_CATEGORIES.map((category) => [
    category.id,
    `${category.name} ${category.shortName}`.toLowerCase(),
  ]),
);

/**
 * Build the text a tool can be matched against: name, description, category
 * and extra keywords.
 */
function haystack(tool: Tool): string {
  return [
    tool.name,
    tool.description,
    CATEGORY_NAME_BY_ID.get(tool.category) ?? tool.category,
    tool.keywords.join(" "),
    tool.supportedFileTypes.join(" "),
  ]
    .join(" ")
    .toLowerCase();
}

const HAYSTACKS = new WeakMap<Tool, string>();

function getHaystack(tool: Tool): string {
  let value = HAYSTACKS.get(tool);
  if (value === undefined) {
    value = haystack(tool);
    HAYSTACKS.set(tool, value);
  }
  return value;
}

function scoreTool(tool: Tool, term: string): number {
  const name = tool.name.toLowerCase();
  if (name === term) return 100;
  if (name.startsWith(term)) return 80;
  if (name.includes(term)) return 60;
  if (tool.keywords.some((keyword) => keyword.toLowerCase().includes(term))) {
    return 40;
  }
  if (tool.description.toLowerCase().includes(term)) return 30;
  if (getHaystack(tool).includes(term)) return 10;
  return 0;
}

export interface SearchToolsOptions {
  /** Restrict results to a category. */
  category?: ToolCategoryId | "all";
  /** Maximum number of results. */
  limit?: number;
  /** Catalog to search. Defaults to the full PDFKit catalog. */
  tools?: readonly Tool[];
}

/**
 * Client-side tool search over name, description, category and keywords.
 *
 * Every whitespace-separated term must match (AND semantics) so that queries
 * such as "pdf word" narrow the list instead of widening it. An empty query
 * returns the catalog unchanged (filtered by category), which lets callers use
 * this function for both browsing and searching.
 */
export function searchTools(
  query: string,
  options: SearchToolsOptions = {},
): Tool[] {
  const { category = "all", limit, tools = TOOLS } = options;

  const scoped =
    category === "all"
      ? [...tools]
      : tools.filter((tool) => tool.category === category);

  const normalized = normalizeQuery(query);
  if (!normalized) {
    return typeof limit === "number" ? scoped.slice(0, limit) : scoped;
  }

  const terms = normalized.split(" ");
  const scored: { tool: Tool; score: number; index: number }[] = [];

  scoped.forEach((tool, index) => {
    let total = 0;
    for (const term of terms) {
      const score = scoreTool(tool, term);
      if (score === 0) return;
      total += score;
    }
    scored.push({ tool, score: total, index });
  });

  scored.sort((a, b) => b.score - a.score || a.index - b.index);

  const results = scored.map((entry) => entry.tool);
  return typeof limit === "number" ? results.slice(0, limit) : results;
}

/* ------------------------------------------------------------------ */
/* Bulk operation search (Phase 62)                                    */
/* ------------------------------------------------------------------ */

/**
 * Build the text a bulk operation is matched against: name, description and
 * keywords, plus a few fixed terms every bulk operation should answer to.
 */
function bulkHaystack(operation: BulkOperation): string {
  return [
    operation.name,
    operation.description,
    operation.keywords.join(" "),
    operation.supportedFileTypes.join(" "),
    // Fixed terms so "bulk", "batch" and "multiple" always match, and so
    // "batch pdf to word" finds the bulk PDF → Word operation.
    "bulk batch multiple files many at once",
  ]
    .join(" ")
    .toLowerCase();
}

function scoreBulkOperation(operation: BulkOperation, term: string): number {
  const name = operation.name.toLowerCase();
  if (name === term) return 100;
  if (name.startsWith(term)) return 80;
  if (name.includes(term)) return 60;
  if (operation.keywords.some((keyword) => keyword.toLowerCase().includes(term))) {
    return 40;
  }
  if (operation.description.toLowerCase().includes(term)) return 30;
  if (bulkHaystack(operation).includes(term)) return 10;
  return 0;
}

export interface SearchBulkOptions {
  /** Maximum number of results. */
  limit?: number;
}

/**
 * Search the bulk operations with the same AND-over-terms semantics as
 * `searchTools`, so "pdf word bulk" and "batch pdf to word" both resolve to
 * the Bulk PDF to Word operation.
 *
 * Bulk operations are deliberately NOT folded into `searchTools`: they are
 * not catalog tools (they have no processor of their own), and the catalog's
 * AVAILABLE/COMING_SOON honesty tests must keep passing unchanged. Callers
 * render them as a clearly-labelled separate group.
 */
export function searchBulkOperations(
  query: string,
  options: SearchBulkOptions = {},
): BulkOperation[] {
  const { limit } = options;
  const normalized = normalizeQuery(query);
  if (!normalized) {
    const all = [...BULK_OPERATIONS];
    return typeof limit === "number" ? all.slice(0, limit) : all;
  }

  const terms = normalized.split(" ");
  const scored: { operation: BulkOperation; score: number; index: number }[] = [];

  BULK_OPERATIONS.forEach((operation, index) => {
    let total = 0;
    for (const term of terms) {
      const score = scoreBulkOperation(operation, term);
      if (score === 0) return;
      total += score;
    }
    if (total > 0) scored.push({ operation, score: total, index });
  });

  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  const results = scored.map((entry) => entry.operation);
  return typeof limit === "number" ? results.slice(0, limit) : results;
}
