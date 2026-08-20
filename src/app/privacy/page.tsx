import type { Metadata } from "next";
import { ContentPage, Prose } from "@/components/layout/content-page";

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "How PDFKit handles data today: no accounts, no analytics, no document uploads — because no processing has been implemented yet.",
};

export default function PrivacyPage() {
  return (
    <ContentPage
      title="Privacy"
      intro="This page describes what PDFKit actually does today, not what it might do later."
      breadcrumbs={[{ label: "Home", href: "/" }, { label: "Privacy" }]}
    >
      <Prose>
        <h2>What the current version does</h2>
        <ul>
          <li>
            PDFKit is currently a web interface only. No document processing exists, so
            no document is uploaded to any server from this application.
          </li>
          <li>
            Files chosen in an upload area (where selection is enabled) stay in your
            browser. They are listed so you can see the interface working — nothing is
            transmitted, stored or read beyond the file name, size and type.
          </li>
          <li>There are no accounts, so no personal data is collected.</li>
          <li>
            There is no analytics, advertising or third-party tracking script in the
            application.
          </li>
          <li>
            The only value stored on your device is your theme preference
            (<code>pdfkit-theme</code>) in <code>localStorage</code>.
          </li>
        </ul>

        <h2>What will change when processing is implemented</h2>
        <ul>
          <li>
            Files will be sent to a PDFKit server only when you explicitly start an
            operation.
          </li>
          <li>
            Files will be kept only for as long as the operation requires and deleted
            automatically afterwards.
          </li>
          <li>
            Documents will not be used to train models, will not be indexed and will not
            be shared with third parties beyond what a chosen operation requires.
          </li>
          <li>
            This page will be updated before any of that goes live, and the change will
            be visible in the repository history.
          </li>
        </ul>

        <h2>What we do not claim</h2>
        <ul>
          <li>
            PDFKit does not claim any certification, audit or regulatory compliance. No
            such claim will appear here unless it is real and verifiable.
          </li>
        </ul>
      </Prose>
    </ContentPage>
  );
}
