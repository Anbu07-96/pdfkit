import Link from "next/link";
import { Layers } from "lucide-react";
import { ToolIcon } from "@/components/tools/tool-icon";
import type { BulkOperation } from "@/lib/tools/bulk";
import { cn } from "@/lib/utils/cn";

export interface BulkOperationCardProps {
  operation: BulkOperation;
  className?: string;
  /** Render as an `<li>` when used inside a list. */
  as?: "div" | "li";
}

/**
 * Card linking to a bulk operation page. Every bulk operation is genuinely
 * usable (it drives existing, implemented endpoints), so the badge says so
 * plainly — there are no "coming soon" bulk cards.
 */
export function BulkOperationCard({
  operation,
  className,
  as: Tag = "li",
}: BulkOperationCardProps) {
  return (
    <Tag className={cn("list-none", className)}>
      <Link
        href={operation.route}
        className={cn(
          "group flex h-full flex-col gap-3 rounded-xl border border-border bg-surface p-4",
          "shadow-xs transition-[box-shadow,border-color] duration-150",
          "hover:border-border-strong hover:shadow-md",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <span className="flex size-10 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-foreground">
            <ToolIcon name={operation.icon} />
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-xs leading-5 font-medium text-success">
            <Layers aria-hidden="true" className="size-3" />
            Bulk
          </span>
        </div>

        <div className="flex flex-1 flex-col gap-1">
          <h3 className="text-sm font-semibold text-foreground group-hover:text-primary">
            {operation.name}
          </h3>
          <p className="text-sm leading-relaxed text-muted">{operation.description}</p>
        </div>
      </Link>
    </Tag>
  );
}
