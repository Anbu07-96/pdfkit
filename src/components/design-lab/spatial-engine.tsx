"use client";

import * as React from "react";

/**
 * PHASE 75D.7 — "Spatial Document Engine" (design-lab experiment S-1).
 *
 * The document itself becomes the interface: one persistent PDF object
 * owns the stage, responds to pointer proximity and drag, decomposes into
 * its real structures (text / images / tables / layout), and those
 * structures travel and rebuild as a Word document that settles and
 * offers itself for download.
 *
 * All workflow states are mocked (no upload, no API, no conversion).
 * Production PDF → Word (75D.5 baseline) is untouched.
 *
 * Interaction engineering notes:
 * - Pointer proximity / drag magnetism run through ONE rAF loop that
 *   lerps four CSS custom properties on the stage root. No React state
 *   is touched on pointermove; the loop parks itself when settled and is
 *   cancelled on unmount. Skipped for touch pointers and reduced motion.
 * - The processing choreography is a deterministic CSS timeline
 *   (explicit delays) so static screenshots can capture each beat.
 */

const SE_STATES = ["empty", "dragover", "selected", "processing", "completed", "error"] as const;
type SeState = (typeof SE_STATES)[number];

const MOCK_FILE = { name: "quarterly-report.pdf", size: "2.4 MB", pages: 4 };
const MOCK_RESULT = { name: "quarterly-report.docx", size: "18 KB", meta: "5,432 characters · 88 paragraphs" };

/** Status copy per processing phase (mirrors the CSS timeline beats). */
const PROCESS_STATUS = [
  "Opening {name}…",
  "Separating text, images, tables and layout…",
  "Rebuilding your document as Word…",
  "Finishing up…",
];

/** Phase indicator steps shown while processing. */
const PROCESS_STEPS = ["Reading", "Separating", "Rebuilding"];

/** Structure exploration chips (hover/focus/tap emphasizes a structure). */
const STRUCTURES: ReadonlyArray<readonly [string, string]> = [
  ["text", "Text"],
  ["images", "Images"],
  ["tables", "Tables"],
  ["layout", "Layout"],
];

interface MockFile {
  name: string;
  size: string;
  pages: number | null;
}

function prettySize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

