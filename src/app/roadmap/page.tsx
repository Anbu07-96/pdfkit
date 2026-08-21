import type { Metadata } from "next";
import { ContentPage } from "@/components/layout/content-page";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = {
  title: "Roadmap",
  description:
    "What has been built in PDFKit so far and what is planned next. Only completed work is marked as done.",
};

const PHASES = [
  {
    title: "Phase 1 — Foundation and product shell",
    status: "Completed" as const,
    items: [
      "Next.js + TypeScript + Tailwind CSS foundation",
      "Design system, light and dark themes",
      "Application shell: navigation, layout, footer",
      "Homepage with search, popular tools, categories, privacy, FAQ",
      "Central tool catalog with 42 tools and honest availability states",
      "Processing contract defined with no implementation",
      "Reusable tool page template and upload interface (selection only)",
      "Automated tests for the catalog, search, theme and key components",
    ],
  },
  {
    title: "Phase 2 — First real PDF processing (Merge PDF)",
    status: "Completed" as const,
    items: [
      "Server-side processing layer: contract, registry, service and error model",
      "Merge PDF processor built on pdf-lib, running only on the server",
      "POST /api/tools/merge-pdf with multipart upload, size and count limits",
      "Server-side PDF signature validation — file names and MIME types are not trusted",
      "Merge workspace: ordering, removal, processing state, real download",
      "In-memory processing with no temporary files and no document logging",
    ],
  },
  {
    title: "Phase 3 — More organise tools",
    status: "Planned" as const,
    items: [
      "Split, extract, delete and reorder pages on the same processing foundation",
      "Page previews and per-page selection",
      "Shared processing UI states across tools",
    ],
  },
  {
    title: "Later phases",
    status: "Planned" as const,
    items: [
      "More organise and convert tools",
      "Editing and security tools",
      "OCR",
      "AI document intelligence",
      "Accounts, storage, billing and a developer API",
    ],
  },
];

export default function RoadmapPage() {
  return (
    <ContentPage
      title="Roadmap"
      intro="PDFKit is built in phases. A feature is only listed as completed once it is actually in the product."
      breadcrumbs={[{ label: "Home", href: "/" }, { label: "Roadmap" }]}
    >
      <ol className="flex flex-col gap-6">
        {PHASES.map((phase) => (
          <li
            key={phase.title}
            className="rounded-xl border border-border bg-surface p-5 shadow-xs"
          >
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-base font-semibold text-foreground">{phase.title}</h2>
              <Badge tone={phase.status === "Completed" ? "success" : "neutral"}>
                {phase.status}
              </Badge>
            </div>
            <ul className="mt-3 flex list-disc flex-col gap-1.5 ps-5 text-sm text-muted">
              {phase.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </ContentPage>
  );
}
