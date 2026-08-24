import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { Container } from "@/components/layout/container";
import { ToolCard } from "@/components/tools/tool-card";
import { ToolIcon } from "@/components/tools/tool-icon";
import { TOOL_CATEGORIES, getCategory, getToolsByCategory } from "@/lib/tools";

export function generateStaticParams() {
  return TOOL_CATEGORIES.map((category) => ({ categoryId: category.id }));
}

export async function generateMetadata({
  params,
}: PageProps<"/categories/[categoryId]">): Promise<Metadata> {
  const { categoryId } = await params;
  const category = getCategory(categoryId);
  if (!category) return { title: "Category not found" };

  return {
    title: category.name,
    description: category.description,
    alternates: { canonical: category.route },
  };
}

export default async function CategoryPage({
  params,
}: PageProps<"/categories/[categoryId]">) {
  const { categoryId } = await params;
  const category = getCategory(categoryId);
  if (!category) notFound();

  const tools = getToolsByCategory(category.id);

  return (
    <Container className="py-10 sm:py-14">
      <Breadcrumbs
        items={[
          { label: "Home", href: "/" },
          { label: "Tools", href: "/tools" },
          { label: category.name },
        ]}
      />

      <header className="mt-6 max-w-2xl">
        <div className="flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-xl bg-primary-soft text-primary-soft-foreground">
            <ToolIcon name={category.icon} />
          </span>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            {category.name}
          </h1>
        </div>
        <p className="mt-3 text-base leading-relaxed text-muted">
          {category.description} {tools.length} tools are planned in this category and
          each one shows whether it is ready to use.
        </p>
      </header>

      <ul className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {tools.map((tool) => (
          <ToolCard key={tool.id} tool={tool} />
        ))}
      </ul>
    </Container>
  );
}
