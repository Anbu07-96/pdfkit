import { Container } from "@/components/layout/container";
import { HeroToolSearch } from "@/components/tools/hero-tool-search";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { siteConfig } from "@/lib/config/site";
import { getToolsByStatus } from "@/lib/tools";
import { ShieldCheck, Zap } from "lucide-react";

export function Hero() {
  const available = getToolsByStatus("AVAILABLE");

  return (
    <section aria-labelledby="hero-title" className="border-b border-border bg-gradient-to-b from-surface-muted/60 via-surface to-background relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-brand/5 via-transparent to-transparent pointer-events-none" />

      <Container className="py-16 sm:py-20 relative">
        <div className="mx-auto max-w-3xl text-center">
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Badge tone="primary" className="px-3 py-1 text-xs">
              <Zap className="mr-1.5 size-3.5" />
              {available.length} Production PDF Tools Live
            </Badge>
            <Badge tone="success" className="px-3 py-1 text-xs">
              <ShieldCheck className="mr-1.5 size-3.5" />
              100% In-Memory Privacy
            </Badge>
          </div>

          <h1
            id="hero-title"
            className="mt-6 text-4xl font-bold tracking-tight text-balance text-foreground sm:text-5xl lg:text-6xl"
          >
            {siteConfig.name}
          </h1>

          <p className="mt-3 text-lg font-medium text-brand">
            {siteConfig.tagline}
          </p>

          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-muted sm:text-lg">
            A fast, privacy-first platform for everyday PDF and document workflows.
            Merge, split, compress, protect, edit, and convert documents locally in memory with zero file tracking.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <ButtonLink href="/tools" variant="primary" size="lg">
              Explore All 33 PDF Tools
            </ButtonLink>
            <ButtonLink href="/pricing" variant="secondary" size="lg">
              View Pricing & Quotas
            </ButtonLink>
          </div>
        </div>

        <div className="mx-auto mt-10 max-w-2xl">
          <HeroToolSearch />
        </div>
      </Container>
    </section>
  );
}
