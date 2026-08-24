import * as React from "react";
import { cn } from "@/lib/utils/cn";

/** Consistent page gutter and max width for every section. */
export interface ContainerProps extends React.HTMLAttributes<HTMLElement> {
  as?: React.ElementType;
}

export function Container({ className, as: Tag = "div", ...props }: ContainerProps) {
  return (
    <Tag className={cn("mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8", className)} {...props} />
  );
}
