import type { Metadata } from "next";
import { ContentPage, Prose } from "@/components/layout/content-page";

export const metadata: Metadata = {
  title: "Terms",
  description:
    "Terms for using the current PDFKit preview: provided as-is while the product is in early development.",
};

export default function TermsPage() {
  return (
    <ContentPage
      title="Terms"
      intro="PDFKit is an early-stage project. These terms describe the current preview and will be replaced with full terms before any tool becomes generally available."
      breadcrumbs={[{ label: "Home", href: "/" }, { label: "Terms" }]}
    >
      <Prose>
        <h2>Preview software</h2>
        <ul>
          <li>
            The application is provided as-is, without warranty of any kind, while it is
            under development.
          </li>
          <li>
            Features may change, be renamed or be removed. Availability labels in the
            catalog reflect the current state and are updated as work lands.
          </li>
          <li>
            No document processing service is offered at this time, so no service level
            or result can be promised.
          </li>
        </ul>

        <h2>Acceptable use</h2>
        <ul>
          <li>
            Do not use PDFKit to process documents you have no right to process, or for
            unlawful purposes.
          </li>
          <li>
            Do not attempt to disrupt the service or the infrastructure it runs on.
          </li>
        </ul>

        <h2>Changes</h2>
        <ul>
          <li>
            These terms will be updated as the product develops. Material changes will be
            reflected on this page.
          </li>
        </ul>
      </Prose>
    </ContentPage>
  );
}
