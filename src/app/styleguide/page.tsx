import type { Metadata } from "next";
import { StyleguideClient } from "@/app/styleguide/styleguide-client";
import { ContentPage } from "@/components/layout/content-page";

export const metadata: Metadata = {
  title: "Design system",
  description:
    "Internal reference showing PDFKit design tokens and component states in light and dark themes.",
  robots: { index: false, follow: false },
};

export default function StyleguidePage() {
  return (
    <ContentPage
      title="Design system"
      badge="Internal reference"
      intro="Every design token and component state in one place, so both themes can be reviewed side by side. This page is a development aid, not a product feature."
      breadcrumbs={[{ label: "Home", href: "/" }, { label: "Design system" }]}
    >
      <StyleguideClient />
    </ContentPage>
  );
}
