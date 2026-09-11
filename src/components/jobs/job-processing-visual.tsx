"use client";

import * as React from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Job processing visual — Phase 75D.4 prototype (UI-only).
 *
 * A decorative motion layer for the processing experience: "documents and
 * data moving through a conversion system" instead of a bare spinner. It is
 * deliberately built so that it can never affect a job:
 *
 * - It renders ZERO text, zero interactive elements and zero JavaScript
 *   timers/polling — every movement is a CSS `transform`/`opacity` animation
 *   on a fixed, small set of elements (compositor-friendly, no layout
 *   thrash, nothing per-page: a 3-page stack represents any document).
 * - The whole layer is `aria-hidden`: the real, accessible job status stays
 *   where it always was (the workspace's `role="status"` announcements and
 *   panels). Screen readers and keyboard users lose nothing.
 * - It is wrapped in an error boundary: if any treatment ever throws, the
 *   visual disappears and the surrounding processing UI continues working.
 * - It is purely additive to the workspace: remove the one usage and the
 *   layer is gone.
 *
 * Extensibility: tools register a treatment by id in TREATMENTS below (or
 * pass one explicitly). PDF → Word ships first; other shapes (tables for
 * Excel, page→image for JPG/PNG, many→one for merge, one→many for split,
 * squeeze for compress) are future treatments over the same scene
 * primitives. Unknown ids get a restrained generic conversion scene.
 */

/** The lifecycle states a treatment can render. */
export type JobVisualStatus = "processing" | "success" | "error";

export interface JobVisualTreatmentProps {
  status: JobVisualStatus;
}

/**
 * If a treatment ever throws (bad data, rendering bug), the visual unmounts
 * silently. The job UI around it is outside the boundary and keeps working.
 */
class JobVisualBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** The status as classes, shared by every treatment's scene root. */
function statusClasses(status: JobVisualStatus): string {
  if (status === "success") return "is-success";
  if (status === "error") return "is-error";
  return "is-processing";
}

function CheckMark() {
  return (
    <svg viewBox="0 0 12 12" className="size-3" fill="none">
      <path
        d="M2.5 6.4 5 8.9l4.5-5.6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CrossMark() {
  return (
    <svg viewBox="0 0 12 12" className="size-3" fill="none">
      <path
        d="M3 3l6 6M9 3l-6 6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * PDF → Word scene: a breathing stack of source pages on the left, page
 * fragments travelling a conversion channel, and a Word document whose text
 * lines materialise on the right. Success completes the document and pops a
 * check; error empties the channel, dims the target and marks it.
 */
export function PdfToWordTreatment({ status }: JobVisualTreatmentProps) {
  return (
    <div
      data-status={status}
      className={cn("job-visual-scene", statusClasses(status))}
    >
      <div className="job-visual-doc job-visual-doc--pdf">
        <span className="job-visual-page job-visual-page--back" />
        <span className="job-visual-page job-visual-page--mid" />
        <div className="job-visual-page job-visual-page--front">
          <span className="job-visual-pdf-line" />
          <span className="job-visual-pdf-line" />
          <span className="job-visual-pdf-line" />
        </div>
      </div>

      <div className="job-visual-flow">
        <span className="job-visual-fragment">
          <span className="job-visual-dot" />
        </span>
        <span className="job-visual-fragment">
          <span className="job-visual-dot" />
        </span>
        <span className="job-visual-fragment">
          <span className="job-visual-dot" />
        </span>
      </div>

      <div className="job-visual-doc job-visual-doc--word">
        <div className="job-visual-page job-visual-wordpage">
          <span className="job-visual-line" />
          <span className="job-visual-line" />
          <span className="job-visual-line" />
          <span className="job-visual-line" />
          <span className="job-visual-line" />
        </div>
        {status === "success" ? (
          <span className="job-visual-badge job-visual-badge--success">
            <CheckMark />
          </span>
        ) : null}
        {status === "error" ? (
          <span className="job-visual-badge job-visual-badge--error">
            <CrossMark />
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Generic conversion scene for tools without a bespoke treatment yet: one
 * page travelling to one document — the same primitives, deliberately
 * quieter.
 */
export function GenericConversionTreatment({ status }: JobVisualTreatmentProps) {
  return (
    <div
      data-status={status}
      className={cn(
        "job-visual-scene job-visual-scene--generic",
        statusClasses(status),
      )}
    >
      <div className="job-visual-doc job-visual-doc--pdf">
        <div className="job-visual-page job-visual-page--front">
          <span className="job-visual-pdf-line" />
          <span className="job-visual-pdf-line" />
          <span className="job-visual-pdf-line" />
        </div>
      </div>

      <div className="job-visual-flow">
        <span className="job-visual-fragment">
          <span className="job-visual-dot" />
        </span>
        <span className="job-visual-fragment">
          <span className="job-visual-dot" />
        </span>
      </div>

      <div className="job-visual-doc job-visual-doc--word">
        <div className="job-visual-page job-visual-wordpage">
          <span className="job-visual-line" />
          <span className="job-visual-line" />
          <span className="job-visual-line" />
        </div>
        {status === "success" ? (
          <span className="job-visual-badge job-visual-badge--success">
            <CheckMark />
          </span>
        ) : null}
        {status === "error" ? (
          <span className="job-visual-badge job-visual-badge--error">
            <CrossMark />
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Tool-id → treatment registry. Future treatments slot in here (Excel:
 * table/grid; PDF→JPG/PNG: page→image; merge: many→one; split: one→many;
 * compress: squeeze) and any tool picks its visual up by id.
 */
const TREATMENTS: Record<string, React.ComponentType<JobVisualTreatmentProps>> = {
  "pdf-to-word": PdfToWordTreatment,
};

export interface JobProcessingVisualProps {
  /** Catalog tool id; selects the registered treatment. */
  toolId?: string;
  /**
   * Explicit treatment override — how a future tool provides its own visual
   * without touching this module's registry.
   */
  treatment?: React.ComponentType<JobVisualTreatmentProps>;
  status: JobVisualStatus;
  className?: string;
}

/**
 * Decorative job-processing visual. Always `aria-hidden` (the real status
 * lives in the surrounding UI) and always safe to remove.
 */
export function JobProcessingVisual({
  toolId,
  treatment,
  status,
  className,
}: JobProcessingVisualProps) {
  const Treatment =
    treatment ?? (toolId !== undefined ? TREATMENTS[toolId] : undefined) ??
    GenericConversionTreatment;

  return (
    <JobVisualBoundary>
      <div
        data-testid="job-visual"
        aria-hidden="true"
        className={cn("job-visual", className)}
      >
        <Treatment status={status} />
      </div>
    </JobVisualBoundary>
  );
}
