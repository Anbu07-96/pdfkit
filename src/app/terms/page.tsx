import type { Metadata } from "next";
import { ContentPage, Prose } from "@/components/layout/content-page";
import { siteConfig } from "@/lib/config/site";

export const metadata: Metadata = {
  title: "Terms",
  description:
    "Terms of service for PDFKit: fair-use quotas, account rules, subscriptions and cancellation.",
};

/**
 * Phase 66 — launch-quality terms. Owner/legal placeholders are marked
 * inline and MUST be completed (or reviewed by a lawyer) before public
 * launch; the application-level behavior described here matches what the
 * code actually does.
 */
export default function TermsPage() {
  return (
    <ContentPage
      title="Terms of Service"
      intro="The agreement between you and PDFKit. Plain language, matching what the service actually does."
      breadcrumbs={[{ label: "Home", href: "/" }, { label: "Terms" }]}
    >
      <Prose>
        <h2>Using PDFKit</h2>
        <ul>
          <li>
            PDFKit provides online PDF processing tools. You may use them
            anonymously within daily quotas, or with an account for higher
            quotas as described on the <a href="/pricing">pricing page</a>.
          </li>
          <li>
            The service is provided &quot;as is&quot; and &quot;as
            available&quot;. We aim for reliability but do not promise
            uninterrupted availability; the service may be changed, extended
            or reduced, and tools listed as <em>coming soon</em> are not part
            of what you pay for.
          </li>
          <li>
            Operator: <em>[OWNER ACTION: legal entity / individual name,
            jurisdiction and registered address must be inserted here before
            public launch.]</em>
          </li>
        </ul>

        <h2>Your documents and your rights</h2>
        <ul>
          <li>
            Your documents remain yours. PDFKit processes them only to perform
            the operation you started, in memory, and does not claim any
            ownership or license over them. See the{" "}
            <a href="/privacy">privacy page</a> for the details of data
            handling.
          </li>
          <li>
            Do not upload documents you have no right to process, and do not
            use PDFKit for unlawful purposes.
          </li>
        </ul>

        <h2>Fair use and limits</h2>
        <ul>
          <li>
            Every plan has daily job and byte quotas, per-file size limits,
            rate limits per client, and bulk batch ceilings, as documented on
            the pricing and tool pages. These exist to keep the service
            available to everyone; they may be adjusted with notice.
          </li>
          <li>
            Automated abuse of the service (scraping, attempt flooding,
            bypassing quotas or rate limits) may lead to throttling or account
            suspension.
          </li>
        </ul>

        <h2>Accounts</h2>
        <ul>
          <li>
            You are responsible for keeping your password confidential.
            Passwords are stored only as scrypt hashes; resets are done
            through one-time emailed links.
          </li>
          <li>
            Accounts inactive for an extended period may be cleaned up
            (notified by email beforehand where possible).
          </li>
        </ul>

        <h2>Subscriptions and billing</h2>
        <ul>
          <li>
            The Pro plan is a monthly subscription ({/* price kept in one
            place: the plan catalog */}₹499/month, GST may apply) processed by
            Razorpay. Payment instruments are handled entirely by Razorpay.
          </li>
          <li>
            <strong>Cancellation:</strong> you can cancel at any time from
            your <a href="/account">account page</a>. Cancellation takes
            effect at the end of the period you have already paid for; no
            further charges are made. See the{" "}
            <a href="/refund-policy">refund policy</a> for refunds.
          </li>
          <li>
            Failed payments may pause your subscription (Razorpay retries,
            then halts it) and your account returns to the Free plan when the
            paid period ends.
          </li>
        </ul>

        <h2>Liability</h2>
        <ul>
          <li>
            To the maximum extent permitted by law, PDFKit&apos;s operator is
            not liable for indirect or consequential damages, or for data
            loss. Always keep your own copies of important documents — the
            service processes files in memory and keeps no backups of them.
          </li>
          <li>
            <em>[OWNER ACTION: liability, governing law and dispute-resolution
            clauses should be reviewed by a lawyer for the operating
            jurisdiction before public launch.]</em>
          </li>
        </ul>

        <h2>Changes</h2>
        <ul>
          <li>
            These terms may be updated as the product develops. Material
            changes will be reflected on this page. Continued use after a
            change means you accept the updated terms.
          </li>
          <li>
            Questions:{" "}
            {siteConfig.contactEmail ? (
              <a href={`mailto:${siteConfig.contactEmail}`}>{siteConfig.contactEmail}</a>
            ) : (
              "via the contact page"
            )}
            .
          </li>
        </ul>
      </Prose>
    </ContentPage>
  );
}
