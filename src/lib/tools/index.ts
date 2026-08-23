import { TOOL_CATEGORIES, getCategory } from "./categories";
import { POPULAR_TOOL_IDS, TOOLS } from "./catalog";
import type { Tool, ToolCategoryId, ToolStatus } from "./types";

export * from "./types";
export { TOOL_CATEGORIES, TOOL_CATEGORY_IDS, getCategory, isToolCategoryId } from "./categories";
export { TOOLS, POPULAR_TOOL_IDS } from "./catalog";
export { searchTools, normalizeQuery, type SearchToolsOptions } from "./search";

const TOOLS_BY_ID = new Map<string, Tool>(TOOLS.map((tool) => [tool.id, tool]));

export function getTool(id: string): Tool | undefined {
  return TOOLS_BY_ID.get(id);
}

export function getToolsByCategory(category: ToolCategoryId): Tool[] {
  return TOOLS.filter((tool) => tool.category === category);
}

export function getPopularTools(): Tool[] {
  return POPULAR_TOOL_IDS.map((id) => {
    const tool = getTool(id);
    if (!tool) {
      throw new Error(`Popular tool "${id}" is missing from the catalog.`);
    }
    return tool;
  });
}

export function getToolsByStatus(status: ToolStatus): Tool[] {
  return TOOLS.filter((tool) => tool.status === status);
}

/** A tool can only be used when it is genuinely implemented. */
export function isToolUsable(tool: Tool): boolean {
  return tool.status === "AVAILABLE" || tool.status === "PRO";
}

export interface CategoryWithTools {
  category: (typeof TOOL_CATEGORIES)[number];
  tools: Tool[];
}

export function getCategoriesWithTools(): CategoryWithTools[] {
  return TOOL_CATEGORIES.map((category) => ({
    category,
    tools: getToolsByCategory(category.id),
  }));
}
