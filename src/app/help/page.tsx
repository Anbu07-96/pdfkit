import type { Metadata } from "next";
import { ContentPage, Prose } from "@/components/layout/content-page";
import { ButtonLink } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Help",
  description:
    "How to get around PDFKit today, what works, what does not, and where to report a problem.",
};

export default function HelpPage() {
  return (
    <ContentPage
      title="Help"
      intro="A short guide to what the current version of PDFKit can and cannot do."
      breadcrumbs={[{ label: "Home", href: "/" }, { label: "Help" }]}
    >
      <Prose>
        <h2>What works today</h2>
        <ul>
          <li>
            <strong>Merge PDF</strong> — upload two or more PDFs, arrange them in the
            order you want, merge them on the server and download the real result.
          </li>
          <li>
            <strong>Split PDF</strong> — upload one PDF, see its real page count, then
            split every page into its own file or enter page ranges such as{" "}
            <code>1-3, 4-6</code>. Several outputs arrive as a ZIP.
          </li>
          <li>
            <strong>Extract PDF Pages</strong> — keep only the pages you list, in the
            order you list them, as one new PDF.
          </li>
          <li>
            <strong>Delete PDF Pages</strong> — remove the pages you list and keep
            everything else in its original order. You must keep at least one page.
          </li>
          <li>
            <strong>Reorder PDF Pages</strong> — see a real preview of every page,
            then drag them or use the arrow buttons to put them in a new order.
          </li>
          <li>
            <strong>Rotate PDF</strong> — turn individual pages, or every page at
            once, and watch the previews update before you save.
          </li>
          <li>
            <strong>Compress PDF</strong> — make files smaller with real
            before/after numbers. Low and medium are lossless; high also
            rasterises image-heavy pages and says so when it does.
          </li>
          <li>
            <strong>Images to PDF</strong> — turn JPG, JPEG and PNG images into
            one PDF with exactly one page per image, in the order you arrange.
          </li>
          <li>
            <strong>PDF to JPG / PDF to PNG</strong> — export every page as an
            image at 150 DPI. One page gives a single image; longer documents
            download as a ZIP.
          </li>
          <li>
            <strong>Edit PDF Metadata</strong> — see the document&rsquo;s properties
            and change its title, author, subject, keywords or creator, or
            clear them entirely.
          </li>
          <li>Browsing the tool catalog by category.</li>
          <li>Searching tools by name, description or category.</li>
          <li>Opening any tool page to see what the tool will do and what it accepts.</li>
          <li>Switching between light, dark and system themes.</li>
        </ul>

        <h2>What does not work yet</h2>
        <ul>
          <li>
            Every tool other than the eleven above. Their upload areas are
            intentionally disabled and labelled <strong>Coming soon</strong>.
          </li>
          <li>There are no accounts, no cloud storage, no API keys and no billing.</li>
        </ul>

        <h2>Keyboard shortcuts</h2>
        <ul>
          <li>
            <strong>Tab / Shift+Tab</strong> — move between interactive elements. The
            first stop on every page is &ldquo;Skip to main content&rdquo;.
          </li>
          <li>
            <strong>Escape</strong> — clear the search field, close the theme menu or
            close the mobile navigation.
          </li>
          <li>
            <strong>Enter</strong> in the homepage search — open the full catalog
            filtered by your query.
          </li>
          <li>
            <strong>Arrow buttons</strong> on Merge PDF — move a document up or down
            before merging, without needing drag and drop.
          </li>
        </ul>

        <h2>Reporting a problem</h2>
        <ul>
          <li>
            PDFKit is developed in the open. Issues and suggestions belong in the
            project&rsquo;s Git repository, which is the source of truth for the roadmap.
          </li>
        </ul>
      </Prose>

      <div className="mt-8 flex flex-wrap gap-3">
        <ButtonLink href="/tools">Browse tools</ButtonLink>
        <ButtonLink href="/faq" variant="secondary">
          Read the FAQ
        </ButtonLink>
      </div>
    </ContentPage>
  );
}
