import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/layout/container";
import { BulkOperationCard } from "@/components/bulk/bulk-operation-card";
import { BULK_OPERATIONS, BULK_UNAVAILABLE_CONVERSIONS } from "@/lib/tools/bulk";

export const metadata: Metadata = {
  title: "Bulk tools",
  description:
    "Convert many documents at once: bulk PDF to Word, Excel, text, JPG, PNG, bulk images to PDF and bulk image extraction — with per-file status, retry and one ZIP download.",
  alternates: { canonical: "/bulk" },
};

/**
 * Bulk Tools section landing page (Phase 61).
 *
 * Lists every bulk operation honestly: what works today, and the office
 * conversions that are explicitly NOT offered because their engines do not
 * exist yet.
 */
export default function BulkLandingPage() {
  return (
    <Container className="py-10 sm:py-14">
      <header className="max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          Bulk tools
        </h1>
        <p className="mt-3 text-base leading-relaxed text-muted">
          Process many files in one batch: drop them in, watch each file&rsquo;s
          status live, cancel or retry at any time, and download everything as a
          single ZIP. Every file is processed as its own job on the server —
          the same privacy rules apply: in-memory only, never stored, never
          logged by name.
        </p>
      </header>

      <ul className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {BULK_OPERATIONS.map((operation) => (
          <BulkOperationCard key={operation.id} operation={operation} />
        ))}
      </ul>

      <section aria-labelledby="bulk-not-available" className="mt-12">
        <h2 id="bulk-not-available" className="text-xl font-semibold text-foreground">
          Not available in bulk yet
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
          These conversions stay single-file (or are not implemented at all)
          because rendering Office documents faithfully requires engines PDFKit
          deliberately does not ship. They will not appear here until their
          single-file tools genuinely work.
        </p>
        <ul className="mt-4 flex flex-col gap-2">
          {BULK_UNAVAILABLE_CONVERSIONS.map((item) => (
            <li
              key={item.id}
              className="rounded-xl border border-border bg-surface-muted/40 p-4 text-sm"
            >
              <p className="font-medium text-foreground">{item.name}</p>
              <p className="mt-1 text-muted">{item.reason}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="bulk-how-it-works" className="mt-12">
        <h2 id="bulk-how-it-works" className="text-xl font-semibold text-foreground">
          How bulk processing works
        </h2>
        <ol className="mt-4 flex max-w-2xl flex-col gap-3 text-sm leading-relaxed text-muted">
          <li>
            1. Your browser sends the files one at a time, each as its own
            ordinary request. That keeps the server stable and lets you cancel
            or retry individual files.
          </li>
          <li>
            2. Batch limits (files, total upload size, rendered pages, extracted
            images and result size) are shown before you start and enforced
            during the batch.
          </li>
          <li>
            3. Each file counts as one job against your daily quota. The quota
            panel shows exactly what a batch needs before it begins.
          </li>
        </ol>
        <p className="mt-4 text-sm text-muted">
          Looking for the single-file versions?{" "}
          <Link
            href="/tools"
            className="font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Browse all tools
          </Link>
          .
        </p>
      </section>
    </Container>
  );
}
