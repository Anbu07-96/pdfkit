"use client";

import * as React from "react";
import {
  PrototypeShell,
  MOCK_FILE,
  MOCK_RESULT,
  type PrototypeState,
} from "@/components/design-lab/prototype-shell";

/**
 * CONCEPT B — "Signal Studio" (Soft Technical / Ambient).
 *
 * A calm technical instrument: an ambient panel with a controlled blue
 * wash, a concentric-ring drop target that breathes, and a processing
 * centerpiece — the Structured Signal Transformation: fragments travel
 * precise guide paths through two station nodes and assemble, cell by
 * cell, into the output geometry. Precision without HUD.
 *
 * State machine is mocked (no upload, no API). Production tool untouched.
 */
export function ConceptB() {
  const [state, setState] = React.useState<PrototypeState>("selected");

  return (
    <PrototypeShell
      concept="B — Signal Studio · soft technical / ambient"
      summary="Ambient blue depth, concentric target, Structured Signal Transformation"
      state={state}
      onStateChange={setState}
    >
      <div className="sb-page">
        <section className="sb-panel" aria-label="Convert a PDF to Word">
          <span
            className={
              state === "processing"
                ? "sb-glow sb-glow--live"
                : state === "completed"
                  ? "sb-glow sb-glow--bloom"
                  : "sb-glow"
            }
            aria-hidden="true"
          />

          <header className="sb-head">
            <div>
              <p className="sb-eyebrow">Document converter</p>
              <h1 className="sb-title">PDF to Word</h1>
            </div>
            <p className="sb-head__privacy">
              Private · in memory · discarded immediately
            </p>
          </header>

          {state === "empty" ? <EmptyState /> : null}
          {state === "selected" ? <SelectedState /> : null}
          {state === "processing" ? <ProcessingState /> : null}
          {state === "completed" ? <CompletedState /> : null}
        </section>

        <p className="sb-footnote">
          Files are processed server-side, held only in memory, and dropped the
          moment your document is returned. No account, no tracking.
        </p>
      </div>
    </PrototypeShell>
  );
}

/* ------------------------------------------------------------------ */
/* States                                                              */
/* ------------------------------------------------------------------ */

function EmptyState() {
  return (
    <div className="sb-empty">
      <div className="sb-target" aria-hidden="true">
        <span className="sb-ring sb-ring--1" />
        <span className="sb-ring sb-ring--2" />
        <span className="sb-ring sb-ring--3" />
        <span className="sb-target__disc">
          <SignalDocGlyph />
        </span>
      </div>
      <div className="sb-empty__copy">
        <p className="sb-empty__title">Drop a PDF here</p>
        <p className="sb-empty__sub">
          or{" "}
          <button type="button" className="sb-link">
            browse from your device
          </button>
        </p>
        <p className="sb-empty__constraints">
          PDF only · up to 25 MB · 50 pages
        </p>
      </div>
    </div>
  );
}

function SelectedState() {
  return (
    <div className="sb-selected">
      <span className="sb-dot" aria-hidden="true" />
      <div className="sb-selected__info">
        <p className="sb-selected__name">{MOCK_FILE.name}</p>
        <p className="sb-selected__meta">
          {MOCK_FILE.size} · {MOCK_FILE.pages} pages · text extraction, not
          layout rebuild
        </p>
      </div>
      <div className="sb-selected__actions">
        <button type="button" className="sb-btn sb-btn--primary">
          Convert to Word
        </button>
        <button type="button" className="sb-btn sb-btn--ghost">
          Remove
        </button>
      </div>
    </div>
  );
}

function ProcessingState() {
  return (
    <div className="sb-processing">
      <div className="sb-processing__head">
        <p className="sb-processing__title">Converting to Word</p>
        <p className="sb-processing__file" aria-hidden="true">
          {MOCK_FILE.name}
        </p>
        <button type="button" className="sb-btn sb-btn--ghost">
          Cancel
        </button>
      </div>

      {/* Structured Signal Transformation — decorative, aria-hidden. */}
      <div className="sb-stage" aria-hidden="true">
        <svg
          className="sb-guides"
          viewBox="0 0 640 230"
          fill="none"
          preserveAspectRatio="none"
        >
          <path
            className="sb-guides__path"
            d="M 70 78 C 200 78, 240 148, 330 148 S 470 96, 570 96"
          />
          <path
            className="sb-guides__path"
            d="M 70 152 C 190 152, 250 82, 340 82 S 460 150, 570 150"
          />
        </svg>

        <span className="sb-instack">
          <span />
          <span />
          <span />
        </span>

        <span className="sb-node sb-node--a" />
        <span className="sb-node sb-node--b" />

        <span className="sb-frag sb-frag--1" />
        <span className="sb-frag sb-frag--2" />
        <span className="sb-frag sb-frag--3" />
        <span className="sb-frag sb-frag--4" />
        <span className="sb-frag sb-frag--5" />

        <span className="sb-outgrid">
          <span className="sb-cell sb-cell--1" />
          <span className="sb-cell sb-cell--2" />
          <span className="sb-cell sb-cell--3" />
          <span className="sb-cell sb-cell--4" />
          <span className="sb-cell sb-cell--5" />
          <span className="sb-cell sb-cell--6" />
        </span>
      </div>

      <p className="sb-processing__status" role="status" aria-live="polite">
        Reading structure · extracting text · building the document
      </p>
    </div>
  );
}

function CompletedState() {
  return (
    <div className="sb-done">
      <span className="sb-outgrid sb-outgrid--final" aria-hidden="true">
        <span className="sb-cell is-on" />
        <span className="sb-cell is-on" />
        <span className="sb-cell is-on" />
        <span className="sb-cell is-on" />
        <span className="sb-cell is-on" />
        <span className="sb-cell is-on" />
      </span>
      <div className="sb-done__info">
        <p className="sb-done__title">
          <CheckGlyph /> Word document ready
        </p>
        <p className="sb-done__name">{MOCK_RESULT.name}</p>
        <p className="sb-done__meta">
          {MOCK_RESULT.size} · {MOCK_RESULT.characters} characters ·{" "}
          {MOCK_RESULT.paragraphs} paragraphs · 4 pages
        </p>
        <p className="sb-done__caveat">
          Text only — formatting, images and tables are not preserved.
        </p>
      </div>
      <div className="sb-done__actions">
        <button type="button" className="sb-btn sb-btn--download">
          <DownArrowGlyph /> Download Word document
        </button>
        <button type="button" className="sb-btn sb-btn--ghost">
          Convert another
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Glyphs                                                              */
/* ------------------------------------------------------------------ */

function SignalDocGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M7 3h7l4 4v14H7V3Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M10 12h4m-4 3h4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="sb-done__check">
      <path
        d="m5 13 4 4 10-10"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DownArrowGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="sb-btn__glyph">
      <path
        d="M12 4v12m0 0 5-5m-5 5-5-5M5 20h14"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
