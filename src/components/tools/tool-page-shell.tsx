import { ArrowRight, Lock, ShieldCheck } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { Container } from "@/components/layout/container";
import { ToolCard } from "@/components/tools/tool-card";
import { ToolIcon } from "@/components/tools/tool-icon";
import { ToolStatusBadge } from "@/components/tools/tool-status-badge";
import { FaqList, type FaqItem } from "@/components/ui/faq-list";
import { UploadZone } from "@/components/upload/upload-zone";
import {
  getCategory,
  getToolsByCategory,
  getToolsByStatus,
  isToolUsable,
  type Tool,
} from "@/lib/tools";
import { formatExtensionList } from "@/lib/utils/format";

function toolFaq(tool: Tool): FaqItem[] {
  const usable = isToolUsable(tool);

  return [
    {
      question: `Can I use ${tool.name} right now?`,
      answer: usable
        ? `Yes. ${tool.name} works today — select your files, arrange them and download the result.`
        : `Not yet. ${tool.name} is part of the planned catalog and its processing has not been built. The page is here so you can see what is coming — nothing is uploaded or converted at this stage.`,
    },
    {
      question: "Which files does this tool accept?",
      answer: `${tool.name} is designed for ${formatExtensionList(
        tool.supportedFileTypes,
      )} files. The server checks the actual file contents, not just the file name.`,
    },
    {
      question: "What happens to my files?",
      answer: usable
        ? "Your files are sent to the PDFKit server, held in memory only while the operation runs, and dropped as soon as the result is returned. They are never written to disk, never stored and never logged."
        : "Nothing is sent anywhere on this page, because this tool has no processing yet. When it ships, files will be handled only for as long as the operation takes and will not be kept afterwards.",
    },
    {
      question: "Is there a size limit?",
      answer: usable
        ? "Yes. Limits are enforced by the server and shown in the upload area. Requests above the limits are rejected before any processing starts."
        : "Limits will be published on this page when the tool ships.",
    },
  ];
}

export interface ToolPageShellProps {
  tool: Tool;
  /**
   * Interactive workspace for tools that are genuinely implemented. When it is
   * omitted, the page shows the disabled upload area with a "Coming soon"
   * explanation instead.
   */
  workspace?: ReactNode;
  /**
   * Phase 75D.6: "compact" renders the Precision Document Bench layout — a
   * single editorial column, the bench workspace as the hero, a quiet trust
   * line, and open hairline-separated sections (no sidebar, no cards in
   * cards). Default "default" is the classic roomy layout used by every
   * other tool page.
   */
  variant?: "default" | "compact";
}

/**
 * Reusable layout for every tool page: breadcrumb, title, working area,
 * privacy information, how it works, related tools and FAQ.
 */
