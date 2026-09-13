import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DocumentIntelligenceCoreTreatment,
  GenericConversionTreatment,
  JobProcessingVisual,
  StructuralReconstructionV1,
  type JobVisualTreatmentProps,
} from "@/components/jobs/job-processing-visual";

/**
 * Phase 75D.5 — Document Intelligence Core.
 *
 * These tests pin the component's CONTRACT, not its choreography (CSS does
 * not animate in jsdom):
 * - the active PDF → Word treatment is the Intelligence Core (structure,
 *   fixed particle count, status states),
 * - the Phase 75D.4.2 Structural Reconstruction V1 treatment is preserved
 *   (renders its own classes) but NOT active for pdf-to-word,
 * - the decorative guarantee (aria-hidden, zero text, zero JS animation),
 * - the CSS contract (3D, one master loop, mobile recomposition,
 *   reduced-motion statics, status stops),
 * - the failure fallback and the registry/extensibility behavior.
 */

function scene() {
  return document.querySelector(".job-visual-scene")!;
}

function css() {
  const raw = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
  return raw.slice(raw.indexOf("Phase 75D.5"));
}

describe("JobProcessingVisual — active treatment: Document Intelligence Core", () => {
  it("processing: source signal, transformation fields, spatial core and structured output", () => {
    render(<JobProcessingVisual toolId="pdf-to-word" status="processing" />);

    const root = screen.getByTestId("job-visual");
    expect(scene().getAttribute("data-status")).toBe("processing");
    expect(scene().className).toContain("dic-scene");
    expect(scene().className).toContain("is-processing");

    // Source signal: a compact segmented glyph.
    expect(scene().querySelectorAll(".dic-source .dic-seg")).toHaveLength(3);

    // Transformation fields: paths in and out, three particles each.
    expect(scene().querySelectorAll(".dic-field--in .dic-sig")).toHaveLength(3);
    expect(scene().querySelectorAll(".dic-field--out .dic-out")).toHaveLength(3);
    expect(scene().querySelectorAll(".dic-path")).toHaveLength(2);

    // The intelligence core: precision grid, three layered planes, a
    // nucleus, two orbital rings with four beads, three nodes, two ambient
    // particles.
    const core = scene().querySelector(".dic-core")!;
    expect(core.querySelector(".dic-grid")).not.toBeNull();
    expect(core.querySelectorAll(".dic-plane")).toHaveLength(3);
    expect(core.querySelector(".dic-nucleus")).not.toBeNull();
    expect(core.querySelectorAll(".dic-orbit")).toHaveLength(2);
    expect(core.querySelectorAll(".dic-bead")).toHaveLength(4);
    expect(core.querySelectorAll(".dic-node")).toHaveLength(3);
    expect(core.querySelectorAll(".dic-ambient")).toHaveLength(2);

    // Structured output: six abstract cells (not a document illustration).
    expect(scene().querySelectorAll(".dic-output .dic-cell")).toHaveLength(6);

    // No outcome badge while work is in flight.
    expect(scene().querySelector(".job-visual-badge")).toBeNull();
    expect(root).toBeInTheDocument();
  });

  it("keeps a FIXED particle/element count independent of document size", () => {
    render(<JobProcessingVisual toolId="pdf-to-word" status="processing" />);
    // Exactly 8 travelling/ambient particles and 4 orbital beads — never
    // more, whatever the real page count is.
    expect(scene().querySelectorAll(".dic-sig")).toHaveLength(3);
    expect(scene().querySelectorAll(".dic-out")).toHaveLength(3);
    expect(scene().querySelectorAll(".dic-ambient")).toHaveLength(2);
    expect(scene().querySelectorAll(".dic-bead")).toHaveLength(4);
    expect(scene().querySelectorAll(".dic-node")).toHaveLength(3);
  });

  it("success: the output completes and a check badge appears", () => {
    render(<JobProcessingVisual toolId="pdf-to-word" status="success" />);
    expect(scene().getAttribute("data-status")).toBe("success");
    expect(scene().className).toContain("is-success");
    const badge = scene().querySelector(".job-visual-badge");
    expect(badge?.className).toContain("job-visual-badge--success");
    expect(badge?.querySelector("svg")).not.toBeNull();
  });

  it("error: motion stops with an incomplete output and an error badge", () => {
    render(<JobProcessingVisual toolId="pdf-to-word" status="error" />);
    expect(scene().getAttribute("data-status")).toBe("error");
    expect(scene().className).toContain("is-error");
    expect(scene().querySelector(".job-visual-badge--error")).not.toBeNull();
    expect(scene().querySelector(".dic-cell--1")).not.toBeNull();
  });

  it("transitions in place when a mounted scene changes status", () => {
    const { rerender } = render(
      <JobProcessingVisual toolId="pdf-to-word" status="processing" />,
    );
    const processingScene = scene();
    rerender(<JobProcessingVisual toolId="pdf-to-word" status="success" />);
    expect(scene()).toBe(processingScene);
    expect(scene().getAttribute("data-status")).toBe("success");
    rerender(<JobProcessingVisual toolId="pdf-to-word" status="error" />);
    expect(scene()).toBe(processingScene);
    expect(scene().getAttribute("data-status")).toBe("error");
  });
});

