import Link from "next/link";
import { Container } from "@/components/layout/container";
import { FaqList, type FaqItem } from "@/components/ui/faq-list";
import { SectionHeader } from "@/components/ui/section-header";
import { TOOLS } from "@/lib/tools";

export const HOME_FAQ: FaqItem[] = [
  {
    question: "What is PDFKit?",
    answer:
      "PDFKit is a web app for everyday PDF and document tasks — organising pages, converting between formats, editing, securing and, later, OCR and AI document tools. It is in early development: merging, splitting, extracting, deleting, reordering and rotating PDF pages work today, and the remaining tools in the catalog are being built one at a time.",
  },
  {
    question: "Do I need to install anything?",
    answer:
      "No. PDFKit runs in the browser, so there is nothing to download or install. An account is not required to browse the catalog.",
  },
  {
    question: "Can I use PDFKit on mobile?",
    answer:
      "Yes. The interface is responsive and is designed to work from 320px-wide phones through tablets to large desktop screens.",
  },
  {
    question: "How are uploaded files handled?",
    answer:
      "For a working tool, your files are sent to the PDFKit server over HTTPS, held in memory only while the operation runs, and discarded as soon as the result is returned. They are never written to disk, never stored and never logged — only counts and timings are recorded. Tools that are not implemented upload nothing at all.",
  },
  {
    question: "What tools does PDFKit support?",
    answer: (
      <>
        The catalog lists {TOOLS.length} tools across six categories. Twelve are
        implemented and free to use — merge, split, extract, delete, reorder and
        rotate, compress and convert PDF pages; every other tool page states its availability clearly
        instead of pretending to work. You can{" "}
        <Link href="/tools" className="text-primary underline underline-offset-4">
          browse the full catalog
        </Link>{" "}
        to see what is planned.
      </>
    ),
  },
  {
    question: "Will PDFKit support OCR?",
    answer:
      "OCR is planned: image-to-text, making scanned PDFs searchable, and general document text extraction are in the catalog. None of it is implemented yet, so those entries are marked Coming soon.",
  },
  {
    question: "Will PDFKit support AI document tools?",
    answer:
      "AI features such as summarising, asking questions about a document, extracting tables and comparing versions are planned for a later phase. They are listed as Coming soon and several are expected to require a paid plan when they ship.",
  },
];

export function FaqSection() {
  return (
    <section aria-labelledby="faq-title">
      <Container className="py-14 sm:py-16">
        <SectionHeader
          id="faq-title"
          title="Frequently asked questions"
          description="Straight answers about what PDFKit does today and what is still being built."
        />
        <FaqList className="mt-8" items={HOME_FAQ} />
      </Container>
    </section>
  );
}
