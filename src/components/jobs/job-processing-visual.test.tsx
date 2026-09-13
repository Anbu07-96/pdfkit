import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DocumentIntelligenceCoreTreatment,
  GenericConversionTreatment,
  JobProcessingVisual,
  StructuralReconstructionV1,
  TypesettingFieldTreatment,
  type JobVisualTreatmentProps,
} from "@/components/jobs/job-processing-visual";

/**
 * Phase 75D.6 — The Typesetting Field.
 *
 * These tests pin the component's CONTRACT, not its choreography (CSS does
 * not animate in jsdom):
 * - the active PDF → Word treatment is the Typesetting Field (structure,
 *   fixed element count, phase-locked caret, status states),
 * - the earlier concepts are preserved as archived references
 *   (StructuralReconstructionV1 from 75D.4.2, DocumentIntelligenceCore
 *   from 75D.5) but NOT active for pdf-to-word,
 * - the decorative guarantee (aria-hidden, zero text, zero JS animation),
 * - the CSS contract (one 6s loop, container-query caret sweep, mobile
 *   recomposition, reduced-motion statics, status stops),
 * - the failure fallback and the registry/extensibility behavior.
 */

function scene() {
  return document.querySelector(".job-visual-scene")!;
}

function css() {
  const raw = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
  return raw.slice(raw.indexOf("Phase 75D.6"));
}

