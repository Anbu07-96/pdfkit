"use client";

import * as React from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Job processing visual — Phase 75D.4/75D.4.1 prototype (UI-only).
 *
 * A decorative motion layer for the processing experience: a 3D document
 * transformation — "PDF document → transformation → Word document" — instead
 * of a bare spinner. It is deliberately built so that it can never affect a
 * job:
 *
 * - It renders ZERO text, zero interactive elements and zero JavaScript
 *   timers/polling — every movement is a CSS `transform`/`opacity` animation
 *   on a fixed, small set of elements (compositor-friendly, no layout
 *   thrash, nothing per-page: a 3-sheet stack represents any document).
 * - The scene is real CSS 3D: `perspective` on the scene, `preserve-3d`
 *   chains through the stacks and the transformation zone, so sheets,
 *   peeling pages and travelling fragments are depth-sorted by the browser.
 *   No WebGL, no canvas, no animation libraries.
 * - The whole layer is `aria-hidden`: the real, accessible job status stays
 *   where it always was (the workspace's `role="status"` announcements and
 *   panels). Screen readers and keyboard users lose nothing.
 * - It is wrapped in an error boundary: if any treatment ever throws, the
 *   visual disappears and the surrounding processing UI continues working.
 * - It is purely additive to the workspace: remove the one usage and the
 *   layer is gone.
 *
 * Mobile gets a deliberately recomposed compact scene (smaller perspective,
 * tighter tilts, a shorter channel, one fewer fragment) — not a scaled-down
 * desktop scene. Under prefers-reduced-motion every animation stops and the
 * static 3D composition (tilted stacks, ring, resting fragments) remains.
 *
 * Extensibility: tools register a treatment by id in TREATMENTS below (or
 * pass one explicitly). PDF → Word ships first; other shapes (tables for
 * Excel, page→image for JPG/PNG, many→one for merge, one→many for split,
 * squeeze for compress) are future treatments over the same primitives.
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

/** The content lines of a source PDF page (fixed count — never per-page). */
function PdfLines() {
  return (
    <>
      <span className="job-visual-pdf-line" />
      <span className="job-visual-pdf-line" />
      <span className="job-visual-pdf-line" />
    </>
  );
}

/** The text lines of the Word page being built (fixed count). */
function WordLines() {
  return (
    <>
      <span className="job-visual-line" />
      <span className="job-visual-line" />
      <span className="job-visual-line" />
      <span className="job-visual-line" />
      <span className="job-visual-line" />
    </>
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
 * PDF → Word scene (Phase 75D.4.1 — 3D transformation):
 *
 * - LEFT: a stack of PDF sheets tilted into depth (`rotateY/rotateX`), three
 *   receding layers behind the face, breathing gently. A sheet periodically
 *   PEELS OFF the stack, straightens and glides into the transformation
 *   zone — the "page separation".
 * - CENTER: the transformation zone — a thin track, a 3D "conversion ring"
 *   the fragments pass through (true depth sorting via `preserve-3d`), and
 *   three page fragments travelling left→right at different `translateZ`
 *   depths (near fragments render larger, far ones smaller — parallax).
 * - RIGHT: the Word stack, mirrored tilt. Its text lines materialise while
 *   sheets ARRIVE from the zone and settle onto the stack — the
 *   "convergence". On success the stack swings to face the viewer, scales
 *   up and settles, and a check badge flips in; on error the fragments
 *   stop, the target tilts away and dims, and a cross badge appears.
 */
export function PdfToWordTreatment({ status }: JobVisualTreatmentProps) {
  return (
    <div
      data-status={status}
      className={cn("job-visual-scene", statusClasses(status))}
    >
      {/* Source: PDF stack in 3D, one sheet peeling toward the zone. */}
      <div className="job-visual-side job-visual-side--pdf">
        <div className="job-visual-stack">
          <span className="job-visual-sheet job-visual-sheet--3" />
          <span className="job-visual-sheet job-visual-sheet--2" />
          <span className="job-visual-sheet job-visual-sheet--1" />
          <div className="job-visual-sheet job-visual-sheet--front">
            <PdfLines />
          </div>
          <span className="job-visual-ground" />
        </div>
        <div className="job-visual-leaf">
          <div className="job-visual-sheet job-visual-sheet--peel">
            <PdfLines />
          </div>
        </div>
      </div>

      {/* Transformation zone: track, 3D conversion ring, travelling
          fragments at different depths. */}
      <div className="job-visual-zone">
        <span className="job-visual-track" />
        <span className="job-visual-ring" />
        <span className="job-visual-spark job-visual-spark--near">
          <span className="job-visual-chip" />
        </span>
        <span className="job-visual-spark job-visual-spark--far">
          <span className="job-visual-chip" />
        </span>
        <span className="job-visual-spark job-visual-spark--mid">
          <span className="job-visual-chip" />
        </span>
      </div>

      {/* Target: Word stack, mirrored tilt, sheets converging in. */}
      <div className="job-visual-side job-visual-side--word">
        <div className="job-visual-stack">
          <div className="job-visual-sheet job-visual-sheet--front">
            <WordLines />
          </div>
          <span className="job-visual-sheet job-visual-sheet--1" />
          <span className="job-visual-ground" />
        </div>
        <div className="job-visual-arrival">
          <div className="job-visual-sheet job-visual-sheet--peel">
            <WordLines />
          </div>
        </div>
        {status === "success" || status === "error" ? (
          <OutcomeBadge status={status} />
        ) : null}
      </div>
    </div>
  );
}

/**
 * Generic conversion scene for tools without a bespoke treatment yet: the
 * same 3D primitives — one tilted source sheet, the ring zone with two
 * fragments, one tilted target — deliberately quieter.
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
      <div className="job-visual-side job-visual-side--pdf">
        <div className="job-visual-stack">
          <span className="job-visual-sheet job-visual-sheet--1" />
          <div className="job-visual-sheet job-visual-sheet--front">
            <PdfLines />
          </div>
          <span className="job-visual-ground" />
        </div>
      </div>

      <div className="job-visual-zone">
        <span className="job-visual-track" />
        <span className="job-visual-ring" />
        <span className="job-visual-spark job-visual-spark--near">
          <span className="job-visual-chip" />
        </span>
        <span className="job-visual-spark job-visual-spark--far">
          <span className="job-visual-chip" />
        </span>
      </div>

      <div className="job-visual-side job-visual-side--word">
        <div className="job-visual-stack">
          <div className="job-visual-sheet job-visual-sheet--front">
            <WordLines />
          </div>
          <span className="job-visual-sheet job-visual-sheet--1" />
          <span className="job-visual-ground" />
        </div>
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
