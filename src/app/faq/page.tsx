import type { Metadata } from "next";
import { HOME_FAQ } from "@/components/home/faq-section";
import { ContentPage } from "@/components/layout/content-page";
import { FaqList } from "@/components/ui/faq-list";

export const metadata: Metadata = {
  title: "FAQ",
  description:
    "Answers about what PDFKit does today, how files are handled, and which tools are planned.",
};

export default function FaqPage() {
  return (
    <ContentPage
      title="Frequently asked questions"
      intro="Honest answers about the current state of the product."
      breadcrumbs={[{ label: "Home", href: "/" }, { label: "FAQ" }]}
    >
      <FaqList items={HOME_FAQ} />
    </ContentPage>
  );
}
