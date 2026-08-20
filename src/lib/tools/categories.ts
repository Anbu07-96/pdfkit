import type { ToolCategory, ToolCategoryId } from "./types";

export const TOOL_CATEGORIES: readonly ToolCategory[] = [
  {
    id: "organize",
    name: "Organize PDF",
    shortName: "Organize",
    description:
      "Combine, divide and rearrange pages so a document is structured the way you need it.",
    icon: "reorder",
    route: "/categories/organize",
  },
  {
    id: "convert",
    name: "Convert",
    shortName: "Convert",
    description:
      "Move documents between PDF and the everyday formats people actually work in.",
    icon: "pdf",
    route: "/categories/convert",
  },
  {
    id: "edit",
    name: "Edit PDF",
    shortName: "Edit",
    description:
      "Add text, images, marks and annotations directly on top of an existing document.",
    icon: "draw",
    route: "/categories/edit",
  },
  {
    id: "security",
    name: "Security",
    shortName: "Security",
    description:
      "Protect, unlock and clean up documents before you share them with other people.",
    icon: "lock",
    route: "/categories/security",
  },
  {
    id: "ocr",
    name: "OCR",
    shortName: "OCR",
    description:
      "Turn scans and images into text you can select, copy and search through.",
    icon: "scan",
    route: "/categories/ocr",
  },
  {
    id: "ai",
    name: "AI",
    shortName: "AI",
    description:
      "Planned document intelligence: summaries, questions, extraction and comparison.",
    icon: "ai-summarize",
    route: "/categories/ai",
  },
] as const;

export const TOOL_CATEGORY_IDS = TOOL_CATEGORIES.map((c) => c.id);

export function getCategory(id: string): ToolCategory | undefined {
  return TOOL_CATEGORIES.find((category) => category.id === id);
}

export function isToolCategoryId(value: string): value is ToolCategoryId {
  return TOOL_CATEGORIES.some((category) => category.id === value);
}
