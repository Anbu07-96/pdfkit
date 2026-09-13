"use client";

import * as React from "react";
import {
  PrototypeShell,
  MOCK_FILE,
  MOCK_RESULT,
  type PrototypeState,
} from "@/components/design-lab/prototype-shell";

/**
 * CONCEPT C — "The Press" (Modern Editorial / Spatial Hybrid).
 *
 * An editorial spread crossed with a spatial workspace: a typographic left
 * rail (masthead, numbered protocol, document identity, trust) and a large
 * spatial stage holding a recessed document tray. The document itself is
 * the protagonist: it rests in the tray, and during conversion it performs
 * a dimensional transformation — a slow 3D turn during which its content
 * reorganizes from loose lines into a structured grid.
 *
 * State machine is mocked (no upload, no API). Production tool untouched.
 */
export function ConceptC() {
  const [state, setState] = React.useState<PrototypeState>("selected");

  const activeStep = state === "empty" ? 1 : state === "completed" ? 3 : 2;

  return (
    <PrototypeShell
      concept="C — The Press · editorial / spatial hybrid"
      summary="Typographic rail + spatial stage, Dimensional Transformation"
      state={state}
      onStateChange={setState}
    >
      <div className="pr-page">
        <div className="pr-grid">
          {/* ---------- left rail: the editorial column ---------- */}
          <aside className="pr-rail">
            <header>
              <h1 className="pr-masthead">
                PDF <span aria-hidden="true">→</span> Word
              </h1>
              <p className="pr-serial">Document converter · No. 01</p>
            </header>

            <ol className="pr-protocol" aria-label="Workflow">
              <Step number="01" label="Select a PDF" active={activeStep === 1} />
              <Step number="02" label="Convert to Word" active={activeStep === 2} />
              <Step number="03" label="Download the result" active={activeStep === 3} />
            </ol>

            {state === "empty" ? (
              <p className="pr-rail__hint">
                Drop a PDF on the stage, or browse from your device. Up to
                25&nbsp;MB, 50 pages.
              </p>
            ) : (
              <div className="pr-file">
                <p className="pr-file__name">
                  {state === "completed" ? MOCK_RESULT.name : MOCK_FILE.name}
                </p>
                <p className="pr-file__meta">
                  {state === "completed"
                    ? `${MOCK_RESULT.size} · ${MOCK_RESULT.characters} characters · 4 pages`
                    : `${MOCK_FILE.size} · ${MOCK_FILE.pages} pages · text extraction`}
                </p>
              </div>
            )}

            {state === "selected" ? (
              <button type="button" className="pr-btn pr-btn--convert">
                Convert to Word
              </button>
            ) : null}

            {state === "processing" ? (
              <p className="pr-rail__status" role="status" aria-live="polite">
                Converting — analyzing structure, extracting text, rebuilding
                paragraphs.
              </p>
            ) : null}

            <div className="pr-trust">
              <p className="pr-trust__line">
                Private by design. Files are processed in memory and discarded
                the moment your result is returned.
              </p>
              <details className="pr-trust__details">
                <summary>Full privacy details</summary>
                <p>
                  Nothing is written to disk, nothing is stored, no names or
                  contents are logged. No account, no tracking, no
                  advertising.
                </p>
              </details>
            </div>
          </aside>

          {/* ---------- right: the spatial stage ---------- */}
          <section className="pr-stage" aria-label="Document stage">
            <div className="pr-tray" aria-hidden="true">
              {state === "empty" ? (
                <>
                  <span className="pr-ghost" />
                  <p className="pr-tray__copy">
                    Drop a PDF here
                    <span className="pr-tray__browse">
                      or <span className="pr-link">browse</span>
                    </span>
                  </p>
                </>
              ) : null}

              {state === "selected" ? (
                <div className="pr-card">
                  <div className="pr-card__face pr-card__face--front">
                    <span className="pr-card__tag">4p</span>
                  </div>
                </div>
              ) : null}

              {state === "processing" ? (
                <div className="pr-card pr-card--flip">
                  <div className="pr-card__face pr-card__face--front" />
                  <div className="pr-card__face pr-card__face--back" />
                  <span className="pr-orbit pr-orbit--1">
                    <span className="pr-orbit__frag" />
                  </span>
                  <span className="pr-orbit pr-orbit--2">
                    <span className="pr-orbit__frag" />
                  </span>
                  <span className="pr-orbit pr-orbit--3">
                    <span className="pr-orbit__frag" />
                  </span>
                  <span className="pr-orbit pr-orbit--4">
                    <span className="pr-orbit__frag" />
                  </span>
                  <span className="pr-orbit pr-orbit--5">
                    <span className="pr-orbit__frag" />
                  </span>
                </div>
              ) : null}

              {state === "completed" ? (
                <div className="pr-card pr-card--result">
                  <div className="pr-card__face pr-card__face--back">
                    <span className="pr-card__check" />
                  </div>
                </div>
              ) : null}
            </div>

            {state === "processing" ? (
              <p className="pr-stage__label">
                Rebuilding the document — page by page
              </p>
            ) : null}

            {state === "completed" ? (
              <div className="pr-download">
                <button type="button" className="pr-btn pr-btn--download">
                  Download Word document
                  <span className="pr-download__meta">
                    {MOCK_RESULT.name} · {MOCK_RESULT.size}
                  </span>
                </button>
                <button type="button" className="pr-btn pr-btn--ghost">
                  Convert another PDF
                </button>
              </div>
            ) : null}
          </section>
        </div>
      </div>
    </PrototypeShell>
  );
}

function Step({
  number,
  label,
  active,
}: {
  number: string;
  label: string;
  active: boolean;
}) {
  return (
    <li className={active ? "pr-step is-active" : "pr-step"}>
      <span className="pr-step__number" aria-hidden="true">
        {number}
      </span>
      <span className="pr-step__label">{label}</span>
    </li>
  );
}
