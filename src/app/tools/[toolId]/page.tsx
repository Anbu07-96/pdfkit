import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ToolPageShell } from "@/components/tools/tool-page-shell";
import { getToolWorkspace } from "@/components/tools/workspaces";
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
    ? " Free to use in your browser, with no account required."
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

  // The workspace is resolved on the server; tools without a real
  // implementation get the "coming soon" shell instead.
  const workspace = isToolUsable(tool) ? getToolWorkspace(tool.id) : null;

  return <ToolPageShell tool={tool} workspace={workspace} />;
}
