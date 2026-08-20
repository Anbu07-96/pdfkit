import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ToolPageShell } from "@/components/tools/tool-page-shell";
import { getTool, isToolUsable, TOOLS } from "@/lib/tools";

export function generateStaticParams() {
  return TOOLS.map((tool) => ({ toolId: tool.id }));
}

export async function generateMetadata({
  params,
}: PageProps<"/tools/[toolId]">): Promise<Metadata> {
  const { toolId } = await params;
  const tool = getTool(toolId);
  if (!tool) return { title: "Tool not found" };

  const availability = isToolUsable(tool)
    ? ""
    : " This tool is not available yet — processing has not been implemented.";

  return {
    title: tool.name,
    description: `${tool.description}${availability}`,
    alternates: { canonical: tool.route },
  };
}

export default async function ToolPage({ params }: PageProps<"/tools/[toolId]">) {
  const { toolId } = await params;
  const tool = getTool(toolId);
  if (!tool) notFound();

  return <ToolPageShell tool={tool} />;
}
