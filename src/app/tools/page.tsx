import type { Metadata } from "next";
import { Container } from "@/components/layout/container";
import { ToolExplorer } from "@/components/tools/tool-explorer";
import { getToolsByStatus, TOOLS } from "@/lib/tools";

export const metadata: Metadata = {
  title: "All PDF tools",
  description:
    "Browse every tool planned for PDFKit — organise, convert, edit, secure, OCR and AI document tools. Availability is shown on each tool.",
};

export default async function ToolsPage({ searchParams }: PageProps<"/tools">) {
  const params = await searchParams;
  const rawQuery = params?.q;
  const initialQuery = Array.isArray(rawQuery) ? (rawQuery[0] ?? "") : (rawQuery ?? "");
  const available = getToolsByStatus("AVAILABLE");

  return (
    <Container className="py-10 sm:py-14">
      <header className="max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          All tools
        </h1>
        <p className="mt-3 text-base leading-relaxed text-muted">
          {TOOLS.length} tools across six categories. Search by name, description or
          category. Each card shows its real availability: {available.length} tool
          {available.length === 1 ? " is" : "s are"} implemented today, the rest are
          still being built.
        </p>
      </header>

      <div className="mt-8">
        <ToolExplorer initialQuery={initialQuery} syncQueryToUrl />
      </div>
    </Container>
  );
}
