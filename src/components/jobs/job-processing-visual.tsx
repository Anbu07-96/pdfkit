"use client";

import * as React from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Job processing visual — Phase 75D.4/75D.4.2 prototype (UI-only).
 *
 * A decorative motion layer for the processing experience. The Phase
 * 75D.4.2 concept is INTELLIGENT DOCUMENT RECONSTRUCTION for PDF → Word:
 * the source page is scanned and deconstructs into abstract structural
 * blocks (text bars, an image region, a table region, layout guides), the
 * extracted pieces travel a transformation field of processing nodes and
 * paths, and a Word-style document progressively reconstructs from them —
 * layout frame first, then text lines, image placeholder and table. The
 * story is "your PDF is being analyzed and rebuilt", not a file flying
 * through a ring.
 *
 * It is deliberately built so that it can never affect a job:
 *
 * - It renders ZERO text, zero interactive elements and zero JavaScript
 *   timers/polling — every movement is a CSS `transform`/`opacity`
 *   animation on a fixed set of elements (compositor-friendly, no layout
 *   thrash, nothing per-page: five abstract blocks represent any
 *   document). No canvas, no WebGL, no animation libraries.
 * - Every animated element shares ONE master loop duration (7.5s), so the
 *   choreography stays in sync without any JavaScript clock.
 * - The whole layer is `aria-hidden`: the real, accessible job status
 *   stays where it always was (the workspace's `role="status"`
 *   announcements and panels).
 * - It is wrapped in an error boundary: if any treatment ever throws, the
 *   visual disappears and the surrounding processing UI keeps working.
 * - It is purely additive to the workspace: remove the one usage and the
 *   layer is gone.
 *
 * Reduced motion gets a polished static representation of the full
 * pipeline (deconstructed source, pieces resting in the field, completed
 * reconstruction) with no continuous animation.
 *
 * Extensibility: tools register a treatment by id in TREATMENTS below (or
 * pass one explicitly). PDF → Word ships first; other shapes (tables for
 * Excel, page→image for JPG/PNG, many→one for merge, one→many for split,
 * squeeze for compress, scan-to-text for OCR) are future treatments built
 * from these same primitives. None of them are implemented in this phase.
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

function OutcomeBadge({ status }: { status: "success" | "error" }) {
  return (
    <span
      className={cn(
        "job-visual-badge",
        status === "success"
          ? "job-visual-badge--success"
          : "job-visual-badge--error",
      )}
    >
      {status === "success" ? <CheckMark /> : <CrossMark />}
    </span>
  );
}

/**
 * PDF → Word scene — Intelligent Document Reconstruction.
 *
 * The scene reads left→right on desktop (top→bottom on mobile):
 *
 * 1. SOURCE: a single PDF page — frame, dashed layout guides and five
 *    abstract structural blocks (three text bars, an image region, a table
 *    region). A scanning plane sweeps the page, then the blocks lift out
 *    of the page in depth (translateZ) while the page tilts gently.
 * 2. FIELD: a transformation lattice — three lanes, three processing
 *    nodes that pulse as pieces pass, restrained drifting particles, and
 *    four typed motes (text/text/image/table shapes) that travel the
 *    field. The shapes correspond one-to-one with the source blocks.
 * 3. TARGET: a Word-style page that reconstructs progressively — dashed
 *    layout frame first, then the frame solidifies, text lines draw in
 *    (scaleX), the image placeholder and table region assemble — each
 *    appearing as its mote arrives.
 *
 * Success: the loop stops with everything settled into the completed
 * document, a short settle pop and a check badge. Error: the loop stops
 * with the reconstruction visibly incomplete (frame and early lines only)
 * and a restrained cross badge.
 */