export function ToolPageShell({
  tool,
  workspace,
  variant = "default",
}: ToolPageShellProps) {
  const compact = variant === "compact";
  const category = getCategory(tool.category);
  const usable = isToolUsable(tool);
  const hasWorkspace = usable && Boolean(workspace);
  const related = getToolsByCategory(tool.category)
    .filter((item) => item.id !== tool.id)
    .slice(0, 4);
  // Signpost the tools that do work, so a "coming soon" page is never a dead end.
  const workingTools = getToolsByStatus("AVAILABLE").filter(
    (item) => item.id !== tool.id,
  );

  const workingArea = hasWorkspace ? (
    workspace
  ) : (
    <UploadZone
      label={`Upload your ${formatExtensionList(tool.supportedFileTypes)} files`}
      extensions={tool.supportedFileTypes}
      mimeTypes={tool.acceptedMimeTypes}
      disabled
      disabledBadge="Coming soon"
      disabledReason={
        <>
          <strong className="font-medium text-foreground">
            {tool.name} is not available yet.
          </strong>{" "}
          Processing for this tool has not been built, so file selection is
          turned off. Nothing here uploads, converts or edits a document.
        </>
      }
    />
  );

  return (
    <Container className={compact ? "py-4 sm:py-6" : "py-8 sm:py-12"}>
      <Breadcrumbs
        items={[
          { label: "Home", href: "/" },
          { label: "Tools", href: "/tools" },
          ...(category ? [{ label: category.name, href: category.route }] : []),
          { label: tool.name },
        ]}
      />

      {compact ? (
        /* ------------------------------------------------------------ */
        /* Phase 75D.6 — the Precision Document Bench: one editorial   */
        /* column. The bench is the hero; everything else is open,     */
        /* hairline-separated typography. No sidebar, no nested cards. */
        /* ------------------------------------------------------------ */
        <div className="mx-auto mt-5 w-full max-w-3xl">
          <header>
            <h1 className="bench-title text-foreground">{tool.name}</h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
              {tool.description}
            </p>
          </header>

          <div className="mt-6">{workingArea}</div>

          {!hasWorkspace && workingTools.length > 0 ? (
            <p className="mt-4 text-sm text-muted">
              Working today:{" "}
              {workingTools.map((item, index) => (
                <span key={item.id}>
                  {index > 0 ? ", " : null}
                  <Link
                    href={item.route}
                    className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    {item.name}
                    <ArrowRight aria-hidden="true" className="size-3.5" />
                  </Link>
                </span>
              ))}
              .
            </p>
          ) : null}

          {/* Trust line: private processing stated as a quiet fact, with the
              full policy one disclosure away. Never a card. */}
          <div className="mt-4 flex items-start gap-2.5 text-xs leading-relaxed text-subtle">
            <Lock
              aria-hidden="true"
              className="mt-0.5 size-3.5 shrink-0 text-subtle"
            />
            <div className="min-w-0 flex-1">
              <span className="eyebrow">Private</span>
              <span className="ms-2">
                Processed in memory · Discarded as soon as the result is
                returned · No account, tracking or advertising
              </span>
              <details className="mt-1">
                <summary className="cursor-pointer font-medium text-primary marker:content-['']">
                  Full privacy details
                </summary>
                <ul className="mt-1.5 list-disc space-y-1 ps-4">
                  {usable ? (
                    <>
                      <li>
                        Files are sent to the PDFKit server only when you start
                        the operation.
                      </li>
                      <li>
                        They are processed in memory, never written to disk and
                        never stored.
                      </li>
                      <li>
                        Documents are discarded as soon as the result is
                        returned; only counts and timings are logged, never file
                        names or contents.
                      </li>
                      <li>No account is required and there is no tracking or advertising.</li>
                    </>
                  ) : (
                    <>
                      <li>
                        No processing exists for this tool, so no file leaves
                        your device from this page.
                      </li>
                      <li>
                        When it ships, files will be used only to complete the
                        requested operation.
                      </li>
                      <li>
                        Temporary data will be discarded automatically; documents
                        will not be retained for any other purpose.
                      </li>
                      <li>PDFKit has no advertising or tracking business model.</li>
                    </>
                  )}
                </ul>
              </details>
            </div>
          </div>

          <section aria-labelledby="how-it-works" className="mt-10 border-t border-border pt-6">
            <h2 id="how-it-works" className="eyebrow">
              {usable ? "How it works" : "How it will work"}
            </h2>
            <ol className="mt-4 flex flex-col gap-3">
              {tool.howItWorks.map((step, index) => (
                <li key={step} className="flex gap-4">
                  <span
                    aria-hidden="true"
                    className="mono-tech shrink-0 pt-px text-subtle"
                  >
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <p className="text-sm leading-relaxed text-muted">{step}</p>
                </li>
              ))}
            </ol>
          </section>

          {related.length > 0 ? (
            <section
              aria-labelledby="related-tools"
              className="mt-8 border-t border-border pt-6"
            >
              <h2 id="related-tools" className="eyebrow">
                Related tools
              </h2>
              <ul className="mt-1 divide-y divide-border">
                {related.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={item.route}
                      className="group flex items-baseline justify-between gap-4 py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      <span className="min-w-0">
                        <span className="text-sm font-medium text-foreground transition-opacity duration-150 group-hover:opacity-70">
                          {item.name}
                        </span>
                        <span className="mt-0.5 block truncate text-[13px] text-muted">
                          {item.description}
                        </span>
                      </span>
                      <ArrowRight
                        aria-hidden="true"
                        className="size-4 shrink-0 text-subtle transition-transform duration-150 group-hover:translate-x-0.5"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section
            aria-labelledby="tool-faq"
            className="mt-8 border-t border-border pt-6"
          >
            <h2 id="tool-faq" className="eyebrow">
              Frequently asked questions
            </h2>
            <FaqList className="bench-faq mt-2" items={toolFaq(tool)} />
          </section>
        </div>
      ) : (
        /* ------------------------------------------------------------ */
        /* Default variant — the classic roomy layout, unchanged.       */
        /* ------------------------------------------------------------ */
        <div className="mt-6 grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0">
            <header>
              <div className="flex flex-wrap items-center gap-3">
                <span className="flex size-11 items-center justify-center rounded-xl bg-primary-soft text-primary-soft-foreground">
                  <ToolIcon name={tool.icon} className="size-5" />
                </span>
                <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                  {tool.name}
                </h1>
                <ToolStatusBadge
                  status={tool.status}
                  plannedTier={tool.plannedTier}
                />
              </div>
              <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted">
                {tool.description}
              </p>
            </header>

            <div className="mt-8">
              {workingArea}
              {!hasWorkspace && workingTools.length > 0 ? (
                <p className="mt-4 text-sm text-muted">
                  Working today:{" "}
                  {workingTools.map((item, index) => (
                    <span key={item.id}>
                      {index > 0 ? ", " : null}
                      <Link
                        href={item.route}
                        className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      >
                        {item.name}
                        <ArrowRight aria-hidden="true" className="size-3.5" />
                      </Link>
                    </span>
                  ))}
                  .
                </p>
              ) : null}
            </div>

            <section aria-labelledby="how-it-works" className="mt-12">
              <h2
                id="how-it-works"
                className="text-xl font-semibold text-foreground"
              >
                {usable ? "How it works" : "How it will work"}
              </h2>
              <ol className="mt-4 flex flex-col gap-3">
                {tool.howItWorks.map((step, index) => (
                  <li key={step} className="flex gap-3">
                    <span
                      aria-hidden="true"
                      className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-muted text-sm font-semibold text-foreground"
                    >
                      {index + 1}
                    </span>
                    <p className="pt-0.5 text-sm leading-relaxed text-muted">
                      {step}
                    </p>
                  </li>
                ))}
              </ol>
            </section>

            {related.length > 0 ? (
              <section aria-labelledby="related-tools" className="mt-12">
                <h2
                  id="related-tools"
                  className="text-xl font-semibold text-foreground"
                >
                  Related tools
                </h2>
                <ul className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {related.map((item) => (
                    <ToolCard key={item.id} tool={item} />
                  ))}
                </ul>
              </section>
            ) : null}

            <section aria-labelledby="tool-faq" className="mt-12">
              <h2
                id="tool-faq"
                className="text-xl font-semibold text-foreground"
              >
                Frequently asked questions
              </h2>
              <FaqList className="mt-4" items={toolFaq(tool)} />
            </section>
          </div>

          <aside className="lg:sticky lg:top-24 lg:self-start">
            <div className="rounded-xl border border-border bg-surface p-5 shadow-xs">
              <div className="flex items-center gap-2">
                <ShieldCheck
                  aria-hidden="true"
                  className="size-5 text-primary"
                />
                <h2 className="text-sm font-semibold text-foreground">
                  Privacy information
                </h2>
              </div>
              <ul className="mt-3 flex flex-col gap-2.5 text-sm text-muted">
                {usable ? (
                  <>
                    <li>
                      Files are sent to the PDFKit server only when you start
                      the operation.
                    </li>
                    <li>
                      They are processed in memory, never written to disk and
                      never stored.
                    </li>
                    <li>
                      Documents are discarded as soon as the result is
                      returned; only counts and timings are logged, never file
                      names or contents.
                    </li>
                    <li>
                      No account is required and there is no tracking or
                      advertising.
                    </li>
                  </>
                ) : (
                  <>
                    <li>
                      No processing exists for this tool, so no file leaves
                      your device from this page.
                    </li>
                    <li>
                      When it ships, files will be used only to complete the
                      requested operation.
                    </li>
                    <li>
                      Temporary data will be discarded automatically; documents
                      will not be retained for any other purpose.
                    </li>
                    <li>PDFKit has no advertising or tracking business model.</li>
                  </>
                )}
              </ul>
            </div>

            <dl className="mt-4 rounded-xl border border-border bg-surface p-5 text-sm shadow-xs">
                <div className="flex items-start justify-between gap-4">
                  <dt className="text-muted">Category</dt>
                  <dd className="text-end font-medium text-foreground">
                    {category?.name ?? "—"}
                  </dd>
                </div>
                <div className="mt-3 flex items-start justify-between gap-4">
                  <dt className="text-muted">Input files</dt>
                  <dd className="text-end font-medium text-foreground">
                    {formatExtensionList(tool.supportedFileTypes)}
                  </dd>
                </div>
                <div className="mt-3 flex items-start justify-between gap-4">
                  <dt className="text-muted">Availability</dt>
                  <dd className="text-end font-medium text-foreground">
                    {usable ? "Available" : "Coming soon"}
                  </dd>
                </div>
                <div className="mt-3 flex items-start justify-between gap-4">
                  <dt className="text-muted">Processing</dt>
                  <dd className="text-end font-medium text-foreground">
                    {usable ? "Server-side, in memory" : "Not implemented"}
                  </dd>
                </div>
              </dl>
          </aside>
        </div>
      )}
    </Container>
  );
}
