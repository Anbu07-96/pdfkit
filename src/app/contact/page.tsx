import type { Metadata } from "next";
import { ContentPage, Prose } from "@/components/layout/content-page";
import { siteConfig } from "@/lib/config/site";

export const metadata: Metadata = {
  title: "Contact & Support",
  description:
    "Reach the PDFKit team: support, billing, security reports, and Business-plan inquiries.",
};

/**
 * Phase 66 — contact/support page. The support address comes from
 * configuration (NEXT_PUBLIC_CONTACT_EMAIL) — no invented addresses. When
 * unset, an OWNER ACTION placeholder is shown instead of a fake mailbox.
 */
export default function ContactPage() {
  const email = siteConfig.contactEmail;
  return (
    <ContentPage
      title="Contact & Support"
      intro="How to reach us — and what to expect."
      breadcrumbs={[{ label: "Home", href: "/" }, { label: "Contact" }]}
    >
      <Prose>
        <h2>Support</h2>
        <ul>
          <li>
            For account problems, tool errors or questions:{" "}
            {email ? (
              <a href={`mailto:${email}?subject=PDFKit%20support`}>{email}</a>
            ) : (
              <em>[OWNER ACTION: set NEXT_PUBLIC_CONTACT_EMAIL to a monitored
              support mailbox before public launch.]</em>
            )}
          </li>
          <li>
            Please include what you were doing, the tool involved and (if you
            have one) the batch id shown on the bulk results panel.{" "}
            <strong>Never send passwords or payment details by email.</strong>
          </li>
        </ul>

        <h2>Security reports</h2>
        <ul>
          <li>
            Report security issues privately to the same address with
            &quot;SECURITY&quot; in the subject, or via{" "}
            <a href="https://github.com/Anbu07-96/pdfkit/security/advisories/new">
              GitHub security advisories
            </a>{" "}
            if you prefer. Please do not open public issues for security
            topics. See the <a href="/security">security page</a> for our
            posture.
          </li>
        </ul>

        <h2>Billing & subscriptions</h2>
        <ul>
          <li>
            Cancellations are self-service from your{" "}
            <a href="/account">account page</a> (effective at the end of the
            paid period). For anything else — upgrade problems, duplicate
            charges — email us with the date and the last four characters of
            your Razorpay payment id. Do <strong>not</strong> send card
            numbers.
          </li>
          <li>
            Refunds are handled case by case under the{" "}
            <a href="/refund-policy">refund policy</a>.
          </li>
        </ul>

        <h2>Business plans</h2>
        <ul>
          <li>
            For team or high-volume needs, email{" "}
            {email ? (
              <a href={`mailto:${email}?subject=PDFKit%20Business%20inquiry`}>{email}</a>
            ) : (
              "the support address"
            )}{" "}
            with &quot;Business&quot; in the subject and your expected monthly
            volume. Business tiers are provisioned manually after a short
            exchange about your requirements.
          </li>
        </ul>

        <h2>Response times</h2>
        <ul>
          <li>Support is handled by a small team — expect a reply within 1–2 business days.</li>
          <li>Security reports are prioritized.</li>
        </ul>

        <h2>Company details</h2>
        <ul>
          <li>
            <em>[OWNER ACTION: legal entity name, registered address,
            GSTIN/other tax registration (if applicable) and support hours
            must be inserted here before public launch. Do not publish
            invented details.]</em>
          </li>
        </ul>
      </Prose>
    </ContentPage>
  );
}
