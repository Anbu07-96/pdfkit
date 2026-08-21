import type { Metadata } from "next";
import { ContentPage, Prose } from "@/components/layout/content-page";

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "How PDFKit handles data today: no accounts, no analytics, and documents processed in memory and discarded immediately.",
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
            The five working tools — <strong>Merge PDF</strong>,{" "}
            <strong>Split PDF</strong>, <strong>Extract PDF Pages</strong>,{" "}
            <strong>Delete PDF Pages</strong> and <strong>Reorder PDF Pages</strong> —
            are the only ones that send data anywhere. When you start the operation,
            the selected files are uploaded to the PDFKit server, processed in memory
            and returned in the response. The page tools also read the page count the
            same way.
          </li>
          <li>
            <strong>Page previews</strong> are rendered on the server too, in memory,
            and returned inside the response itself. They are not written to disk, not
            cached and not reachable by any URL — they exist only in the browser tab
            that requested them, until you leave or reload the page.
          </li>
          <li>
            Those files are never written to disk, never stored and never logged. The
            server keeps only operational counters — tool id, number of files, total
            byte count and duration. File names and document contents are not logged.
          </li>
          <li>
            The result is streamed straight back to your browser — a PDF, or a ZIP when
            an operation produces several documents. Nothing is retained server-side
            once the response has been sent, and there is no download link that anyone
            else could visit.
          </li>
          <li>
            For every other tool, file selection is disabled and nothing leaves your
            device.
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

        <h2>What will change as more tools ship</h2>
        <ul>
          <li>
            Files will continue to be sent only when you explicitly start an operation.
          </li>
          <li>
            Larger documents may eventually need temporary server storage. If that
            becomes necessary, it will be described here before it ships, with
            automatic deletion.
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
