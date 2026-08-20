import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { ToolIcon } from "@/components/tools/tool-icon";
import type { Tool, ToolCategory } from "@/lib/tools";
import { cn } from "@/lib/utils/cn";

export interface CategoryCardProps {
  category: ToolCategory;
  tools: Tool[];
  className?: string;
  as?: "div" | "li";
}

export function CategoryCard({
  category,
  tools,
  className,
  as: Tag = "li",
}: CategoryCardProps) {
  const preview = tools.slice(0, 4);
  const remaining = tools.length - preview.length;

  return (
    <Tag className={cn("list-none", className)}>
      <Link
        href={category.route}
        className={cn(
          "group flex h-full flex-col gap-4 rounded-xl border border-border bg-surface p-5",
          "shadow-xs transition-[box-shadow,border-color] duration-150",
          "hover:border-border-strong hover:shadow-md",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        )}
      >
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-lg bg-surface-muted text-foreground">
            <ToolIcon name={category.icon} />
          </span>
          <div>
            <h3 className="text-base font-semibold text-foreground group-hover:text-primary">
              {category.name}
            </h3>
            <p className="text-xs text-subtle">
              {tools.length} {tools.length === 1 ? "tool" : "tools"} planned
            </p>
          </div>
        </div>

        <p className="text-sm leading-relaxed text-muted">{category.description}</p>

        <ul className="mt-auto flex flex-wrap gap-1.5">
          {preview.map((tool) => (
            <li
              key={tool.id}
              className="rounded-md bg-surface-muted px-2 py-1 text-xs text-muted"
            >
              {tool.name}
            </li>
          ))}
          {remaining > 0 ? (
            <li className="rounded-md px-2 py-1 text-xs text-subtle">
              +{remaining} more
            </li>
          ) : null}
        </ul>

        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-primary">
          Explore {category.shortName}
          <ArrowRight
            aria-hidden="true"
            className="size-4 transition-transform duration-150 group-hover:translate-x-0.5"
          />
        </span>
      </Link>
    </Tag>
  );
}
