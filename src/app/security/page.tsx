import type { Metadata } from "next";
import { ContentPage, Prose } from "@/components/layout/content-page";
import { siteConfig } from "@/lib/config/site";

export const metadata: Metadata = {
  title: "Security",
  description:
    "How PDFKit protects your documents and account: in-memory processing, hashed credentials, rate limiting, signed webhooks and fail-closed infrastructure.",
};

/**
 * Phase 66 — security page. Every statement here is implemented and
 * verifiable in the codebase; nothing is claimed that does not exist
 * (no certifications, no audits).
 */
export default function SecurityPage() {
  return (
    <ContentPage
      title="Security"
      intro="What PDFKit does, technically, to protect your documents and your account — and what it honestly does not claim."
      breadcrumbs={[{ label: "Home", href: "/" }, { label: "Security" }]}
    >
      <Prose>
        <h2>Document handling</h2>
        <ul>
          <li>
            Files are processed <strong>in server memory</strong> and discarded
            when the response is sent. There is no document storage, no object
            store, no temp files. Verified by file-system audits in staging.
          </li>
          <li>
            File names and contents are never written to logs — only
            operational counters (tool, file count, bytes, duration, outcome).
          </li>
          <li>
            PDF parsing runs in-process with strict input validation (magic
            bytes, size limits, page-count limits, image-count limits) before
            any work starts.
          </li>
        </ul>

        <h2>Account security</h2>
        <ul>
          <li>
            Passwords are stored as <strong>scrypt hashes</strong> (N=16384,
            r=8, p=1, 64-byte key) and compared in constant time. Passwords
            are never logged.
          </li>
          <li>
            Six failed sign-in attempts temporarily lock an account (15
            minutes, doubling up to a cap). Lockout state, not passwords, is
            recorded.
          </li>
          <li>
            Password resets use one-time links, stored only as SHA-256 hashes,
            expiring after 1 hour. A successful reset invalidates existing
            sessions.
          </li>
          <li>
            Sessions are HttpOnly, SameSite=Lax cookies with server-side CSRF
            protection (NextAuth).
          </li>
        </ul>

        <h2>Abuse protection</h2>
        <ul>
          <li>
            Distributed rate limiting (shared Redis counters across all server
            instances): 60 requests/minute per client, with separate budgets
            for registration, password reset and admin endpoints.
          </li>
          <li>
            Client identity is derived from the <strong>last</strong>{" "}
            <code>X-Forwarded-For</code> entry appended by our own reverse
            proxy — spoofed client-supplied headers
            (<code>CF-Connecting-IP</code>, <code>X-Real-IP</code>, forged
            XFF prefixes) do not bypass it. Rate-limit keys are salted hashes
            of the address, not raw IPs.
          </li>
          <li>
            Daily quotas are enforced server-side from the database on every
            request; client-side values are never trusted.
          </li>
        </ul>

        <h2>Payments</h2>
        <ul>
          <li>
            Payment flows run on Razorpay&apos;s infrastructure. PDFKit never
            sees card numbers, UPI credentials or other payment instruments.
          </li>
          <li>
            Every webhook is HMAC-SHA256 signature-verified and
            idempotency-checked before it can change an account. Client-side
            &quot;payment success&quot; alone never upgrades a plan: the
            server verifies Razorpay&apos;s own signature and binds it to the
            subscription created for your account.
          </li>
        </ul>

        <h2>Infrastructure posture</h2>
        <ul>
          <li>
            Security headers on every response: <code>nosniff</code>,{" "}
            <code>X-Frame-Options: DENY</code>, strict{" "}
            <code>Referrer-Policy</code>, a <code>default-src &#39;self&#39;</code>{" "}
            Content-Security-Policy, and a Permissions-Policy denying camera,
            microphone and geolocation.
          </li>
          <li>
            Fail-closed dependencies: if Redis is unavailable and required, the
            service refuses requests rather than dropping its protections.
          </li>
          <li>
            Operational metrics (admin endpoints) are token-gated, constant-time
            compared, rate-limited, and contain aggregates only — no emails,
            IPs, file names or secrets.
          </li>
        </ul>

        <h2>Responsible disclosure</h2>
        <ul>
          <li>
            Found a security issue? Please report it privately via the{" "}
            <a href="/contact">contact page</a> (marked
            &quot;security&quot;) rather than public channels. We will
            acknowledge reports and fix credible issues promptly.
          </li>
          <li>
            We do not run a paid bug bounty at this time and claim no
            certifications (SOC 2, ISO 27001 or similar). If that ever
            changes, it will be stated here with evidence.
          </li>
          <li>
            Interim security contact:{" "}
            {siteConfig.contactEmail ? (
              <a href={`mailto:${siteConfig.contactEmail}`}>{siteConfig.contactEmail}</a>
            ) : (
              <em>[OWNER ACTION: set NEXT_PUBLIC_CONTACT_EMAIL to a monitored
              address before public launch.]</em>
            )}
          </li>
        </ul>
      </Prose>
    </ContentPage>
  );
}
