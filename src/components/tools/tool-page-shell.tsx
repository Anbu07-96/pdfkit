import { ArrowRight, ShieldCheck } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { cn } from "@/lib/utils/cn";
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
   * Phase 75D.5: "compact" tightens vertical rhythm (header, spacing, and a
   * consolidated "Trust & details" sidebar) so the primary workflow fits a
   * laptop viewport. Default "default" is the classic roomy layout used by
   * every other tool page.
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

      <div
        className={cn(
          "grid lg:grid-cols-[minmax(0,1fr)_20rem]",
          compact ? "mt-4 gap-6" : "mt-6 gap-10",
        )}
      >
        <div className="min-w-0">
          <header>
            <div className="flex flex-wrap items-center gap-3">
              <span
                className={cn(
                  "flex items-center justify-center rounded-xl bg-primary-soft text-primary-soft-foreground",
                  compact ? "size-9" : "size-11",
                )}
              >
                <ToolIcon
                  name={tool.icon}
                  className={compact ? "size-4" : "size-5"}
                />
              </span>
              <h1
                className={cn(
                  "font-semibold tracking-tight text-foreground",
                  compact ? "text-xl sm:text-2xl" : "text-2xl sm:text-3xl",
                )}
              >
                {tool.name}
              </h1>
              <ToolStatusBadge status={tool.status} plannedTier={tool.plannedTier} />
            </div>
            <p
              className={cn(
                "max-w-2xl leading-relaxed text-muted",
                compact ? "mt-1.5 text-sm" : "mt-3 text-base",
              )}
            >
              {tool.description}
            </p>
          </header>

          <div className={compact ? "mt-4" : "mt-8"}>
            {hasWorkspace ? (
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
            )}

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

          <section aria-labelledby="how-it-works" className={compact ? "mt-8" : "mt-12"}>
            <h2 id="how-it-works" className="text-xl font-semibold text-foreground">
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
                  <p className="pt-0.5 text-sm leading-relaxed text-muted">{step}</p>
                </li>
              ))}
            </ol>
          </section>

          {related.length > 0 ? (
            <section aria-labelledby="related-tools" className={compact ? "mt-8" : "mt-12"}>
              <h2 id="related-tools" className="text-xl font-semibold text-foreground">
                Related tools
              </h2>
              <ul className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                {related.map((item) => (
                  <ToolCard key={item.id} tool={item} />
                ))}
              </ul>
            </section>
          ) : null}

          <section aria-labelledby="tool-faq" className={compact ? "mt-8" : "mt-12"}>
            <h2 id="tool-faq" className="text-xl font-semibold text-foreground">
              Frequently asked questions
            </h2>
            <FaqList className="mt-4" items={toolFaq(tool)} />
          </section>
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          {compact ? (
            <div className="rounded-xl border border-border bg-surface p-4 shadow-xs">
              <div className="flex items-center gap-2">
                <ShieldCheck aria-hidden="true" className="size-4 text-primary" />
                <h2 className="text-sm font-semibold text-foreground">
                  Trust &amp; details
                </h2>
              </div>
              <ul className="mt-2.5 flex flex-col gap-1.5 text-sm text-muted">
                <li className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="size-1.5 shrink-0 rounded-full bg-success"
                  />
                  Private processing — server-side, in memory
                </li>
                <li className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="size-1.5 shrink-0 rounded-full bg-success"
                  />
                  Files discarded as soon as the result is returned
                </li>
                <li className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="size-1.5 shrink-0 rounded-full bg-success"
                  />
                  No account, tracking or advertising
                </li>
              </ul>
              <details className="mt-2 text-sm">
                <summary className="cursor-pointer font-medium text-primary marker:content-['']">
                  Full privacy information
                </summary>
                <ul className="mt-2 flex flex-col gap-2 text-sm text-muted">
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
                    </>
                  )}
                </ul>
              </details>
              <dl className="mt-3 border-t border-border pt-3 text-sm">
                <div className="flex items-start justify-between gap-4">
                  <dt className="text-muted">Category</dt>
                  <dd className="text-end font-medium text-foreground">
                    {category?.name ?? "—"}
                  </dd>
                </div>
                <div className="mt-2 flex items-start justify-between gap-4">
                  <dt className="text-muted">Input</dt>
                  <dd className="text-end font-medium text-foreground">
                    {formatExtensionList(tool.supportedFileTypes)}
                  </dd>
                </div>
                <div className="mt-2 flex items-start justify-between gap-4">
                  <dt className="text-muted">Availability</dt>
                  <dd className="text-end font-medium text-foreground">
                    {usable ? "Available" : "Coming soon"}
                  </dd>
                </div>
                <div className="mt-2 flex items-start justify-between gap-4">
                  <dt className="text-muted">Processing</dt>
                  <dd className="text-end font-medium text-foreground">
                    {usable ? "Server-side, in memory" : "Not implemented"}
                  </dd>
                </div>
              </dl>
            </div>
          ) : (
          <>
          <div className="rounded-xl border border-border bg-surface p-5 shadow-xs">
            <div className="flex items-center gap-2">
              <ShieldCheck aria-hidden="true" className="size-5 text-primary" />
              <h2 className="text-sm font-semibold text-foreground">
                Privacy information
              </h2>
            </div>
            <ul className="mt-3 flex flex-col gap-2.5 text-sm text-muted">
              {usable ? (
                <>
                  <li>
                    Files are sent to the PDFKit server only when you start the
                    operation.
                  </li>
                  <li>
                    They are processed in memory, never written to disk and never
                    stored.
                  </li>
                  <li>
                    Documents are discarded as soon as the result is returned; only
                    counts and timings are logged, never file names or contents.
                  </li>
                  <li>No account is required and there is no tracking or advertising.</li>
                </>
              ) : (
                <>
                  <li>
                    No processing exists for this tool, so no file leaves your device
                    from this page.
                  </li>
                  <li>
                    When it ships, files will be used only to complete the requested
                    operation.
                  </li>
                  <li>
                    Temporary data will be discarded automatically; documents will not
                    be retained for any other purpose.
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
          </>
          )}
        </aside>
      </div>
    </Container>
  );
}
