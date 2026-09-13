"use client";

import * as React from "react";
import {
  PrototypeShell,
  MOCK_FILE,
  MOCK_RESULT,
  type PrototypeState,
} from "@/components/design-lab/prototype-shell";

/**
 * CONCEPT A — "The Atelier" (Refined Layered Workspace).
 *
 * A premium creative-studio worktable: one layered worktop panel with real
 * depth (border + stacked soft shadows + inset fields), a wide 1040px
 * composition, and a processing stage with actual visual mass — the Layered
 * Document Morph: three document layers fan apart, exchange signals, and
 * re-converge into one structured object.
 *
 * State machine is mocked (no upload, no API). Production tool untouched.
 */
export function ConceptA() {
  const [state, setState] = React.useState<PrototypeState>("selected");

  return (
    <PrototypeShell
      concept="A — The Atelier · refined layered workspace"
      summary="Layered surfaces, real depth, 1040px worktop, Layered Document Morph"
      state={state}
      onStateChange={setState}
    >
      <div className="la-page">
        <header className="la-header">
          <div className="la-header__id">
            <span className="la-header__badge" aria-hidden="true">
              <LayersGlyph />
            </span>
            <h1 className="la-header__title">PDF to Word</h1>
          </div>
          <p className="la-header__privacy">
            Private — files are processed in memory and discarded immediately
          </p>
        </header>

        <section className="la-worktop" aria-label="Convert a PDF to Word">
          {state === "empty" ? <EmptyState /> : null}
          {state === "selected" ? <SelectedState /> : null}
          {state === "processing" ? <ProcessingState /> : null}
          {state === "completed" ? <CompletedState /> : null}
        </section>

        <p className="la-trustline">
          <ShieldGlyph />
          <span>
            Server-side, in memory only · discarded the moment your result is
            returned · no account, no tracking
          </span>
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
    <div className="la-dropfield">
      <div className="la-dropfield__glyph" aria-hidden="true">
        <span className="la-doc la-doc--back" />
        <span className="la-doc la-doc--mid" />
        <span className="la-doc la-doc--front" />
      </div>
      <p className="la-dropfield__title">Drop a PDF here</p>
      <p className="la-dropfield__sub">
        or{" "}
        <button type="button" className="la-link">
          browse from your device
        </button>
      </p>
      <div className="la-chips" aria-label="Constraints">
        <span className="la-chip">PDF only</span>
        <span className="la-chip">Up to 25 MB</span>
        <span className="la-chip">50 pages</span>
      </div>
    </div>
  );
}

function SelectedState() {
  return (
    <div className="la-plate la-plate--enter">
      <div className="la-filecard" aria-hidden="true">
        <span className="la-filecard__tag">4p</span>
      </div>
      <div className="la-plate__info">
        <p className="la-plate__name">{MOCK_FILE.name}</p>
        <p className="la-plate__meta">
          {MOCK_FILE.size} · {MOCK_FILE.pages} pages · ready to convert
        </p>
        <p className="la-plate__caveat">
          Text extraction — formatting and images are not rebuilt.
        </p>
        <details className="la-plate__details">
          <summary className="la-link">Details</summary>
          <span className="la-plate__caveat-long">
            Your 4 pages become a Word document with each page&rsquo;s text,
            in order, one paragraph per line.
          </span>
        </details>
      </div>
      <div className="la-plate__actions">
        <button type="button" className="la-btn la-btn--primary">
          Convert to Word
        </button>
        <button type="button" className="la-btn la-btn--ghost">
          Remove
        </button>
      </div>
    </div>
  );
}

function ProcessingState() {
  return (
    <div className="la-processing">
      <div className="la-processing__head">
        <p className="la-processing__title">Converting to Word</p>
        <p className="la-processing__file" aria-hidden="true">
          {MOCK_FILE.name}
        </p>
        <button type="button" className="la-btn la-btn--ghost">
          Cancel
        </button>
      </div>

      {/* The Layered Document Morph — decorative, aria-hidden. */}
      <div className="la-stage" aria-hidden="true">
        <div className="la-morph">
          <span className="la-morph__layer la-morph__layer--1" />
          <span className="la-morph__layer la-morph__layer--2" />
          <span className="la-morph__layer la-morph__layer--3" />
          <span className="la-morph__face" />
          <span className="la-morph__sig la-morph__sig--1" />
          <span className="la-morph__sig la-morph__sig--2" />
          <span className="la-morph__sig la-morph__sig--3" />
          <span className="la-morph__sig la-morph__sig--4" />
        </div>
      </div>

      <p className="la-processing__status" role="status" aria-live="polite">
        Analyzing structure and extracting text — your document stays private.
      </p>
    </div>
  );
}

function CompletedState() {
  return (
    <div className="la-plate la-plate--result">
      <div className="la-filecard la-filecard--result" aria-hidden="true">
        <span className="la-filecard__grid" />
      </div>
      <div className="la-plate__info">
        <p className="la-plate__done">
          <CheckGlyph /> Word document ready
        </p>
        <p className="la-plate__name">{MOCK_RESULT.name}</p>
        <p className="la-plate__meta">
          {MOCK_RESULT.size} · {MOCK_RESULT.characters} characters ·{" "}
          {MOCK_RESULT.paragraphs} paragraphs · 4 pages
        </p>
        <p className="la-plate__caveat">
          Text only — formatting, images and tables are not preserved.
        </p>
      </div>
      <div className="la-plate__actions la-plate__actions--stacked">
        <button type="button" className="la-btn la-btn--download">
          <DownArrowGlyph /> Download Word document
        </button>
        <button type="button" className="la-btn la-btn--ghost">
          Convert another PDF
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Inline glyphs (no icon dependency, consistent stroke weight)        */
/* ------------------------------------------------------------------ */

function LayersGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3 3 8l9 5 9-5-9-5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="m3 13 9 5 9-5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ShieldGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="la-trustline__glyph">
      <path
        d="M12 3 5 6v5c0 4.4 3 8.4 7 9.5 4-1.1 7-5.1 7-9.5V6l-7-3Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="la-done__glyph">
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
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="la-btn__glyph">
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
