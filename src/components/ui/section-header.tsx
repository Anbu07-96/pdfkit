import * as React from "react";
import { cn } from "@/lib/utils/cn";

export interface SectionHeaderProps {
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
  /** Heading level. Sections inside a page should stay below the `h1`. */
  as?: "h2" | "h3";
  align?: "start" | "center";
  action?: React.ReactNode;
  className?: string;
  id?: string;
}

export function SectionHeader({
  eyebrow,
  title,
  description,
  as: Heading = "h2",
  align = "start",
  action,
  className,
  id,
}: SectionHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between",
        align === "center" && "sm:flex-col sm:items-center sm:text-center",
        className,
      )}
    >
      <div className={cn("max-w-2xl", align === "center" && "mx-auto")}>
        {eyebrow ? (
          <p className="mb-2 text-xs font-semibold tracking-[0.14em] text-primary uppercase">
            {eyebrow}
          </p>
        ) : null}
        <Heading
          id={id}
          className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl"
        >
          {title}
        </Heading>
        {description ? (
          <p className="mt-3 text-base leading-relaxed text-muted">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
