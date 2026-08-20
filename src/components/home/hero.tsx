import { Container } from "@/components/layout/container";
import { HeroToolSearch } from "@/components/tools/hero-tool-search";
import { Badge } from "@/components/ui/badge";
import { TOOLS } from "@/lib/tools";

export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="border-b border-border bg-surface-muted/30">
      <Container className="py-12 sm:py-16">
        <div className="mx-auto max-w-3xl text-center">
          <Badge tone="primary">In development · Phase 1</Badge>
          <h1
            id="hero-title"
            className="mt-4 text-3xl font-semibold tracking-tight text-balance text-foreground sm:text-4xl lg:text-5xl"
          >
            Your documents. Processed simply.
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-muted sm:text-lg">
            PDFKit is building the everyday PDF and document tools — organise, convert,
            edit, secure — into one fast, privacy-conscious web app. Browse the{" "}
            {TOOLS.length} tools planned for the catalog below. Tools go live only once
            they genuinely work.
          </p>
        </div>

        <div className="mx-auto mt-8 max-w-2xl">
          <HeroToolSearch />
        </div>
      </Container>
    </section>
  );
}
