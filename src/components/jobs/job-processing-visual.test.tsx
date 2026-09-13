import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  GenericConversionTreatment,
  JobProcessingVisual,
  PdfToWordTreatment,
  type JobVisualTreatmentProps,
} from "@/components/jobs/job-processing-visual";

/**
 * Phase 75D.4.2 — Intelligent Document Reconstruction visual.
 *
 * These tests pin the component's CONTRACT, not its choreography (CSS does
 * not animate in jsdom):
 * - the reconstruction scene structure per status: source page (frame,
 *   layout guides, five structural blocks, scanning plane), transformation
 *   field (lanes, nodes, particles, typed motes) and the progressively
 *   reconstructed Word page,
 * - that the OLD ring/page-stack concept is fully removed (DOM + CSS),
 * - the decorative guarantee (aria-hidden, zero text, zero JS animation),
 * - the fixed element count (nothing scales with real page counts),
 * - mobile composition, reduced-motion statics and the 3D/loop CSS
 *   contract,
 * - the failure fallback (a broken treatment never breaks the job UI),
 * - and the registry/extensibility behavior.
 */

function scene() {
  return document.querySelector(".job-visual-scene")!;
}

function css() {
  const raw = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
  return raw.slice(raw.indexOf("Phase 75D.4.2"));
}

function source() {
  return readFileSync(
    join(process.cwd(), "src/components/jobs/job-processing-visual.tsx"),
    "utf8",
  );
}

describe("JobProcessingVisual — reconstruction scene structure", () => {
  it("processing: source page, transformation field and Word page in the documented composition", () => {
    render(<JobProcessingVisual toolId="pdf-to-word" status="processing" />);

    const root = screen.getByTestId("job-visual");
    expect(scene().getAttribute("data-status")).toBe("processing");
    expect(scene().className).toContain("is-processing");

    // Source: one PDF page — frame, dashed layout guides, five abstract
    // structural blocks (3 text bars, image region, table region) and a
    // scanning plane. No stacks, no ring.
    const pdf = scene().querySelector(".rec-doc--pdf")!;
    expect(pdf.querySelectorAll(".rec-frame")).toHaveLength(1);
    expect(pdf.querySelectorAll(".rec-guides")).toHaveLength(1);
    expect(pdf.querySelectorAll(".rec-block")).toHaveLength(5);
    expect(pdf.querySelectorAll(".rec-block--bar1, .rec-block--bar2, .rec-block--bar3"))
      .toHaveLength(3);
    expect(pdf.querySelector(".rec-block--image")).not.toBeNull();
    expect(pdf.querySelector(".rec-block--table")).not.toBeNull();
    expect(pdf.querySelector(".rec-scan")).not.toBeNull();

    // Field: three lanes, three processing nodes, three particles and four
    // typed motes whose chips mirror the source blocks.
    const field = scene().querySelector(".rec-field")!;
    expect(field.querySelectorAll(".rec-path")).toHaveLength(3);
    expect(field.querySelectorAll(".rec-node")).toHaveLength(3);
    expect(field.querySelectorAll(".rec-dust")).toHaveLength(3);
    expect(field.querySelectorAll(".rec-mote")).toHaveLength(4);
    expect(field.querySelectorAll(".rec-mote .rec-chip")).toHaveLength(4);
    expect(field.querySelector(".rec-mote--text1 .rec-chip")).not.toBeNull();
    expect(field.querySelector(".rec-mote--image .rec-chip")).not.toBeNull();
    expect(field.querySelector(".rec-mote--table .rec-chip")).not.toBeNull();

    // Target: the Word page reconstructed from guides, frame, four text
    // lines, an image placeholder and a table region.
    const word = scene().querySelector(".rec-doc--word")!;
    expect(word.querySelectorAll(".rec-guides")).toHaveLength(1);
    expect(word.querySelectorAll(".rec-frame")).toHaveLength(1);
    expect(word.querySelectorAll(".rec-wline")).toHaveLength(4);
    expect(word.querySelector(".rec-wimg")).not.toBeNull();
    expect(word.querySelector(".rec-wtable")).not.toBeNull();

    // No outcome badge while work is in flight.
    expect(scene().querySelector(".job-visual-badge")).toBeNull();
    expect(root).toBeInTheDocument();
  });

  it("keeps a fixed element count independent of document size", () => {
    render(<JobProcessingVisual toolId="pdf-to-word" status="processing" />);
    // The whole scene is exactly this many visual elements — nothing is
    // ever added per real PDF page.
    expect(scene().querySelectorAll(".rec-block")).toHaveLength(5);
    expect(scene().querySelectorAll(".rec-mote")).toHaveLength(4);
    expect(scene().querySelectorAll(".rec-wline")).toHaveLength(4);
    expect(scene().querySelectorAll(".rec-node")).toHaveLength(3);
    expect(scene().querySelectorAll(".rec-dust")).toHaveLength(3);
  });

  it("success: the completed document carries a check badge", () => {
    render(<JobProcessingVisual toolId="pdf-to-word" status="success" />);

    expect(scene().getAttribute("data-status")).toBe("success");
    expect(scene().className).toContain("is-success");
    const badge = scene().querySelector(".job-visual-badge");
    expect(badge?.className).toContain("job-visual-badge--success");
    expect(badge?.querySelector("svg")).not.toBeNull();
  });

  it("error: the reconstruction stays visibly incomplete with an error badge", () => {
    render(<JobProcessingVisual toolId="pdf-to-word" status="error" />);

    expect(scene().getAttribute("data-status")).toBe("error");
    expect(scene().className).toContain("is-error");
    expect(
      scene().querySelector(".job-visual-badge--error"),
    ).not.toBeNull();
    // The later reconstruction pieces are absent; the frame and the
    // earliest lines remain — a partial document, not a reset one.
    expect(scene().querySelector(".rec-wline--1")).not.toBeNull();
    expect(scene().querySelector(".rec-wtable")).not.toBeNull();
  });

  it("transitions in place when a mounted scene changes status", () => {
    const { rerender } = render(
      <JobProcessingVisual toolId="pdf-to-word" status="processing" />,
    );
    const processingScene = scene();
    expect(processingScene.getAttribute("data-status")).toBe("processing");

    rerender(<JobProcessingVisual toolId="pdf-to-word" status="success" />);
    expect(scene()).toBe(processingScene);
    expect(scene().getAttribute("data-status")).toBe("success");
    expect(scene().querySelector(".job-visual-badge--success")).not.toBeNull();

    rerender(<JobProcessingVisual toolId="pdf-to-word" status="error" />);
    expect(scene()).toBe(processingScene);
    expect(scene().getAttribute("data-status")).toBe("error");
    expect(scene().querySelector(".job-visual-badge--error")).not.toBeNull();
  });
});

