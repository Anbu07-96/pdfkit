"use client";

import * as React from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Job processing visual — Phase 75D.4/75D.4.2 prototype (UI-only).
 *
 * A decorative motion layer for the processing experience. The Phase 75D.5
 * concept for PDF → Word is the DOCUMENT INTELLIGENCE CORE: a compact
 * source signal dissolves into particles that enter a central spatial
 * core — layered geometric planes, orbital data points and processing
 * nodes over a precision grid — where they are reorganized, and a
 * structured output assembles from the core's emissions. The story is
 * "analyze → understand → transform → rebuild" as one abstract system,
 * not an illustration of two documents.
 *
 * ARCHIVED TREATMENT: the Phase 75D.4.2 "Intelligent Document
 * Reconstruction" concept is preserved below as
 * `StructuralReconstructionV1` (exported for reference, NOT registered —
 * nothing renders it). Its CSS lives in the clearly-marked "rec-" block
 * in globals.css, which is also used by the generic fallback treatment;
 * restoring the old visual is a one-line registry change.
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
 * ARCHIVED — "Structural Reconstruction V1" (Phase 75D.4.2).
 *
 * The Intelligent Document Reconstruction scene: a source page scanned and
 * deconstructed into structural blocks, a transformation field of lanes,
 * nodes and typed motes, and a progressively reconstructing Word page.
 * Superseded in Phase 75D.5 by `DocumentIntelligenceCoreTreatment`, but
 * preserved here (and via the shared "rec-" CSS) as a reusable reference.
 * It is intentionally NOT registered in TREATMENTS — render it explicitly
 * if it is ever needed again.
 */
export function StructuralReconstructionV1({ status }: JobVisualTreatmentProps) {
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
 * PDF → Word scene (Phase 75D.5) — DOCUMENT INTELLIGENCE CORE.
 *
 * A wide, shallow, centered composition (no two-documents illustration):
 *
 * - SOURCE SIGNAL (left): a compact segmented glyph standing in a slight
 *   3D tilt — the document reduced to a signal. Each loop it pulses and
 *   dissolves, emitting three signal particles that arc into the core.
 * - INTELLIGENCE CORE (center): the dominant object — a faint precision
 *   grid, three layered geometric planes (rotated-square outlines at
 *   different translateZ depths) that breathe in 3D, a soft central nucleus,
 *   two tilted orbital rings carrying four data points, and three spatial
 *   nodes that pulse when particles pass through them.
 * - STRUCTURED OUTPUT (right): abstract segmented geometry that assembles
 *   block by block from the core's emissions — data taking its final
 *   structured form (deliberately NOT a page/document illustration).
 *
 * All elements share ONE 6s master loop: emit → travel → core separates and
 * reorganizes → emit → output assembles → hold → soft reset. Success:
 * particles converge into the output, the core's planes align and settle,
 * the output completes and a check badge appears. Error: motion stops with
 * the output visibly incomplete and a restrained cross badge.
 *
 * Fixed element count: 3 signal particles + 3 output particles + 2 ambient
 * particles (8 total), 4 orbital data points, 3 nodes, 3 planes — nothing
 * scales with document size, and no real content is ever rendered.
 */
export function DocumentIntelligenceCoreTreatment({
  status,
}: JobVisualTreatmentProps) {
  return (
    <div
      data-status={status}
      className={cn("job-visual-scene dic-scene", statusClasses(status))}
    >
      {/* Source signal: a compact segmented glyph. */}
      <div className="dic-source">
        <span className="dic-seg dic-seg--1" />
        <span className="dic-seg dic-seg--2" />
        <span className="dic-seg dic-seg--3" />
      </div>

      {/* Transformation paths into and out of the core. */}
      <div className="dic-field dic-field--in">
        <span className="dic-path" />
        <div className="dic-sig dic-sig--1">
          <span className="dic-dot" />
        </div>
        <div className="dic-sig dic-sig--2">
          <span className="dic-dot" />
        </div>
        <div className="dic-sig dic-sig--3">
          <span className="dic-dot" />
        </div>
      </div>

      {/* The intelligence core. */}
      <div className="dic-core">
        <span className="dic-grid" />
        <div className="dic-planes">
          <span className="dic-plane dic-plane--deep" />
          <span className="dic-plane dic-plane--mid" />
          <span className="dic-plane dic-plane--top" />
        </div>
        <span className="dic-nucleus" />
        <div className="dic-orbit dic-orbit--a">
          <span className="dic-rotor">
            <span className="dic-bead" />
            <span className="dic-bead dic-bead--opposite" />
          </span>
        </div>
        <div className="dic-orbit dic-orbit--b">
          <span className="dic-rotor">
            <span className="dic-bead" />
            <span className="dic-bead dic-bead--opposite" />
          </span>
        </div>
        <span className="dic-node dic-node--1" />
        <span className="dic-node dic-node--2" />
        <span className="dic-node dic-node--3" />
        <span className="dic-ambient dic-ambient--1" />
        <span className="dic-ambient dic-ambient--2" />
      </div>

      {/* Output field: particles leaving the core. */}
      <div className="dic-field dic-field--out">
        <span className="dic-path" />
        <div className="dic-out dic-out--1">
          <span className="dic-dot" />
        </div>
        <div className="dic-out dic-out--2">
          <span className="dic-dot" />
        </div>
        <div className="dic-out dic-out--3">
          <span className="dic-dot" />
        </div>
      </div>

      {/* Structured output geometry. */}
      <div className="dic-output">
        <span className="dic-cell dic-cell--1" />
        <span className="dic-cell dic-cell--2" />
        <span className="dic-cell dic-cell--3" />
        <span className="dic-cell dic-cell--4" />
        <span className="dic-cell dic-cell--5" />
        <span className="dic-cell dic-cell--6" />
      </div>

      {status === "success" || status === "error" ? (
        <span
          className={cn(
            "job-visual-badge dic-badge",
            status === "success"
              ? "job-visual-badge--success"
              : "job-visual-badge--error",
          )}
        >
          <OutcomeBadge status={status} />
        </span>
      ) : null}
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
  // Phase 75D.5: the Document Intelligence Core is the active treatment.
  // The previous concept is archived as StructuralReconstructionV1 above.
  "pdf-to-word": DocumentIntelligenceCoreTreatment,
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
