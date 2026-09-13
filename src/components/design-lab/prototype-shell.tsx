"use client";

import * as React from "react";

/**
 * Phase 75D.6R — dev-only chrome for design-lab prototypes.
 *
 * A clearly-marked internal banner plus a workflow-state switcher so a
 * reviewer can flip a concept between empty / selected / processing /
 * completed without uploading anything. The switcher is NOT part of the
 * design under review.
 */

export type PrototypeState = "empty" | "selected" | "processing" | "completed";

export const PROTOTYPE_STATES: PrototypeState[] = [
  "empty",
  "selected",
  "processing",
  "completed",
];

export interface PrototypeShellProps {
  /** Concept letter + name, e.g. "A — The Atelier". */
  concept: string;
  /** Short description shown in the banner. */
  summary: string;
  state: PrototypeState;
  onStateChange: (state: PrototypeState) => void;
  children: React.ReactNode;
}

export function PrototypeShell({
  concept,
  summary,
  state,
  onStateChange,
  children,
}: PrototypeShellProps) {
  return (
    <div className="dl-shell">
      <div className="dl-banner" role="note">
        <div className="dl-banner__meta">
          <span className="dl-banner__tag">Design Lab · internal prototype</span>
          <span className="dl-banner__concept">Concept {concept}</span>
          <span className="dl-banner__summary">{summary}</span>
        </div>
        <div
          className="dl-switcher"
          role="group"
          aria-label="Prototype workflow state"
        >
          {PROTOTYPE_STATES.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onStateChange(option)}
              aria-pressed={state === option}
              className="dl-switcher__btn"
            >
              {option}
            </button>
          ))}
        </div>
      </div>
      {children}
    </div>
  );
}

/** Mock document used by every concept (no real files, no API). */
export const MOCK_FILE = {
  name: "quarterly-report.pdf",
  size: "2.4 MB",
  pages: 4,
};

export const MOCK_RESULT = {
  name: "quarterly-report.docx",
  size: "18 KB",
  characters: "5,432",
  paragraphs: 88,
};
