"use client";

import { TransformationLab, DOC, PhotoBlock, ChartBlock, TableBlock } from "./transformation-lab";

/**
 * WORLD 1 — "Information Glass" (Phase 75D.8 visual R&D).
 *
 * The document as layered translucent information surfaces: four glass
 * plates (layout / text / images / tables) fanned so the material reads by
 * looking THROUGH them; a lens-curtain transformation field (with a bounded
 * SVG displacement refraction of painted rule lines — not an orb); beats:
 * fan → separate + refract → converge → resolve into one Word pane.
 * All beats are deterministic CSS compositions (no timers).
 */
export function WorldGlass() {
  return (
    <TransformationLab
      id="glass"
      index={1}
      name="Information Glass"
      summary="the document as layered translucent information — separated, refracted, reconstructed"
    >
      {/* environment */}
      <div className="wg-env">
        <div className="wg-env__rules" />
      </div>

      {/* SVG displacement filter — the lens bends the environmental rules */}
      <svg className="wg-svgdefs" aria-hidden="true" focusable="false">
        <defs>
          <filter id="wg-refract" x="-10%" y="-10%" width="120%" height="120%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.012 0.05"
              numOctaves="2"
              seed="7"
              result="noise"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="noise"
              scale="18"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        </defs>
      </svg>

      {/* transformation field (lens curtain) */}
      <div className="wg-lens">
        <span className="wg-lens__streak" />
        <span className="wg-lens__prism" />
      </div>

      {/* source: glass information plates */}
      <section className="wg-pane wg-pane--layout">
        <span className="wg-pane__title">Layout</span>
        <div className="wg-guides">
          <span className="wg-guides__frame" />
          <span className="wg-guides__v wg-guides__v--1" />
          <span className="wg-guides__v wg-guides__v--2" />
          <span className="wg-guides__h wg-guides__h--1" />
          <span className="wg-guides__h wg-guides__h--2" />
          <span className="wg-guides__anchor wg-guides__anchor--1" />
          <span className="wg-guides__anchor wg-guides__anchor--2" />
          <span className="wg-guides__anchor wg-guides__anchor--3" />
        </div>
      </section>

      <section className="wg-pane wg-pane--text">
        <span className="wg-pane__title">Text</span>
        <div className="wg-textlines">
          <p className="wg-textlines__head">{DOC.title}</p>
          <p>{DOC.paras[0]}</p>
          <p>{DOC.paras[1]}</p>
          <p className="wg-textlines__dim">{DOC.paras[2]}</p>
        </div>
      </section>

      <section className="wg-pane wg-pane--image">
        <span className="wg-pane__title">Images</span>
        <PhotoBlock className="wg-photo" />
      </section>

      <section className="wg-pane wg-pane--table">
        <span className="wg-pane__title">Tables</span>
        <TableBlock className="wg-table" />
      </section>

      {/* destination: the resolved Word pane */}
      <article className="wg-word">
        <header className="wg-word__head">
          <span className="wg-word__eyebrow">{DOC.eyebrow}</span>
          <h2 className="wg-word__title">{DOC.title}</h2>
          <p className="wg-word__dek">{DOC.dek}</p>
        </header>
        <div className="wg-word__body">
          <div className="wg-word__col">
            <p>{DOC.paras[0]}</p>
            <p>{DOC.paras[3]}</p>
          </div>
          <div className="wg-word__col wg-word__col--data">
            <PhotoBlock className="wg-photo wg-photo--sm" />
            <ChartBlock className="wg-chart" />
          </div>
        </div>
        <TableBlock className="wg-table wg-table--word" />
        <footer className="wg-word__meta">{DOC.meta}</footer>
        <span className="wg-word__edge" aria-hidden="true" />
      </article>
    </TransformationLab>
  );
}
