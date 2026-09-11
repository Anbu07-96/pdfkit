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
 * Phase 75D.4.1 — premium 3D transformation visual.
 *
 * These tests pin the component's CONTRACT, not its choreography (CSS 3D
 * does not render in jsdom):
 * - the 3D scene structure per status (processing/success/error): stacks
 *   with receding sheets, the peeling/converging pages, the transformation
 *   zone (track + conversion ring + depth-staggered fragments),
 * - the decorative guarantee (aria-hidden, zero text, zero JS timers),
 * - the 3D/mobile/reduced-motion CSS contract (perspective, preserve-3d,
 *   rotateY/translateZ, the compact mobile recomposition, the static
 *   reduced-motion diagram),
 * - the failure fallback (a broken treatment never breaks the job UI),
 * - and the registry/extensibility behavior (unknown id → generic scene,
 *   explicit treatment override).
 */

function scene() {
  return document.querySelector(".job-visual-scene")!;
}

function css() {
  return readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8").slice(
    readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8").indexOf(
      "Phase 75D.4.1",
    ),
  );
}

describe("JobProcessingVisual — 3D scene structure", () => {
  it("processing: tilted PDF stack with receding sheets, peeling page, zone and converging Word stack", () => {
    render(<JobProcessingVisual toolId="pdf-to-word" status="processing" />);

    const root = screen.getByTestId("job-visual");
    expect(scene().getAttribute("data-status")).toBe("processing");
    expect(scene().className).toContain("is-processing");

    // Source side: three receding layers behind the face, plus a sheet
    // that peels off toward the transformation zone.
    const pdfSide = scene().querySelector(".job-visual-side--pdf")!;
    expect(
      pdfSide.querySelectorAll(
        ".job-visual-sheet--1, .job-visual-sheet--2, .job-visual-sheet--3",
      ),
    ).toHaveLength(3);
    expect(
      pdfSide.querySelectorAll(".job-visual-sheet--front .job-visual-pdf-line"),
    ).toHaveLength(3);
    expect(pdfSide.querySelector(".job-visual-leaf .job-visual-sheet--peel")).not
      .toBeNull();

    // Transformation zone: track, 3D conversion ring and three fragments
    // at different depths.
    const zone = scene().querySelector(".job-visual-zone")!;
    expect(zone.querySelector(".job-visual-track")).not.toBeNull();
    expect(zone.querySelector(".job-visual-ring")).not.toBeNull();
    expect(zone.querySelectorAll(".job-visual-spark")).toHaveLength(3);
    expect(zone.querySelector(".job-visual-spark--near .job-visual-chip")).not
      .toBeNull();
    expect(zone.querySelector(".job-visual-spark--far .job-visual-chip")).not
      .toBeNull();
    expect(zone.querySelector(".job-visual-spark--mid .job-visual-chip")).not
      .toBeNull();

    // Target side: Word face with materialising lines, a receding layer,
    // and a sheet converging in from the zone.
    const wordSide = scene().querySelector(".job-visual-side--word")!;
    expect(
      wordSide.querySelectorAll(".job-visual-sheet--front .job-visual-line"),
    ).toHaveLength(5);
    expect(wordSide.querySelector(".job-visual-sheet--1")).not.toBeNull();
    expect(wordSide.querySelector(".job-visual-arrival .job-visual-sheet--peel"))
      .not.toBeNull();

    // No outcome badge while work is in flight.
    expect(scene().querySelector(".job-visual-badge")).toBeNull();
    expect(root).toBeInTheDocument();
  });

  it("success: the target is marked with a flipped-in success badge", () => {
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
    expect(
      scene().querySelector(".job-visual-badge--error"),
    ).not.toBeNull();
  });

  it("transitions in place when a mounted scene changes status", () => {
    // A consumer that keeps the visual mounted across the job lifecycle
    // gets an in-place transition, not a remount.
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

describe("JobProcessingVisual — 3D, mobile and reduced-motion CSS contract", () => {
  it("builds the scene from real CSS 3D: perspective, preserve-3d, rotateY, translateZ", () => {
    const styles = css();
    // The scene establishes the 3D rendering context…
    expect(styles).toMatch(/\.job-visual-scene\s*\{[^}]*perspective:/);
    // …carried through the sides, stacks, peeling pages and the zone so
    // the browser depth-sorts sheets and fragments…
    expect(styles).toMatch(/\.job-visual-side\s*\{[^}]*preserve-3d/);
    expect(styles).toMatch(/\.job-visual-stack\s*\{[^}]*preserve-3d/);
    expect(styles).toMatch(/\.job-visual-zone\s*\{[^}]*preserve-3d/);
    expect(styles).toMatch(/\.job-visual-leaf[^{]*\{[^}]*preserve-3d/);
    // …with tilted stacks and a standing conversion ring…
    expect(styles).toMatch(/rotateY\(24deg\)/);
    expect(styles).toMatch(/rotateY\(-24deg\)/);
    expect(styles).toMatch(/\.job-visual-ring\s*\{[^}]*rotateY\(70deg\)/);
    // …and genuine depth via translateZ (receding sheets, fragment parallax).
    expect(styles).toMatch(/\.job-visual-sheet--3\s*\{[^}]*-1\.5rem/);
    expect(styles).toMatch(
      /\.job-visual-spark--near \.job-visual-chip\s*\{[^}]*translateZ\(1\.6rem\)/,
    );
    expect(styles).toMatch(
      /\.job-visual-spark--far \.job-visual-chip\s*\{[^}]*translateZ\(-1rem\)/,
    );
  });

  it("recomposes a compact scene for mobile — not a scaled desktop scene", () => {
    const styles = css();
    const mobile = styles.slice(styles.indexOf("@media (max-width: 639px)"));
    expect(mobile.length).toBeGreaterThan(0);
    // Tighter perspective and angles…
    expect(mobile).toMatch(/perspective:\s*34rem/);
    expect(mobile).toMatch(/rotateY\(18deg\)/);
    // …smaller stacks and ring…
    expect(mobile).toMatch(/\.job-visual-side\s*\{[^}]*width:\s*2\.25rem/);
    // …shorter page travel (dedicated mobile keyframes)…
    expect(mobile).toMatch(/pdfkit-job-leaf-sm/);
    expect(mobile).toMatch(/pdfkit-job-arrival-sm/);
    // …and one fewer fragment.
    expect(mobile).toMatch(/\.job-visual-spark--mid\s*\{\s*display:\s*none/);
  });

  it("falls back to a static 3D composition under prefers-reduced-motion", () => {
    const styles = css();
    const reduced = styles.slice(
      styles.indexOf("@media (prefers-reduced-motion: reduce)"),
    );
    expect(reduced.length).toBeGreaterThan(0);
    // All motion stops…
    expect(reduced).toContain("animation: none !important");
    expect(reduced).toContain("transition: none !important");
    // …while the composition stays legible: solid text lines and fragments
    // resting at fixed positions along the track.
    expect(reduced).toMatch(/\.job-visual-spark\s*\{[^}]*translateX\(30%\)/);
    expect(reduced).toMatch(/\.job-visual-line\s*\{[^}]*opacity:\s*0\.8/);
  });

  it("defines the success beat: settle, stack convergence, badge flip", () => {
    const styles = css();
    expect(styles).toMatch(/@keyframes pdfkit-job-wordsettle/);
    expect(styles).toMatch(/@keyframes pdfkit-job-settle/);
    expect(styles).toMatch(/@keyframes pdfkit-job-badge/);
    // Success retires the travelling pieces and solidifies the lines.
    expect(styles).toMatch(
      /\.is-success \.job-visual-spark[^{]*\{[^}]*animation:\s*none/,
    );
    expect(styles).toMatch(
      /\.is-success \.job-visual-line\s*\{[^}]*opacity:\s*1/,
    );
    // Error stops everything and tilts the target away.
    expect(styles).toMatch(
      /\.is-error \.job-visual-side--word \.job-visual-stack\s*\{[^}]*rotateY\(-34deg\)/,
    );
  });
});

describe("JobProcessingVisual — registry and extensibility", () => {
  it("falls back to a quieter generic scene for unknown tools", () => {
    render(<JobProcessingVisual toolId="merge-pdf" status="processing" />);
    expect(scene().className).toContain("job-visual-scene--generic");
    // The same 3D primitives, deliberately quieter: two fragments, no
    // peeling or converging pages.
    expect(scene().querySelectorAll(".job-visual-spark")).toHaveLength(2);
    expect(scene().querySelector(".job-visual-leaf")).toBeNull();
    expect(scene().querySelector(".job-visual-arrival")).toBeNull();
    expect(scene().querySelector(".job-visual-ring")).not.toBeNull();
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
    expect(source).not.toMatch(/new Worker|<canvas|\.getContext\(/);
    expect(source).not.toMatch(/useSpring|useTransition|framer/);
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
    expect(document.body.textContent).toBe("");
  });
});