describe("JobProcessingVisual — old concept fully removed", () => {
  it("mounts none of the ring/page-stack primitives in the DOM", () => {
    render(<JobProcessingVisual toolId="pdf-to-word" status="processing" />);
    for (const old of [
      ".job-visual-ring",
      ".job-visual-spark",
      ".job-visual-leaf",
      ".job-visual-arrival",
      ".job-visual-sheet",
      ".job-visual-stack",
      ".job-visual-fragment",
      ".job-visual-flow",
      ".job-visual-doc",
    ]) {
      expect(scene().querySelectorAll(old)).toHaveLength(0);
    }
  });

  it("ships none of the old concept's CSS or keyframes", () => {
    const styles = css();
    for (const old of [
      "job-visual-ring",
      "job-visual-spark",
      "job-visual-leaf",
      "job-visual-arrival",
      "job-visual-sheet",
      "pdfkit-job-leaf",
      "pdfkit-job-arrival",
      "pdfkit-job-wordsettle",
      "pdfkit-job-float",
    ]) {
      expect(styles).not.toContain(old);
    }
  });
});

describe("JobProcessingVisual — CSS contract: 3D, loop, mobile, reduced motion", () => {
  it("builds the scene with perspective and depth, animated by one master loop", () => {
    const styles = css();
    // Perspective on the scene; preserve-3d through the documents so the
    // block lifts (translateZ) render with real depth.
    expect(styles).toMatch(/\.job-visual-scene\s*\{[^}]*perspective:/);
    expect(styles).toMatch(/\.rec-doc\s*\{[^}]*preserve-3d/);
    expect(styles).toMatch(/translate3d\(var\(--lx/);
    // One shared master-loop duration keeps every element in sync without
    // JavaScript (the ambient dust may drift on its own slower clock).
    const loopUsages = styles.match(/7\.5s/g) ?? [];
    expect(loopUsages.length).toBeGreaterThanOrEqual(10);
    // The reconstruction sequence exists in order: guides, frame, lines,
    // image, then table.
    expect(styles).toMatch(/@keyframes rec-w-guides/);
    expect(styles).toMatch(/@keyframes rec-w-frame/);
    expect(styles).toMatch(/@keyframes rec-w-line1/);
    expect(styles).toMatch(/@keyframes rec-w-img/);
    expect(styles).toMatch(/@keyframes rec-w-table/);
    // The scanner and the typed motes exist.
    expect(styles).toMatch(/@keyframes rec-scan/);
    expect(styles).toMatch(/@keyframes rec-mote-text1/);
    expect(styles).toMatch(/@keyframes rec-mote-image/);
  });

  it("recomposes a vertical scene for mobile — not a scaled desktop scene", () => {
    const styles = css();
    const mobile = styles.slice(styles.indexOf("@media (max-width: 639px)"));
    expect(mobile.length).toBeGreaterThan(0);
    // Vertical composition: source above, field column, target below…
    expect(mobile).toMatch(/flex-direction:\s*column/);
    // …with downward mote travel via dedicated keyframes…
    expect(mobile).toMatch(/rec-mote-text1-m/);
    expect(mobile).toMatch(/rec-mote-table-m/);
    // …and chips switching from vertical lanes to horizontal lanes.
    expect(mobile).toMatch(/\.rec-chip\s*\{[^}]*top:\s*0/);
  });

  it("falls back to a static pipeline representation under reduced motion", () => {
    const styles = css();
    const reduced = styles.slice(
      styles.indexOf("@media (prefers-reduced-motion: reduce)"),
    );
    expect(reduced.length).toBeGreaterThan(0);
    // All motion stops…
    expect(reduced).toContain("animation: none !important");
    // …while the pipeline stays legible: blocks held in their lifted
    // positions and pieces resting along the field.
    expect(reduced).toMatch(
      /\.rec-block\s*\{[^}]*translate3d\(var\(--lx/,
    );
    expect(reduced).toMatch(/\.rec-mote\s*\{[^}]*opacity:\s*1/);
    expect(reduced).toMatch(/\.rec-mote--table\s*\{[^}]*translate[XY]\(86%\)/);
  });

  it("stops the loop on success and leaves an incomplete document on error", () => {
    const styles = css();
    // Success stops the travelling pieces…
    expect(styles).toMatch(/is-success \.rec-mote[^{]*\{[^}]*animation:\s*none/);
    // …settles the completed document with a one-shot pop…
    expect(styles).toMatch(/is-success \.rec-doc--word\s*\{[^}]*rec-word-settle/);
    // …the reconstruction animations stop in BOTH outcome states (their
    // base is the completed document)…
    expect(styles).toMatch(/is-success \.rec-wline[^{]*\{[^}]*animation:\s*none/);
    expect(styles).toMatch(/is-error \.rec-wline[^{]*\{[^}]*animation:\s*none/);
    // …and error hides the later reconstruction pieces (image, table,
    // later lines) so the document stays visibly incomplete.
    expect(styles).toMatch(/is-error \.rec-wimg[^{]*\{[^}]*opacity:\s*0/);
    expect(styles).toMatch(/is-error \.rec-wtable[^{]*\{[^}]*opacity:\s*0/);
  });
});

describe("JobProcessingVisual — registry and extensibility", () => {
  it("falls back to a quieter generic reconstruction for unknown tools", () => {
    render(<JobProcessingVisual toolId="merge-pdf" status="processing" />);
    expect(scene().className).toContain("rec-scene--generic");
    // Same primitives, fewer of them: two text motes, one lane, one node.
    expect(scene().querySelectorAll(".rec-mote")).toHaveLength(2);
    expect(scene().querySelectorAll(".rec-path")).toHaveLength(1);
    expect(scene().querySelectorAll(".rec-node")).toHaveLength(1);
    expect(scene().querySelector(".rec-wtable")).toBeNull();
    expect(scene().querySelector(".rec-wimg")).toBeNull();
  });

  it("accepts an explicit treatment — how future tools plug in", () => {
    function CustomTreatment({ status }: JobVisualTreatmentProps) {
      return (
        <div data-status={status} className="job-visual-scene custom-scene" />
      );
    }
    render(
      <JobProcessingVisual treatment={CustomTreatment} status="processing" />,
    );
    expect(scene().className).toContain("custom-scene");
    expect(GenericConversionTreatment).toBeDefined();
    expect(PdfToWordTreatment).toBeDefined();
  });
});

describe("JobProcessingVisual — safety contracts", () => {
  it("is purely decorative: aria-hidden and free of text content", () => {
    render(<JobProcessingVisual toolId="pdf-to-word" status="processing" />);
    const root = screen.getByTestId("job-visual");
    expect(root.getAttribute("aria-hidden")).toBe("true");
    expect(root.textContent).toBe("");
  });

  it("contains no JavaScript timers, frames or polling — CSS motion only", () => {
    const src = source();
    expect(src).not.toMatch(/setTimeout|setInterval|requestAnimationFrame/);
    expect(src).not.toMatch(/new Worker|<canvas|\.getContext\(/);
    expect(src).not.toMatch(/useSpring|useTransition|framer/);
  });

  it("renders nothing when a treatment throws — the job UI carries on", () => {
    function BrokenTreatment(): never {
      throw new Error("visual exploded");
    }
    render(
      <JobProcessingVisual
        treatment={BrokenTreatment}
        status="processing"
      />,
    );
    expect(screen.queryByTestId("job-visual")).toBeNull();
    expect(document.body.textContent).toBe("");
  });
});
