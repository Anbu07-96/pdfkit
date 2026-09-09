import type { Metadata } from "next";
import { ContentPage, Prose } from "@/components/layout/content-page";
import { siteConfig } from "@/lib/config/site";

export const metadata: Metadata = {
  title: "Refund Policy",
  description:
    "How PDFKit handles subscription refunds and cancellations — plain language, no fine print.",
};

/**
 * Phase 66 — refund policy for the monthly-subscription model that actually
 * exists (Razorpay Pro). Tax/legal review markers included; no invented
 * regulatory claims.
 */
export default function RefundPolicyPage() {
  const email = siteConfig.contactEmail;
  return (
    <ContentPage
      title="Refund Policy"
      intro="How cancellations and refunds work for PDFKit Pro subscriptions."
      breadcrumbs={[{ label: "Home", href: "/" }, { label: "Refund Policy" }]}
    >
      <Prose>
        <h2>Cancellation</h2>
        <ul>
          <li>
            You can cancel your Pro subscription at any time from your{" "}
            <a href="/account">account page</a>. Cancellation takes effect at
            the <strong>end of the period you have already paid for</strong>{" "}
            — your Pro quotas continue until then, and no further charges are
            made.
          </li>
          <li>
            Cancelling does not delete your account; it returns to the Free
            plan.
          </li>
        </ul>

        <h2>Refunds</h2>
        <ul>
          <li>
            <strong>Within 7 days of a charge, if you have not used Pro
            quotas:</strong> a full refund of that charge is available on
            request. &quot;Not used&quot; means your daily usage counters show
            little or no Pro-tier processing since the charge.
          </li>
          <li>
            <strong>Duplicate or erroneous charges</strong> (e.g. two charges
            in the same cycle) are refunded in full once identified — just
            email us.
          </li>
          <li>
            <strong>After meaningful use:</strong> subscriptions are monthly
            and cancellable at any time, so charges for periods in which you
            used the service are generally not refunded. If something went
            clearly wrong on our side (extended outage during your paid
            period, a tool failure that consumed your quota), email us and we
            will make it right.
          </li>
          <li>
            Refunds are issued through Razorpay back to the original payment
            method; processing time depends on your bank or UPI provider.
          </li>
        </ul>

        <h2>How to request</h2>
        <ul>
          <li>
            Email{" "}
            {email ? (
              <a href={`mailto:${email}?subject=PDFKit%20refund%20request`}>{email}</a>
            ) : (
              <em>[OWNER ACTION: set NEXT_PUBLIC_CONTACT_EMAIL before public
              launch.]</em>
            )}{" "}
            with the subject &quot;refund request&quot;, the date of the
            charge and the last four characters of your Razorpay payment id.
            <strong> Never send card numbers, CVVs or UPI PINs.</strong>
          </li>
          <li>
            Requests are typically processed within 2–3 business days of
            approval.
          </li>
        </ul>

        <h2>Statutory rights</h2>
        <ul>
          <li>
            Nothing in this policy limits any mandatory consumer rights that
            apply to you under the law of your jurisdiction.
            <em> [OWNER ACTION: have the final policy reviewed against Indian
            consumer law (and any other jurisdiction you sell into) with a
            lawyer or accountant before public launch.]</em>
          </li>
        </ul>
      </Prose>
    </ContentPage>
  );
}
