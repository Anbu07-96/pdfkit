import { Breadcrumbs, type Crumb } from "@/components/layout/breadcrumbs";
import { Container } from "@/components/layout/container";
import { Badge } from "@/components/ui/badge";
import * as React from "react";

export interface ContentPageProps {
  title: string;
  intro?: React.ReactNode;
  badge?: string;
  breadcrumbs?: Crumb[];
  children: React.ReactNode;
}

/** Shared shell for simple content pages (legal, help, pricing, roadmap). */
export function ContentPage({
  title,
  intro,
  badge,
  breadcrumbs,
  children,
}: ContentPageProps) {
  return (
    <Container className="py-10 sm:py-14">
      {breadcrumbs ? <Breadcrumbs items={breadcrumbs} className="mb-6" /> : null}

      <header className="max-w-2xl">
        {badge ? <Badge tone="neutral">{badge}</Badge> : null}
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          {title}
        </h1>
        {intro ? (
          <div className="mt-3 text-base leading-relaxed text-muted">{intro}</div>
        ) : null}
      </header>

      <div className="mt-10 max-w-3xl">{children}</div>
    </Container>
  );
}

export function Prose({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4 text-sm leading-relaxed text-muted [&_h2]:mt-6 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-foreground [&_li]:ms-5 [&_li]:list-disc [&_strong]:font-medium [&_strong]:text-foreground [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-2">
      {children}
    </div>
  );
}
