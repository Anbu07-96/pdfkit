"use client";

import { TransformationLab, DOC, PhotoBlock, ChartBlock, TableBlock } from "./transformation-lab";

/**
 * WORLD 2 — "Spatial Typography" (Phase 75D.8 visual R&D).
 *
 * The document IS typography in space — no page object. A dense editorial
 * composition (serif display, real paragraphs, rules-only table, thin chart,
 * quiet figure, small-caps labels, hairline baselines) transforms by changing
 * its ALIGNMENT SYSTEM: old baselines dim, a new primary-tinted grid appears,
 * units separate and flow, then lock into a resolved editorial document.
 * A giant environmental pilcrow (¶) ghosts the background. Deterministic
 * CSS beats; serif display (Georgia) over sans data type.
 */
export function WorldType() {
  return (
    <TransformationLab
      id="type"
      index={2}
      name="Spatial Typography"
      summary="the document is typography in space — alignment systems separate, reorganize, resolve"
    >
      {/* environment */}
      <div className="wt-env">
        <span className="wt-env__glyph">¶</span>
        <div className="wt-env__light" />
        <div className="wt-env__vignette" />
      </div>

      {/* old alignment system (baseline rules) */}
      <div className="wt-rules">
        <span className="wt-rule wt-rule--1" />
        <span className="wt-rule wt-rule--2" />
        <span className="wt-rule wt-rule--3" />
      </div>

      {/* new alignment system (appears during transformation) */}
      <div className="wt-newgrid">
        <span className="wt-newgrid__v wt-newgrid__v--1" />
        <span className="wt-newgrid__v wt-newgrid__v--2" />
        <span className="wt-newgrid__h wt-newgrid__h--1" />
        <span className="wt-newgrid__h wt-newgrid__h--2" />
        <span className="wt-newgrid__h wt-newgrid__h--3" />
      </div>

      {/* margin labels */}
      <div className="wt-labels">
        <span className="wt-label">01 — Introduction</span>
        <span className="wt-label">02 — Regions</span>
      </div>

      {/* typographic units */}
      <h1 className="wt-hed">{DOC.title}</h1>
      <p className="wt-dek">{DOC.dek}</p>

      <p className="wt-para wt-para--1">{DOC.paras[0]}</p>
      <p className="wt-para wt-para--2">{DOC.paras[1]}</p>
      <p className="wt-para wt-para--3">{DOC.paras[2]}</p>

      <PhotoBlock className="wt-fig" />
      <ChartBlock className="wt-chart" />
      <TableBlock className="wt-table" />

      {/* destination marker: a quiet title rule that draws on completion */}
      <span className="wt-resolve" />
    </TransformationLab>
  );
}