export function PdfToWordTreatment({ status }: JobVisualTreatmentProps) {
  return (
    <div
      data-status={status}
      className={cn("job-visual-scene rec-scene", statusClasses(status))}
    >
      {/* 1 — Source PDF: layout geometry + structural blocks + scanner. */}
      <div className="rec-doc rec-doc--pdf">
        <div className="rec-frame" />
        <div className="rec-guides" />
        <span className="rec-block rec-block--bar1" />
        <span className="rec-block rec-block--bar2" />
        <span className="rec-block rec-block--bar3" />
        <span className="rec-block rec-block--image" />
        <span className="rec-block rec-block--table" />
        <div className="rec-scan" />
      </div>

      {/* 2 — Transformation field: lanes, nodes, particles, typed motes. */}
      <div className="rec-field">
        <span className="rec-path rec-path--top" />
        <span className="rec-path rec-path--mid" />
        <span className="rec-path rec-path--bot" />
        <span className="rec-node rec-node--1" />
        <span className="rec-node rec-node--2" />
        <span className="rec-node rec-node--3" />
        <span className="rec-dust rec-dust--1" />
        <span className="rec-dust rec-dust--2" />
        <span className="rec-dust rec-dust--3" />
        <div className="rec-mote rec-mote--text1">
          <span className="rec-chip" />
        </div>
        <div className="rec-mote rec-mote--text2">
          <span className="rec-chip" />
        </div>
        <div className="rec-mote rec-mote--image">
          <span className="rec-chip" />
        </div>
        <div className="rec-mote rec-mote--table">
          <span className="rec-chip" />
        </div>
      </div>

      {/* 3 — Target Word page: progressive reconstruction. */}
      <div className="rec-doc rec-doc--word">
        <div className="rec-guides" />
        <div className="rec-frame" />
        <span className="rec-wline rec-wline--1" />
        <span className="rec-wline rec-wline--2" />
        <span className="rec-wline rec-wline--3" />
        <span className="rec-wline rec-wline--4" />
        <div className="rec-wimg" />
        <div className="rec-wtable" />
        {status === "success" || status === "error" ? (
          <OutcomeBadge status={status} />
        ) : null}
      </div>
    </div>
  );
}

/**
 * Generic conversion scene for tools without a bespoke treatment yet: the
 * same reconstruction primitives, deliberately quieter — a source page with
 * text bars, one lane with one node, two text motes, and a target page that
 * draws its lines. Future treatments (Excel/JPG/PNG/merge/split/compress/
 * OCR) build on these same primitives; none are implemented in this phase.
 */
export function GenericConversionTreatment({ status }: JobVisualTreatmentProps) {
  return (
    <div
      data-status={status}
      className={cn(
        "job-visual-scene rec-scene rec-scene--generic",
        statusClasses(status),
      )}
    >
      <div className="rec-doc rec-doc--pdf">
        <div className="rec-frame" />
        <div className="rec-guides" />
        <span className="rec-block rec-block--bar1" />
        <span className="rec-block rec-block--bar2" />
        <div className="rec-scan" />
      </div>

      <div className="rec-field">
        <span className="rec-path rec-path--mid" />
        <span className="rec-node rec-node--2" />
        <span className="rec-dust rec-dust--1" />
        <div className="rec-mote rec-mote--text1">
          <span className="rec-chip" />
        </div>
        <div className="rec-mote rec-mote--text2">
          <span className="rec-chip" />
        </div>
      </div>

      <div className="rec-doc rec-doc--word">
        <div className="rec-guides" />
        <div className="rec-frame" />
        <span className="rec-wline rec-wline--1" />
        <span className="rec-wline rec-wline--2" />
        <span className="rec-wline rec-wline--3" />
        {status === "success" || status === "error" ? (
          <OutcomeBadge status={status} />
        ) : null}
      </div>
    </div>
  );
}

/**
 * Tool-id → treatment registry. Future treatments slot in here (Excel:
 * table/grid; PDF→JPG/PNG: page→image; merge: many→one; split: one→many;
 * compress: squeeze; OCR: scan-to-text) and any tool picks its visual up
 * by id.
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
