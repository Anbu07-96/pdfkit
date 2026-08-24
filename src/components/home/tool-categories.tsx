import { Container } from "@/components/layout/container";
import { CategoryCard } from "@/components/tools/category-card";
import { SectionHeader } from "@/components/ui/section-header";
import { getCategoriesWithTools } from "@/lib/tools";

export function ToolCategories() {
  const categories = getCategoriesWithTools();

  return (
    <section aria-labelledby="categories-title" className="bg-surface-muted/30 py-14 sm:py-16">
      <Container>
        <SectionHeader
          id="categories-title"
          title="Tool categories"
          description="Everything PDFKit plans to offer, grouped by the job you need done."
        />

        <ul className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {categories.map(({ category, tools }) => (
            <CategoryCard key={category.id} category={category} tools={tools} />
          ))}
        </ul>
      </Container>
    </section>
  );
}