describe("JobProcessingVisual — active treatment: Typesetting Field", () => {
  it("processing: baselines, scattered text marks, ambient specks and the working caret", () => {
    render(<JobProcessingVisual toolId="pdf-to-word" status="processing" />);

    const root = screen.getByTestId("job-visual");
    expect(scene().getAttribute("data-status")).toBe("processing");
    expect(scene().className).toContain("ts-scene");
    expect(scene().className).toContain("is-processing");

    // The ruled sheet: five baselines.
    expect(scene().querySelectorAll(".ts-base")).toHaveLength(5);
    // Abstract text marks — words/lines, never file icons.
    expect(scene().querySelectorAll(".ts-mark")).toHaveLength(8);
    // Two quiet ambient specks.
    expect(scene().querySelectorAll(".ts-speck")).toHaveLength(2);
    // The signature: exactly one working caret.
    expect(scene().querySelectorAll(".ts-caret")).toHaveLength(1);

    // No outcome badge while work is in flight.
    expect(scene().querySelector(".job-visual-badge")).toBeNull();
    expect(root).toBeInTheDocument();
  });

  it("keeps a FIXED element count independent of document size", () => {
    render(<JobProcessingVisual toolId="pdf-to-word" status="processing" />);
    // 5 + 8 + 2 + 1 = 16 fixed elements — never more, whatever the real
    // page count is. No random DOM, no per-page scaling.
    const all = scene().querySelectorAll(".ts-base, .ts-mark, .ts-speck, .ts-caret");
    expect(all).toHaveLength(16);
  });

  it("success: the marks set, the caret parks and blinks, a check badge appears", () => {
    render(<JobProcessingVisual toolId="pdf-to-word" status="success" />);
    expect(scene().getAttribute("data-status")).toBe("success");
    expect(scene().className).toContain("is-success");
    const badge = scene().querySelector(".job-visual-badge");
    expect(badge?.className).toContain("job-visual-badge--success");
    expect(badge?.querySelector("svg")).not.toBeNull();
  });

  it("error: the caret stops mid-field and the marks never set", () => {
    render(<JobProcessingVisual toolId="pdf-to-word" status="error" />);
    expect(scene().getAttribute("data-status")).toBe("error");
    expect(scene().className).toContain("is-error");
    expect(scene().querySelector(".job-visual-badge--error")).not.toBeNull();
    expect(scene().querySelector(".ts-mark--1")).not.toBeNull();
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

describe("JobProcessingVisual — archived treatments", () => {
  it("Structural Reconstruction V1 (75D.4.2) is preserved and still renders", () => {
    render(<StructuralReconstructionV1 status="processing" />);
    expect(document.querySelector(".rec-scene")).not.toBeNull();
    expect(document.querySelectorAll(".rec-block").length).toBe(5);
    expect(document.querySelector(".rec-scan")).not.toBeNull();
  });

  it("Document Intelligence Core (75D.5) is preserved and still renders", () => {
    render(<DocumentIntelligenceCoreTreatment status="processing" />);
    expect(document.querySelector(".dic-scene")).not.toBeNull();
    expect(document.querySelectorAll(".dic-plane").length).toBe(3);
    expect(document.querySelectorAll(".dic-sig").length).toBe(3);
    expect(TypesettingFieldTreatment).toBeDefined();
  });

  it("is NOT active for pdf-to-word (the registry serves the Typesetting Field)", () => {
    render(<JobProcessingVisual toolId="pdf-to-word" status="processing" />);
    expect(scene().className).toContain("ts-scene");
    expect(
      scene().querySelectorAll(".dic-core, .dic-sig, .rec-block, .rec-scan"),
    ).toHaveLength(0);
  });

  it("keeps every archived CSS block in the stylesheet exactly once", () => {
    const raw = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    expect(raw).toContain("ARCHIVED (Phase 75D.4.2)");
    expect(raw).toContain("ARCHIVED (Phase 75D.5)");
    expect(raw.match(/@keyframes rec-scan \{/g)).toHaveLength(1);
    expect(raw.match(/@keyframes dic-sig \{/g)).toHaveLength(1);
    expect(raw.match(/@keyframes ts-mark \{/g)).toHaveLength(1);
  });
});

describe("JobProcessingVisual — CSS contract", () => {
  it("runs one 6s master loop with a phase-locked caret sweep", () => {
    const styles = css();
    // The caret sweeps the field with container-query units (transform only,
    // no layout animation) and shares the marks' 6s loop.
    expect(styles).toMatch(/@keyframes ts-caret \{[\s\S]*?100cqw/);
    expect(styles).toMatch(/\.ts-mark\s*\{[^}]*animation:\s*ts-mark 6s infinite/);
    expect(styles).toMatch(/\.ts-caret\s*\{[^}]*animation:\s*ts-caret 6s/);
    // Each mark's settle is phase-locked to the caret's pass via delay.
    expect(styles).toMatch(/\.ts-mark--1\s*\{[^}]*animation-delay:\s*-0\.25s/);
    expect(styles).toMatch(/\.ts-mark--8\s*\{[^}]*animation-delay:\s*-0\.35s/);
    // Marks are placed by custom properties (position, width, scatter).
    expect(styles).toMatch(/--mx|--my|--mw|--sy|--sr/);
  });

  it("recomposes a dedicated compact field for mobile", () => {
    const styles = css();
    const mobile = styles.slice(styles.indexOf("@media (max-width: 639px)"));
    expect(mobile.length).toBeGreaterThan(0);
    // Fewer marks and one less baseline on mobile.
    expect(mobile).toMatch(/\.ts-mark--6[^{]*\{[^}]*display:\s*none/);
    expect(mobile).toMatch(/\.ts-base--5,[\s\S]*?display:\s*none/);
    expect(mobile).toMatch(/height:\s*122px/);
  });

  it("stops the loop on success/error and freezes the field on error", () => {
    const styles = css();
    expect(styles).toMatch(/is-success \.ts-mark\s*\{[^}]*animation:\s*ts-mark-in/);
    expect(styles).toMatch(/is-success \.ts-caret\s*\{[^}]*animation:\s*ts-caret-done/);
    expect(styles).toMatch(/is-error \.ts-mark\s*\{[^}]*animation:\s*none/);
    expect(styles).toMatch(/is-error \.ts-caret\s*\{[^}]*animation:\s*none/);
  });

  it("falls back to a static composed field under reduced motion", () => {
    const styles = css();
    const reduced = styles.slice(
      styles.indexOf("@media (prefers-reduced-motion: reduce)"),
    );
    expect(reduced.length).toBeGreaterThan(0);
    expect(reduced).toContain("animation: none !important");
    expect(reduced).toMatch(/\.ts-mark\s*\{[^}]*opacity:\s*1/);
    expect(reduced).toMatch(/\.ts-caret\s*\{[^}]*opacity:\s*1/);
  });
});

describe("JobProcessingVisual — registry and extensibility", () => {
  it("falls back to the quieter generic reconstruction for unknown tools", () => {
    render(<JobProcessingVisual toolId="merge-pdf" status="processing" />);
    expect(scene().className).toContain("rec-scene--generic");
    expect(scene().querySelectorAll(".rec-mote")).toHaveLength(2);
    expect(scene().querySelectorAll(".ts-mark")).toHaveLength(0);
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
