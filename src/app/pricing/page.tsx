import type { Metadata } from "next";
import { ContentPage, Prose } from "@/components/layout/content-page";
import { ButtonLink } from "@/components/ui/button";
import { Check, Clock } from "lucide-react";
import { PLANS, ANONYMOUS_LIMITS, formatInr } from "@/lib/billing/plans";
import { TOOLS } from "@/lib/tools/catalog";
import { formatBytes } from "@/lib/utils/format";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Simple, transparent pricing for PDFKit. Privacy-first PDF processing with free daily limits and Razorpay Pro upgrades.",
};

/**
 * Phase 66 — pricing rendered from the plan catalog (single source of truth).
 * Only implemented features are advertised; the tool count comes from the
 * catalog's AVAILABLE status, which a test enforces against the processor
 * registry. Nothing here may claim priority processing, offline support or
 * guarantees the product does not actually provide.
 */
export default function PricingPage() {
  const availableTools = TOOLS.filter((t) => t.status === "AVAILABLE").length;
  const comingSoon = TOOLS.length - availableTools;

  return (
    <ContentPage
      title="Simple, Honest Pricing"
      badge="Razorpay Supported"
      intro="Privacy-first PDF processing for individuals and professionals in India and worldwide."
      breadcrumbs={[{ label: "Home", href: "/" }, { label: "Pricing" }]}
    >
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 not-prose mb-10">
        {PLANS.map((plan) => (
          <div
            key={plan.id}
            className={`rounded-2xl border bg-surface p-6 flex flex-col justify-between shadow-xs relative ${
              plan.id === "pro" ? "border-2 border-brand shadow-md" : "border-border"
            }`}
          >
            {plan.id === "pro" ? (
              <div className="absolute -top-3 right-6 rounded-full bg-brand px-3 py-0.5 text-[10px] font-bold text-brand-foreground uppercase tracking-wide">
                Most Popular
              </div>
            ) : null}
            <div>
              <div
                className={`text-xs font-semibold uppercase tracking-wider ${
                  plan.id === "pro" ? "text-brand" : "text-muted"
                }`}
              >
                {plan.name} Plan
              </div>
              <div className="mt-3 flex items-baseline gap-1">
                <span className="text-3xl font-bold text-foreground">
                  {formatInr(plan.monthlyPriceMinor)}
                </span>
                <span className="text-xs text-muted">
                  / month{plan.id === "pro" ? " (GST may apply)" : ""}
                </span>
              </div>
              <p className="mt-2 text-xs text-muted">{plan.tagline}</p>

              <ul className="mt-6 space-y-2.5 text-xs text-foreground">
                {plan.features.map((feature) => (
                  <li key={feature.label} className="flex items-start gap-2">
                    <Check
                      className={`h-4 w-4 shrink-0 ${plan.id === "pro" ? "text-brand" : "text-success"}`}
                      aria-hidden="true"
                    />
                    <span>{feature.label}</span>
                  </li>
                ))}
                <li className="flex items-start gap-2">
                  <Check
                    className={`h-4 w-4 shrink-0 ${plan.id === "pro" ? "text-brand" : "text-success"}`}
                    aria-hidden="true"
                  />
                  <span>{plan.supportLevel}</span>
                </li>
              </ul>
            </div>

            <div className="mt-8">
              <ButtonLink
                href={plan.cta?.href ?? "/account"}
                variant={plan.id === "pro" ? "primary" : "secondary"}
                className="w-full"
              >
                {plan.cta?.label ?? "Upgrade to Pro"}
              </ButtonLink>
            </div>
          </div>
        ))}
      </div>

      <Prose>
        <h2>What every plan includes</h2>
        <ul>
          <li>
            <strong>All {availableTools} available tools</strong> — every plan
            (including anonymous visitors) can use every tool that exists
            today, within daily quotas.
          </li>
          <li>
            <strong>Anonymous use needs no account</strong> —{" "}
            {ANONYMOUS_LIMITS.dailyJobLimit} jobs/day,{" "}
            {formatBytes(ANONYMOUS_LIMITS.dailyByteLimit, 0)} daily volume,
            {ANONYMOUS_LIMITS.bulkFilesPerBatch} files per bulk batch.
          </li>
          <li>
            <strong>Bulk processing</strong> — all seven bulk tools work on
            every plan; higher plans raise the per-batch file and volume
            ceilings (see your plan above).
          </li>
          <li>
            <strong>Privacy-first processing</strong> — documents are processed
            in server memory for the duration of the job and never stored or
            shared with third parties. See the{" "}
            <a href="/privacy">privacy page</a> for exactly what is and is not
            collected.
          </li>
          <li>
            <strong>{comingSoon} more tools are listed as coming soon</strong>{" "}
            <Clock className="inline size-3.5" aria-hidden="true" /> — they are
            marked on their pages and are not sold as part of any plan.
          </li>
        </ul>

        <h2>Payment &amp; billing</h2>
        <ul>
          <li>
            <strong>Payments via Razorpay</strong> — UPI, Google Pay, PhonePe,
            Paytm, Indian credit/debit cards, netbanking and international
            cards. Pro is a monthly subscription ({formatInr(49900)}).
          </li>
          <li>
            <strong>Cancel anytime</strong> — from your{" "}
            <a href="/account">account page</a>. Cancellation takes effect at
            the end of the period you have already paid for; no further
            charges are made.
          </li>
          <li>
            <strong>Business plans</strong> are arranged individually —{" "}
            <a href="/contact">contact us</a> with your volume requirements.
          </li>
          <li>
            Refunds are handled case by case under the{" "}
            <a href="/refund-policy">refund policy</a>.
          </li>
        </ul>
      </Prose>
    </ContentPage>
  );
}
