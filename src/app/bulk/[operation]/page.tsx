import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { BulkWorkspace } from "@/components/bulk/bulk-workspace";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { Container } from "@/components/layout/container";
import { ToolIcon } from "@/components/tools/tool-icon";
import { FaqList, type FaqItem } from "@/components/ui/faq-list";
import { getProcessingLimits } from "@/lib/processing/limits";
import { getBulkOperation, BULK_OPERATIONS } from "@/lib/tools/bulk";
import { formatExtensionList } from "@/lib/utils/format";

export function generateStaticParams() {
  return BULK_OPERATIONS.map((operation) => ({ operation: operation.id }));
}

export async function generateMetadata({
  params,
}: PageProps<"/bulk/[operation]">): Promise<Metadata> {
  const { operation: operationId } = await params;
  const operation = getBulkOperation(operationId);
  if (!operation) return { title: "Bulk tool not found" };

  return {
    title: operation.name,
    description: `${operation.description} Free to use, with per-file status, retry and a single ZIP download.`,
    alternates: { canonical: operation.route },
  };
}

function operationFaq(name: string, extensions: string): FaqItem[] {
  return [
    {
      question: `How many files can ${name} process at once?`,
      answer:
        "The batch limit depends on your plan and is shown before you start, along with how much of your daily quota the batch needs. The browser processes files one at a time, so very large batches simply take longer rather than overloading the server.",
    },
    {
      question: "What happens if one file fails?",
      answer:
        "Nothing happens to the others. A failed file is reported with its error message and the batch moves on. You can retry just the failed files afterwards — successfully processed files are kept as they were.",
    },
    {
      question: "Can I cancel a batch?",
      answer:
        "Yes. Cancelling stops the batch from sending the next file. The file currently being processed may still finish on the server, and every result already received stays available for download.",
    },
    {
      question: "Which files does this accept?",
      answer: `${name} accepts ${extensions} files. The server checks the actual file contents, not just the file name, for every single file of the batch.`,
    },
    {
      question: "How is my quota used?",
      answer:
        "Every file counts as one job and its size counts against your daily byte quota, exactly like the single-file tools. Nothing is charged for files that fail.",
    },
  ];
}

export default async function BulkOperationPage({
  params,
}: PageProps<"/bulk/[operation]">) {
  const { operation: operationId } = await params;
  const operation = getBulkOperation(operationId);
  if (!operation) notFound();

  const limits = getProcessingLimits();
  const faq = operationFaq(
    operation.name,
    formatExtensionList(operation.supportedFileTypes),
  );

  return (
    <Container className="py-8 sm:py-12">
      <Breadcrumbs
        items={[
          { label: "Home", href: "/" },
          { label: "Bulk tools", href: "/bulk" },
          { label: operation.name },
        ]}
      />

      <div className="mt-6 grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0">
          <header>
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex size-11 items-center justify-center rounded-xl bg-primary-soft text-primary-soft-foreground">
                <ToolIcon name={operation.icon} className="size-5" />
              </span>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                {operation.name}
              </h1>
            </div>
            <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted">
              {operation.description}
            </p>
          </header>

          <div className="mt-8">
            <BulkWorkspace
              operation={operation}
              limits={{ maxFileSize: limits.maxFileSize }}
            />
          </div>

          <section aria-labelledby="bulk-op-how-it-works" className="mt-12">
            <h2
              id="bulk-op-how-it-works"
              className="text-xl font-semibold text-foreground"
            >
              How it works
            </h2>
            <ol className="mt-4 flex flex-col gap-3">
              {operation.howItWorks.map((step, index) => (
                <li key={step} className="flex gap-3">
                  <span
                    aria-hidden="true"
                    className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-muted text-sm font-semibold text-foreground"
                  >
                    {index + 1}
                  </span>
                  <p className="pt-0.5 text-sm leading-relaxed text-muted">{step}</p>
                </li>
              ))}
            </ol>
          </section>

          <section aria-labelledby="bulk-op-faq" className="mt-12">
            <h2 id="bulk-op-faq" className="text-xl font-semibold text-foreground">
              Frequently asked questions
            </h2>
            <FaqList className="mt-4" items={faq} />
          </section>
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-xl border border-border bg-surface p-5 shadow-xs">
            <div className="flex items-center gap-2">
              <ShieldCheck aria-hidden="true" className="size-5 text-primary" />
              <h2 className="text-sm font-semibold text-foreground">
                Privacy information
              </h2>
            </div>
            <ul className="mt-3 flex flex-col gap-2.5 text-sm text-muted">
              <li>
                Files are sent to the PDFKit server only when the batch starts,
                one file at a time.
              </li>
              <li>
                Each file is processed in memory, never written to disk and
                never stored.
              </li>
              <li>
                Results live in your browser&rsquo;s memory; the batch ZIP is
                built on your device, not on the server.
              </li>
              <li>
                Only counts and timings are logged — never file names or
                contents.
              </li>
            </ul>
          </div>

          <div className="mt-4 rounded-xl border border-border bg-surface p-5 text-sm shadow-xs">
            <p className="text-muted">
              Need just one file converted, or different options per document?{" "}
              <Link
                href={`/tools/${operation.id}`}
                className="font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                Use the single-file {operation.name.replace("Bulk ", "")} tool
              </Link>
              .
            </p>
          </div>
        </aside>
      </div>
    </Container>
  );
}
