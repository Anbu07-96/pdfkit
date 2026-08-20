import { FaqSection } from "@/components/home/faq-section";
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
      <PrivacySection />
      <WhyPdfkit />
      <FaqSection />
    </>
  );
}