export function SpatialEngine() {
  const [state, setState] = React.useState<SeState>("empty");
  const [phase, setPhase] = React.useState(0);
  const [file, setFile] = React.useState<MockFile>(MOCK_FILE);

  const rootRef = React.useRef<HTMLDivElement>(null);
  const stageRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // --- one rAF physics loop: pointer parallax + drag magnetism + exploration ---
  const physics = React.useRef({ tx: 0, ty: 0, x: 0, y: 0, dtx: 0, dty: 0, dx: 0, dy: 0, cx: 0, cy: 0 });
  const tickRef = React.useRef<() => void>(() => {});
  const rafRef = React.useRef(0);
  const reducedRef = React.useRef(false);
  const strataRef = React.useRef<HTMLDivElement>(null);
  const stateRef = React.useRef<SeState>("empty");

  const timers = React.useRef<number[]>([]);
  const schedule = React.useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(fn, ms);
    timers.current.push(id);
  }, []);
  const clearTimers = React.useCallback(() => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
  }, []);

  const clearFocus = React.useCallback(() => {
    strataRef.current
      ?.querySelectorAll(".se-stratum")
      .forEach((s) => s.removeAttribute("data-focus"));
  }, []);

  // Structure exploration: the 3D scene is decorative and pointer-transparent;
  // emphasis is driven through an explicit 2D chip row (hover/focus/tap).
  const focusStratum = React.useCallback((id: string) => {
    strataRef.current?.querySelectorAll(".se-stratum").forEach((s) => {
      if (s.classList.contains(`se-stratum--${id}`)) s.setAttribute("data-focus", "on");
      else s.removeAttribute("data-focus");
    });
  }, []);

  React.useEffect(() => {
    stateRef.current = state;
  }, [state]);

  React.useEffect(() => {
    reducedRef.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const loop = () => {
      rafRef.current = 0;
      const p = physics.current;
      p.x += (p.tx - p.x) * 0.085;
      p.y += (p.ty - p.y) * 0.085;
      p.dx += (p.dtx - p.dx) * 0.14;
      p.dy += (p.dty - p.dy) * 0.14;
      const el = stageRef.current;
      if (el) {
        el.style.setProperty("--px", p.x.toFixed(4));
        el.style.setProperty("--py", p.y.toFixed(4));
        el.style.setProperty("--dragx", `${p.dx.toFixed(2)}px`);
        el.style.setProperty("--dragy", `${p.dy.toFixed(2)}px`);
      }
      const settled =
        Math.abs(p.tx - p.x) + Math.abs(p.ty - p.y) + Math.abs(p.dtx - p.dx) + Math.abs(p.dty - p.dy) < 0.01;
      if (!settled) rafRef.current = requestAnimationFrame(loop);
    };
    tickRef.current = loop;
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      clearTimers();
    };
  }, [clearTimers]);

  const wake = React.useCallback(() => {
    if (!rafRef.current) rafRef.current = requestAnimationFrame(tickRef.current);
  }, []);

  // --- state machine ----------------------------------------------------
  const enter = React.useCallback(
    (next: SeState) => {
      clearTimers();
      clearFocus();
      setPhase(0);
      setState(next);
      if (next === "processing") {
        schedule(() => setPhase(1), 1100);
        schedule(() => setPhase(2), 3300);
        schedule(() => setPhase(3), 6300);
        schedule(() => setState("completed"), 7200);
      }
    },
    [clearFocus, clearTimers, schedule],
  );

  // --- pointer + drag handlers ------------------------------------------
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse" || reducedRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const p = physics.current;
    p.tx = Math.max(-1, Math.min(1, ((e.clientX - rect.left) / rect.width) * 2 - 1));
    p.ty = Math.max(-1, Math.min(1, ((e.clientY - rect.top) / rect.height) * 2 - 1));
    wake();
  };

  const onPointerLeave = () => {
    const p = physics.current;
    p.tx = 0;
    p.ty = 0;
    wake();
  };

  const setDrag = (e: React.DragEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const p = physics.current;
    p.dtx = Math.max(-26, Math.min(26, ((e.clientX - (rect.left + rect.width / 2)) / rect.width) * 64));
    p.dty = Math.max(-16, Math.min(16, ((e.clientY - (rect.top + rect.height / 2)) / rect.height) * 36));
    wake();
  };

  const clearDrag = () => {
    const p = physics.current;
    p.dtx = 0;
    p.dty = 0;
    wake();
  };

  const acceptFile = (f: File | undefined) => {
    if (!f) return;
    const isPdf = f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) return;
    setFile({ name: f.name, size: prettySize(f.size), pages: null });
    enter("selected");
  };

  const status = PROCESS_STATUS[Math.min(phase, PROCESS_STATUS.length - 1)].replace(
    "{name}",
    file.name,
  );
  const activeStep = phase === 0 ? 0 : phase === 1 ? 1 : 2;

  return (
    <div className="se-root" ref={rootRef} data-state={state}>
      <div className="dl-banner" role="note">
        <div className="dl-banner__meta">
          <span className="dl-banner__tag">Design Lab · interaction experiment</span>
          <span className="dl-banner__concept">Spatial Document Engine</span>
          <span className="dl-banner__summary">the document is the interface — drop, decompose, rebuild</span>
        </div>
        <div className="dl-switcher" role="group" aria-label="Experiment workflow state">
          {SE_STATES.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => enter(option)}
              aria-pressed={state === option}
              className="dl-switcher__btn"
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      <header className="se-head">
        <h1 className="se-head__title">PDF to Word</h1>
        <p className="se-head__sub">Your document, understood and rebuilt — in memory, never stored.</p>
      </header>

      <div
        className="se-stage"
        ref={stageRef}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        onDragOver={(e) => {
          e.preventDefault();
          if (state === "empty" || state === "selected") {
            stageRef.current?.setAttribute("data-drag", "on");
            setDrag(e);
          }
        }}
        onDragLeave={() => {
          stageRef.current?.removeAttribute("data-drag");
          clearDrag();
        }}
        onDrop={(e) => {
          e.preventDefault();
          stageRef.current?.removeAttribute("data-drag");
          clearDrag();
          acceptFile(e.dataTransfer.files?.[0]);
        }}
      >
        <div className="se-scene" aria-hidden="true">
          <div className="se-world">
            <div className="se-floor" />

            {/* ------------------------- PDF object ------------------------- */}
            <div className="se-docwrap se-docwrap--pdf">
              <div className="se-drift se-drift--a">
                <div className="se-shadow" />
                <div className="se-magnet">
                  <div className="se-doc se-doc--pdf">
                    <div className="se-pages">
                      <span className="se-page" />
                      <span className="se-page" />
                      <span className="se-page" />
                    </div>
                    <div className="se-base">
                      <span className="se-base__chip">PDF</span>
                      <div className="se-base__glow" />
                      <div className="se-base__content">
                        <span className="se-line se-line--title" />
                        <span className="se-line" />
                        <span className="se-line" />
                        <div className="se-base__figure" />
                        <span className="se-line" />
                        <span className="se-line se-line--short" />
                      </div>
                      <div className="se-guides" />
                    </div>

                    <div className="se-strata" ref={strataRef}>
                      <div className="se-stratum se-stratum--layout">
                        <div className="se-lift se-lift--layout" />
                        <div className="se-cap se-cap--l">
                          <span className="se-cap__k">Layout</span>
                          <span className="se-cap__v">reading order</span>
                        </div>
                      </div>
                      <div className="se-stratum se-stratum--text">
                        <div className="se-lift se-lift--text" />
                        <div className="se-cap se-cap--l">
                          <span className="se-cap__k">Text</span>
                          <span className="se-cap__v">14 paragraphs</span>
                        </div>
                      </div>
                      <div className="se-stratum se-stratum--images">
                        <div className="se-lift se-lift--images">
                          <span className="se-imgblock" />
                          <span className="se-imgblock" />
                        </div>
                        <div className="se-cap se-cap--l">
                          <span className="se-cap__k">Images</span>
                          <span className="se-cap__v">2 figures</span>
                        </div>
                      </div>
                      <div className="se-stratum se-stratum--tables">
                        <div className="se-lift se-lift--tables" />
                        <div className="se-cap se-cap--l">
                          <span className="se-cap__k">Tables</span>
                          <span className="se-cap__v">1 table</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* ------------------------ Word object ------------------------- */}
            <div className="se-docwrap se-docwrap--word">
              <div className="se-drift se-drift--b">
                <div className="se-shadow se-shadow--word" />
                <div className="se-magnet">
                  <div className="se-doc se-doc--word">
                    <div className="se-wface">
                      <div className="se-wskeleton" />
                      <div className="se-wtext" />
                      <div className="se-wimage" />
                      <div className="se-wtable" />
                    </div>
                    <span className="se-wchip">.docx</span>
                  </div>
                </div>
              </div>
            </div>

            <svg className="se-arcs" viewBox="0 0 1000 560" preserveAspectRatio="none" focusable="false">
              <path className="se-arc se-arc--1" d="M 300 300 C 420 130, 580 130, 700 300" />
              <path className="se-arc se-arc--2" d="M 300 300 C 430 190, 570 190, 700 300" />
              <path className="se-arc se-arc--3" d="M 300 300 C 440 250, 560 250, 700 300" />
            </svg>
          </div>
        </div>

        <p className="se-hint" aria-hidden="true">
          <span className="se-hint__main">Drop your PDF here</span>
          <span className="se-hint__alt">or click to browse · up to 50 pages · 20 MB</span>
        </p>

        {state === "empty" && (
          <button
            type="button"
            className="se-stageclick"
            onClick={() => inputRef.current?.click()}
          >
            <span className="se-sr">Drop a PDF on the stage, or press Enter to browse for a file</span>
          </button>
        )}
      </div>

      {/* ---------------------------- actions ------------------------------ */}
      <div className="se-actions">
        <p className="se-status" role="status" aria-live="polite">
          {state === "empty" && "Waiting for a PDF."}
          {state === "dragover" && "Release to open your PDF."}
          {state === "selected" && `${file.name} — ready to convert.`}
          {state === "processing" && status}
          {state === "completed" && `Conversion complete — ${MOCK_RESULT.name} is ready.`}
          {state === "error" && "Couldn’t convert this PDF."}
        </p>

        {state === "empty" && (
          <p className="se-note">
            Files are processed in memory and never stored. Nothing leaves this page except your download.
          </p>
        )}

        {state === "dragover" && (
          <p className="se-note">The document will open on the stage and show you its structure.</p>
        )}

        {state === "selected" && (
          <div className="se-row">
            <span className="se-fileplate">
              <span className="se-fileplate__name">{file.name}</span>
              <span className="se-fileplate__meta">
                {file.size}
                {file.pages ? ` · ${file.pages} pages` : " · PDF document"}
              </span>
            </span>
            <button type="button" className="se-btn se-btn--primary" onClick={() => enter("processing")}>
              Convert to Word
            </button>
            <button type="button" className="se-btn se-btn--ghost" onClick={() => enter("empty")}>
              Remove
            </button>
          </div>
        )}

        {state === "processing" && (
          <>
            <div className="se-row se-row--steps" aria-hidden="true">
              {PROCESS_STEPS.map((label, i) => (
                <span key={label} className="se-step" data-active={i === activeStep}>
                  <span className="se-step__dot" />
                  {label}
                </span>
              ))}
            </div>
            <div className="se-row se-row--explore" role="group" aria-label="Explore document structures">
              <span className="se-explore__label">Explore:</span>
              {STRUCTURES.map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className="se-chip"
                  onPointerEnter={() => focusStratum(id)}
                  onPointerLeave={clearFocus}
                  onFocus={() => focusStratum(id)}
                  onBlur={clearFocus}
                >
                  {label}
                </button>
              ))}
            </div>
          </>
        )}

        {state === "completed" && (
          <div className="se-row">
            <button type="button" className="se-btn se-btn--primary se-btn--lg">
              Download Word (.docx)
            </button>
            <span className="se-result">
              <span className="se-result__name">{MOCK_RESULT.name}</span>
              <span className="se-result__meta">
                {MOCK_RESULT.size} · {MOCK_RESULT.meta}
              </span>
            </span>
            <button type="button" className="se-btn se-btn--ghost" onClick={() => enter("empty")}>
              Convert another PDF
            </button>
          </div>
        )}

        {state === "error" && (
          <div className="se-row">
            <span className="se-err">
              <span className="se-err__title">The PDF couldn’t be converted.</span>
              <span className="se-err__why">
                It may be scanned (image-only) or password-protected. Nothing was stored.
              </span>
            </span>
            <button type="button" className="se-btn se-btn--ghost" onClick={() => enter("empty")}>
              Try another file
            </button>
          </div>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="se-sr-input"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          acceptFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}
