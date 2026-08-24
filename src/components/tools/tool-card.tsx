import Link from "next/link";
import { ToolIcon } from "@/components/tools/tool-icon";
import { ToolStatusBadge } from "@/components/tools/tool-status-badge";
import type { Tool } from "@/lib/tools";
import { cn } from "@/lib/utils/cn";

export interface ToolCardProps {
  tool: Tool;
  className?: string;
  /** Render as an `<li>` when used inside a list. */
  as?: "div" | "li";
}

/**
 * Card linking to a tool page. The whole card is one link, and the status is
 * always visible so a planned tool never looks ready to use.
 */
export function ToolCard({ tool, className, as: Tag = "li" }: ToolCardProps) {
  return (
    <Tag className={cn("list-none", className)}>
      <Link
        href={tool.route}
        className={cn(
          "group flex h-full flex-col gap-3 rounded-xl border border-border bg-surface p-4",
          "shadow-xs transition-[box-shadow,border-color] duration-150",
          "hover:border-border-strong hover:shadow-md",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <span className="flex size-10 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-foreground">
            <ToolIcon name={tool.icon} />
          </span>
          <ToolStatusBadge status={tool.status} plannedTier={tool.plannedTier} />
        </div>

        <div className="flex flex-1 flex-col gap-1">
          <h3 className="text-sm font-semibold text-foreground group-hover:text-primary">
            {tool.name}
          </h3>
          <p className="text-sm leading-relaxed text-muted">{tool.description}</p>
        </div>
      </Link>
    </Tag>
  );
}