describe("JobProcessingVisual — Structural Reconstruction V1 archive", () => {
  it("is preserved as an exported treatment that still renders its scene", () => {
    render(<StructuralReconstructionV1 status="processing" />);
    // The archived Phase 75D.4.2 scene renders its own primitives…
    expect(document.querySelector(".rec-scene")).not.toBeNull();
    expect(document.querySelectorAll(".rec-block").length).toBe(5);
    expect(document.querySelector(".rec-scan")).not.toBeNull();
    expect(DocumentIntelligenceCoreTreatment).toBeDefined();
  });

  it("is NOT active for pdf-to-word (the registry serves the Intelligence Core)", () => {
    render(<JobProcessingVisual toolId="pdf-to-word" status="processing" />);
    // …and the pdf-to-word tool renders the Intelligence Core, not V1.
    expect(scene().className).toContain("dic-scene");
    expect(scene().querySelectorAll(".rec-doc, .rec-block, .rec-scan")).toHaveLength(0);
  });

  it("keeps the archived CSS in the stylesheet exactly once (no duplication)", () => {
    const raw = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    expect(raw).toContain("ARCHIVED (Phase 75D.4.2)");
    expect(raw.match(/@keyframes rec-scan \{/g)).toHaveLength(1);
    expect(raw.match(/@keyframes dic-sig \{/g)).toHaveLength(1);
  });
});

describe("JobProcessingVisual — CSS contract", () => {
  it("builds the core with genuine 3D and one shared master loop", () => {
    const styles = css();
    expect(styles).toMatch(/\.dic-scene\s*\{[^}]*perspective:/);
    expect(styles).toMatch(/\.dic-core\s*\{[^}]*preserve-3d/);
    expect(styles).toMatch(/translateZ/);
    // One 6s master loop across the choreography (rotors may spin on their
    // own steady clocks).
    const loopUsages = styles.match(/6s/g) ?? [];
    expect(loopUsages.length).toBeGreaterThanOrEqual(8);
    expect(styles).toMatch(/@keyframes dic-sig/);
    expect(styles).toMatch(/@keyframes dic-plane-top/);
    expect(styles).toMatch(/@keyframes dic-cell/);
    expect(styles).toMatch(/@keyframes dic-rotor/);
  });

  it("recomposes a dedicated compact scene for mobile", () => {
    const styles = css();
    const mobile = styles.slice(styles.indexOf("@media (max-width: 639px)"));
    expect(mobile.length).toBeGreaterThan(0);
    expect(mobile).toMatch(/perspective:\s*30rem/);
    // Fewer particles and one orbital ring on mobile.
    expect(mobile).toMatch(/\.dic-sig--3[^{]*\{\s*display:\s*none/);
    expect(mobile).toMatch(/\.dic-orbit--b\s*\{\s*display:\s*none/);
  });

  it("stops the loop on success/error and keeps the output incomplete on error", () => {
    const styles = css();
    expect(styles).toMatch(/is-success \.dic-sig[^{]*\{[^}]*animation:\s*none/);
    expect(styles).toMatch(/is-success \.dic-cell\s*\{[^}]*opacity:\s*1/);
    expect(styles).toMatch(/is-error \.dic-cell[^{]*\{[^}]*opacity:\s*0/);
    expect(styles).toMatch(/is-error \.dic-cell--1[^{]*\{[^}]*opacity:\s*0\.45/);
  });

  it("falls back to a static system composition under reduced motion", () => {
    const styles = css();
    const reduced = styles.slice(
      styles.indexOf("@media (prefers-reduced-motion: reduce)"),
    );
    expect(reduced.length).toBeGreaterThan(0);
    expect(reduced).toContain("animation: none !important");
    expect(reduced).toMatch(/\.dic-sig\s*\{[^}]*opacity:\s*1/);
    expect(reduced).toMatch(/\.dic-cell\s*\{[^}]*opacity:\s*1/);
  });
});

describe("JobProcessingVisual — registry and extensibility", () => {
  it("falls back to the quieter generic reconstruction for unknown tools", () => {
    render(<JobProcessingVisual toolId="merge-pdf" status="processing" />);
    expect(scene().className).toContain("rec-scene--generic");
    expect(scene().querySelectorAll(".rec-mote")).toHaveLength(2);
    expect(scene().querySelectorAll(".dic-core")).toHaveLength(0);
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
    const source = readFileSync(
      join(process.cwd(), "src/components/jobs/job-processing-visual.tsx"),
      "utf8",
    );
    expect(source).not.toMatch(/setTimeout|setInterval|requestAnimationFrame/);
    expect(source).not.toMatch(/new Worker|<canvas|\.getContext\(/);
    expect(source).not.toMatch(
      /useSpring|useTransition|framer-motion|["'\x22]three["'\x22]|gsap|lottie/,
    );
  });

  it("renders nothing when a treatment throws — the job UI carries on", () => {
    function BrokenTreatment(): never {
      throw new Error("visual exploded");
    }
    render(
      <JobProcessingVisual treatment={BrokenTreatment} status="processing" />,
    );
    expect(screen.queryByTestId("job-visual")).toBeNull();
    expect(document.body.textContent).toBe("");
  });
});
