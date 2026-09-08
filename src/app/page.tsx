import { FaqSection } from "@/components/home/faq-section";
import { BulkTools } from "@/components/home/bulk-tools";
import { Hero } from "@/components/home/hero";
import { PopularTools } from "@/components/home/popular-tools";
import { PrivacySection } from "@/components/home/privacy-section";
import { ToolCategories } from "@/components/home/tool-categories";
import { WhyPdfkit } from "@/components/home/why-pdfkit";

export default function HomePage() {
  return (
    <>
      <Hero />
      <PopularTools />
      <ToolCategories />
      <BulkTools />
      <PrivacySection />
      <WhyPdfkit />
      <FaqSection />
    </>
  );
}
