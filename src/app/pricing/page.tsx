import type { Metadata } from "next";
import { ContentPage, Prose } from "@/components/layout/content-page";
import { ButtonLink } from "@/components/ui/button";
import { Check } from "lucide-react";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Simple, transparent pricing for PDFKit. Privacy-first PDF processing with free daily limits and Razorpay Pro upgrades.",
};

export default function PricingPage() {
  return (
    <ContentPage
      title="Simple, Honest Pricing"
      badge="Razorpay Supported"
      intro="Privacy-first PDF processing for individuals and professionals in India and worldwide."
      breadcrumbs={[{ label: "Home", href: "/" }, { label: "Pricing" }]}
    >
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 not-prose mb-10">
        {/* Free Plan */}
        <div className="rounded-2xl border border-border bg-surface p-6 flex flex-col justify-between shadow-xs">
          <div>
            <div className="text-xs font-semibold text-muted uppercase tracking-wider">
              Free Plan
            </div>
            <div className="mt-3 flex items-baseline gap-1">
              <span className="text-3xl font-bold text-foreground">₹0</span>
              <span className="text-xs text-muted">/ month</span>
            </div>
            <p className="mt-2 text-xs text-muted">
              Ideal for occasional PDF edits and document tasks. Zero credit card required.
            </p>

            <ul className="mt-6 space-y-2.5 text-xs text-foreground">
              <li className="flex items-center gap-2">
                <Check className="h-4 w-4 text-success shrink-0" />
                <span>50 processing jobs / day</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="h-4 w-4 text-success shrink-0" />
                <span>250 MB daily volume limit</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="h-4 w-4 text-success shrink-0" />
                <span>Access to 33 online tools</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="h-4 w-4 text-success shrink-0" />
                <span>100% In-memory privacy</span>
              </li>
            </ul>
          </div>

          <div className="mt-8">
            <ButtonLink href="/login" variant="secondary" className="w-full">
              Get Started Free
            </ButtonLink>
          </div>
        </div>

        {/* Pro Plan */}
        <div className="rounded-2xl border-2 border-brand bg-surface p-6 flex flex-col justify-between shadow-md relative">
          <div className="absolute -top-3 right-6 rounded-full bg-brand px-3 py-0.5 text-[10px] font-bold text-brand-foreground uppercase tracking-wide">
            Most Popular
          </div>
          <div>
            <div className="text-xs font-semibold text-brand uppercase tracking-wider">
              Pro Plan
            </div>
            <div className="mt-3 flex items-baseline gap-1">
              <span className="text-3xl font-bold text-foreground">₹499</span>
              <span className="text-xs text-muted">/ month (~$5 USD)</span>
            </div>
            <p className="mt-2 text-xs text-muted">
              For power users and professionals who need high daily document throughput.
            </p>

            <ul className="mt-6 space-y-2.5 text-xs text-foreground">
              <li className="flex items-center gap-2">
                <Check className="h-4 w-4 text-brand shrink-0" />
                <span className="font-medium">500 processing jobs / day</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="h-4 w-4 text-brand shrink-0" />
                <span className="font-medium">2 GB daily volume limit</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="h-4 w-4 text-brand shrink-0" />
                <span>Priority processing queue</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="h-4 w-4 text-brand shrink-0" />
                <span>UPI, Cards, Netbanking via Razorpay</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="h-4 w-4 text-brand shrink-0" />
                <span>Cancel anytime instantly</span>
              </li>
            </ul>
          </div>

          <div className="mt-8">
            <ButtonLink href="/account" variant="primary" className="w-full">
              Upgrade to Pro
            </ButtonLink>
          </div>
        </div>

        {/* Business Plan */}
        <div className="rounded-2xl border border-border bg-surface p-6 flex flex-col justify-between shadow-xs">
          <div>
            <div className="text-xs font-semibold text-muted uppercase tracking-wider">
              Business Plan
            </div>
            <div className="mt-3 flex items-baseline gap-1">
              <span className="text-3xl font-bold text-foreground">₹2,499</span>
              <span className="text-xs text-muted">/ month</span>
            </div>
            <p className="mt-2 text-xs text-muted">
              Dedicated volume for teams, organizations, and high-frequency workloads.
            </p>

            <ul className="mt-6 space-y-2.5 text-xs text-foreground">
              <li className="flex items-center gap-2">
                <Check className="h-4 w-4 text-success shrink-0" />
                <span>5,000 processing jobs / day</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="h-4 w-4 text-success shrink-0" />
                <span>20 GB daily volume limit</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="h-4 w-4 text-success shrink-0" />
                <span>Dedicated account support</span>
              </li>
            </ul>
          </div>

          <div className="mt-8">
            <ButtonLink href="/help" variant="secondary" className="w-full">
              Contact Sales
            </ButtonLink>
          </div>
        </div>
      </div>

      <Prose>
        <h2>Payment & Billing Guarantees</h2>
        <ul>
          <li>
            <strong>Primary Payment Gateway:</strong> Razorpay (supporting UPI, Google Pay, PhonePe, Paytm, Indian Credit/Debit Cards, Netbanking, and International Cards).
          </li>
          <li>
            <strong>100% In-Memory Privacy:</strong> Your documents are processed in Node.js server RAM for the duration of the job and never stored on disk or shared with AI providers.
          </li>
          <li>
            <strong>No Surprise Charges:</strong> Subscriptions renew monthly through Razorpay and can be cancelled at any time from your Account dashboard.
          </li>
        </ul>
      </Prose>
    </ContentPage>
  );
}
