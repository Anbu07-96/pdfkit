import type { Metadata } from "next";
import { ContentPage, Prose } from "@/components/layout/content-page";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { Tags } from "lucide-react";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "PDFKit pricing has not been finalised. Nothing is for sale yet — the product is still in early development.",
};

export default function PricingPage() {
  return (
    <ContentPage
      title="Pricing"
      badge="Not available yet"
      intro="PDFKit is in early development. There are no plans to buy, no payment processing and no subscriptions — and we will not pretend otherwise."
      breadcrumbs={[{ label: "Home", href: "/" }, { label: "Pricing" }]}
    >
      <EmptyState
        icon={<Tags />}
        title="No plans are on sale"
        description="Billing has not been built. When pricing is introduced it will be published here in full, with no hidden conditions."
        action={
          <ButtonLink href="/tools" variant="secondary">
            Browse the tool catalog
          </ButtonLink>
        }
      />

      <Prose>
        <h2>What we can say today</h2>
        <ul>
          <li>
            <strong>Core document tools are intended to stay free</strong> to use in the
            browser, without an account.
          </li>
          <li>
            <strong>Some AI features are expected to need a paid plan</strong> because
            they cost money to run. Those tools are labelled &ldquo;Coming soon ·
            Pro&rdquo; in the catalog.
          </li>
          <li>
            <strong>Nothing is charged today.</strong> There is no checkout, no card
            form and no trial that converts into a subscription.
          </li>
        </ul>
      </Prose>
    </ContentPage>
  );
}
