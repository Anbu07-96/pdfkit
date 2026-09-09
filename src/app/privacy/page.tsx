import type { Metadata } from "next";
import { ContentPage, Prose } from "@/components/layout/content-page";
import { siteConfig } from "@/lib/config/site";

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "How PDFKit handles your data: in-memory document processing, operational counters only, hashed passwords, and no tracking scripts.",
};

/**
 * Phase 66 — launch-quality privacy page.
 *
 * RULE: this page describes what the application ACTUALLY does (verified in
   Phase 65 staging: log scans, metrics scans, temp-file audits). Owner
 * placeholders (company name, addresses, legal entity) are marked inline —
   they must be filled in before public launch.
 */
export default function PrivacyPage() {
  return (
    <ContentPage
      title="Privacy"
      intro="This page describes exactly what PDFKit does with your data today — no more, no less."
      breadcrumbs={[{ label: "Home", href: "/" }, { label: "Privacy" }]}
    >
      <Prose>
        <h2>Documents: processed in memory, never stored</h2>
        <ul>
          <li>
            When you start an operation, the selected files are uploaded to the
            PDFKit server over HTTPS, processed <strong>in memory</strong>, and
            returned in the response. They are never written to disk, never
            cached, never logged and never shared with third parties — no AI
            providers, no analytics, no advertising networks.
          </li>
          <li>
            Nothing is retained server-side once the response has been sent.
            There is no download link anyone else could visit, and no copy of
            your document remains on the server.
          </li>
          <li>
            Passwords typed for <strong>Password Protect</strong> and{" "}
            <strong>Unlock PDF</strong> travel once, inside that request, and
            are used in memory only. They are never written to logs or stored.
          </li>
          <li>
            <strong>Bulk tools</strong> send your files one at a time from your
            browser and assemble the final ZIP on your device. The same
            in-memory, never-stored rules apply to each file.
          </li>
          <li>
            Tools that are not implemented yet do not accept file uploads at
            all — nothing leaves your device for them.
          </li>
        </ul>

        <h2>What the server records about processing</h2>
        <ul>
          <li>
            Operational counters only: tool id, number of files, total bytes,
            duration, and outcome (success or error code). <strong>File names
            and document contents are never logged.</strong>
          </li>
          <li>
            Bulk batches carry a random batch id (used to correlate the
            per-file requests of one batch). It contains no information about
            your files.
          </li>
          <li>
            Rate limiting and abuse protection store a <strong>salted hash</strong>{" "}
            of your IP address — not the address itself — for at most a
            minute-level window. Raw IP addresses are not written to
            application logs.
          </li>
        </ul>

        <h2>Accounts (optional)</h2>
        <ul>
          <li>
            Accounts are optional — every tool works without one, within
            anonymous daily quotas.
          </li>
          <li>
            If you register, we store your <strong>email address</strong>, a{" "}
            <strong>scrypt hash of your password</strong> (the password itself
            is never stored or logged), your display name (optional), plan
            tier, verification state and daily usage counters.
          </li>
          <li>
            Verification and password-reset emails contain one-time links that
            expire (24 hours for verification, 1 hour for resets). Reset links
            are stored only as SHA-256 hashes — a database leak does not
            reveal usable links.
          </li>
          <li>
            After 6 failed sign-in attempts an account is temporarily locked
            (15 minutes, doubling with further attempts). We record that this
            happened — not the attempted passwords.
          </li>
          <li>
            You can request account deletion at any time via{" "}
            <a href="/contact">the contact page</a>; account data (email,
            settings, usage history) will be removed. Operational aggregates
            that no longer identify you are retained.
          </li>
        </ul>

        <h2>Payments (Razorpay)</h2>
        <ul>
          <li>
            Pro subscriptions are processed by <strong>Razorpay</strong>. Card
            data, UPI credentials and other payment details are entered on
            Razorpay&apos;s pages and go directly to Razorpay — PDFKit never
            sees or stores them.
          </li>
          <li>
            We store your Razorpay customer/subscription identifiers, plan
            tier and billing status so your entitlements survive redeploys.
            These identifiers are never shown to other users.
          </li>
          <li>
            When payment events arrive (activation, charge, cancellation),
            Razorpay signs them and we verify that signature before changing
            anything on your account.
          </li>
        </ul>

        <h2>Cookies and local storage</h2>
        <ul>
          <li>
            If you sign in: a single <strong>session cookie</strong> (HttpOnly,
            SameSite=Lax) and NextAuth&apos;s CSRF cookie. No advertising or
            analytics cookies.
          </li>
          <li>
            On your device: your theme preference (<code>pdfkit-theme</code>)
            in <code>localStorage</code>. Nothing else.
          </li>
          <li>
            Because only essential cookies are used, PDFKit does not display a
            cookie consent banner.
          </li>
        </ul>

        <h2>Email</h2>
        <ul>
          <li>
            We send transactional email only: address verification,
            password-reset links, and billing-related notices for subscribed
            accounts. No newsletters, no marketing lists.
          </li>
        </ul>

        <h2>What we do not claim</h2>
        <ul>
          <li>
            No certification, audit or regulatory compliance (SOC 2, ISO, GDPR
            certification) is claimed. No such claim will appear here unless it
            is real and verifiable.
          </li>
          <li>
            In-memory processing is a strong architectural privacy guarantee
            for what the server does with your files — it is not a promise
            that infrastructure can never fail.
          </li>
        </ul>

        <h2>Changes</h2>
        <ul>
          <li>
            If this policy ever changes materially, the change will be
            reflected on this page and in the repository history before it
            takes effect.
          </li>
          <li>
            Operator details: <em>[OWNER ACTION: legal entity name, contact
            address and data-protection contact must be inserted here before
            public launch.]</em> Interim contact:{" "}
            {siteConfig.contactEmail ? (
              <a href={`mailto:${siteConfig.contactEmail}`}>{siteConfig.contactEmail}</a>
            ) : (
              "the contact page"
            )}
            .
          </li>
        </ul>
      </Prose>
    </ContentPage>
  );
}
