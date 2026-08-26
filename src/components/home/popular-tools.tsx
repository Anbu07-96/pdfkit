import { Container } from "@/components/layout/container";
import { ToolCard } from "@/components/tools/tool-card";
import { ButtonLink } from "@/components/ui/button";
import { SectionHeader } from "@/components/ui/section-header";
import { getPopularTools } from "@/lib/tools";

export function PopularTools() {
  const tools = getPopularTools();

  return (
    <section aria-labelledby="popular-tools-title">
      <Container className="py-14 sm:py-16">
        <SectionHeader
          id="popular-tools-title"
          title="Popular Tools"
          description="The everyday document tasks people reach for most often. All 8 popular tools are fully available and ready to use online."
          action={
            <ButtonLink href="/tools" variant="secondary">
              Browse all 33 tools
            </ButtonLink>
          }
        />

        <ul className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {tools.map((tool) => (
            <ToolCard key={tool.id} tool={tool} />
          ))}
        </ul>
      </Container>
    </section>
  );
}
