import { ChevronDown } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils/cn";

export interface FaqItem {
  question: string;
  answer: React.ReactNode;
}

/**
 * FAQ list built on native `<details>` elements: keyboard accessible and
 * expandable without any JavaScript.
 */
export function FaqList({
  items,
  className,
}: {
  items: FaqItem[];
  className?: string;
}) {
  return (
    <div className={cn("divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface", className)}>
      {items.map((item) => (
        <details key={item.question} className="group">
          <summary
            className={cn(
              "flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4",
              "text-start text-base font-medium text-foreground transition-colors",
              "hover:bg-surface-muted/60",
              "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
              "[&::-webkit-details-marker]:hidden",
            )}
          >
            {item.question}
            <ChevronDown
              aria-hidden="true"
              className="size-5 shrink-0 text-subtle transition-transform duration-150 group-open:rotate-180"
            />
          </summary>
          <div className="px-5 pb-5 text-sm leading-relaxed text-muted">{item.answer}</div>
        </details>
      ))}
    </div>
  );
}
