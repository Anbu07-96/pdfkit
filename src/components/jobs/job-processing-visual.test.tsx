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
 * Phase 75D.4 — job processing visual prototype.
 *
 * These tests pin the component's CONTRACT, not its choreography (CSS
 * keyframes do not run in jsdom):
 * - the scene structure per status (processing/success/error),
 * - the decorative guarantee (aria-hidden, zero text, zero JS timers),
 * - the reduced-motion CSS fallback,
 * - the failure fallback (a broken treatment never breaks the job UI),
 * - and the registry/extensibility behavior (unknown id → generic scene,
 *   explicit treatment override).
 */

function scene() {
  return document.querySelector(".job-visual-scene")!;
}

describe("JobProcessingVisual — structure per status", () => {
  it("processing: PDF stack, travelling fragments and a materialising Word document", () => {
    render(<JobProcessingVisual toolId="pdf-to-word" status="processing" />);

    const root = screen.getByTestId("job-visual");
    expect(scene().getAttribute("data-status")).toBe("processing");
    expect(scene().className).toContain("is-processing");

    // Source: a stack of three pages (two receding + the front page).
    expect(scene().querySelectorAll(".job-visual-page--back, .job-visual-page--mid"))
      .toHaveLength(2);
    // Channel: three page fragments, each a full-channel wrapper with a dot.
    expect(scene().querySelectorAll(".job-visual-fragment")).toHaveLength(3);
    expect(scene().querySelectorAll(".job-visual-dot")).toHaveLength(3);
    // Target: a word page with text lines.
    expect(scene().querySelectorAll(".job-visual-line").length).toBeGreaterThanOrEqual(5);
    // No outcome badge while work is in flight.
    expect(scene().querySelector(".job-visual-badge")).toBeNull();
    expect(root).toBeInTheDocument();
  });

  it("success: the document completes and a success badge appears", () => {
    render(<JobProcessingVisual toolId="pdf-to-word" status="success" />);

    expect(scene().getAttribute("data-status")).toBe("success");
    expect(scene().className).toContain("is-success");
    const badge = scene().querySelector(".job-visual-badge");
    expect(badge?.className).toContain("job-visual-badge--success");
    expect(badge?.querySelector("svg")).not.toBeNull();
  });

  it("error: the scene is marked with an error badge", () => {
    render(<JobProcessingVisual toolId="pdf-to-word" status="error" />);

    expect(scene().getAttribute("data-status")).toBe("error");
    expect(scene().className).toContain("is-error");
    const badge = scene().querySelector(".job-visual-badge");
    expect(badge?.className).toContain("job-visual-badge--error");
  });

  it("transitions in place when a mounted scene changes status", () => {
    // A consumer that keeps the visual mounted across the job lifecycle
    // (e.g. a future workspace) gets an in-place transition, not a remount.
    const { rerender } = render(
      <JobProcessingVisual toolId="pdf-to-word" status="processing" />,
    );
    const processingScene = scene();
    expect(processingScene.getAttribute("data-status")).toBe("processing");

    rerender(<JobProcessingVisual toolId="pdf-to-word" status="success" />);
    // Same DOM node, updated status — CSS handles the transition.
    expect(scene()).toBe(processingScene);
    expect(scene().getAttribute("data-status")).toBe("success");
    expect(scene().querySelector(".job-visual-badge--success")).not.toBeNull();

    rerender(<JobProcessingVisual toolId="pdf-to-word" status="error" />);
    expect(scene()).toBe(processingScene);
    expect(scene().getAttribute("data-status")).toBe("error");
    expect(scene().querySelector(".job-visual-badge--error")).not.toBeNull();
  });
});

describe("JobProcessingVisual — registry and extensibility", () => {
  it("falls back to a quieter generic scene for unknown tools", () => {
    render(<JobProcessingVisual toolId="merge-pdf" status="processing" />);
    expect(scene().className).toContain("job-visual-scene--generic");
    expect(scene().querySelectorAll(".job-visual-fragment")).toHaveLength(2);
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
    // No text anywhere — nothing can collide with workspace text queries or
    // screen-reader output.
    expect(root.textContent).toBe("");
  });

  it("contains no JavaScript timers, frames or polling — CSS motion only", () => {
    const source = readFileSync(
      join(process.cwd(), "src/components/jobs/job-processing-visual.tsx"),
      "utf8",
    );
    expect(source).not.toMatch(/setTimeout|setInterval|requestAnimationFrame/);
    expect(source).not.toMatch(/new Worker|canvas|getContext/);
  });

  it("renders nothing when a treatment throws — the job UI carries on", () => {
    function BrokenTreatment(): never {
      throw new Error("visual exploded");
    }
    // The error boundary must swallow the failure silently; nothing here
    // may reach the surrounding (real) processing UI.
    render(
      <JobProcessingVisual
        treatment={BrokenTreatment}
        status="processing"
      />,
    );
    expect(screen.queryByTestId("job-visual")).toBeNull();
    expect(containerIsEmpty()).toBe(true);
  });

  it("ships a static reduced-motion presentation in CSS", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    // The job-visual block stops every animation and re-places the
    // fragments as a static diagram under prefers-reduced-motion.
    const block = css.slice(css.indexOf("Phase 75D.4"));
    expect(block).toContain("prefers-reduced-motion: reduce");
    expect(block).toContain("animation: none !important");
    expect(block).toMatch(/\.job-visual-fragment:nth-of-type\(2\)\s*\{\s*transform/);
  });
});

/** True when nothing was rendered besides the (empty) boundary fallback. */
function containerIsEmpty(): boolean {
  return document.body.textContent === "";
}
