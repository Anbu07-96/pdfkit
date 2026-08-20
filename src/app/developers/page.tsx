import { Code2 } from "lucide-react";
import type { Metadata } from "next";
import { ContentPage, Prose } from "@/components/layout/content-page";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";

export const metadata: Metadata = {
  title: "Developer API",
  description:
    "PDFKit does not offer a public API yet. This page explains what is planned once document processing exists.",
};

export default function DevelopersPage() {
  return (
    <ContentPage
      title="Developer API"
      badge="Not available yet"
      intro="There is no PDFKit API today. There are no endpoints, no API keys and no SDKs — publishing documentation for something that does not exist would be misleading."
      breadcrumbs={[{ label: "Home", href: "/" }, { label: "Developer API" }]}
    >
      <EmptyState
        icon={<Code2 />}
        title="No public API"
        description="An API only makes sense once the processing layer behind it is real. That work has not started."
        action={
          <ButtonLink href="/roadmap" variant="secondary">
            See the roadmap
          </ButtonLink>
        }
      />

      <Prose>
        <h2>How it is being prepared</h2>
        <ul>
          <li>
            The tool catalog is already a single, typed source of truth, so an API can
            expose exactly the same tool definitions the interface uses.
          </li>
          <li>
            The processing boundary is defined as a contract in the codebase
            (<code>src/lib/processing/contract.ts</code>) with no implementation, so the
            future API and the UI can be built against the same shapes.
          </li>
          <li>
            Nothing in the interface talks to a processing service directly, which keeps
            that layer replaceable.
          </li>
        </ul>
      </Prose>
    </ContentPage>
  );
}
