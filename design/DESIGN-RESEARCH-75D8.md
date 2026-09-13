# Phase 75D.8 — Visual R&D: Document Transformation Worlds

*Three isolated transformation scenes exploring an original visual language for
PDFKit. Art direction only — no workflow, no API, no production changes.
75D.5 remains the production baseline; A/B/C and 75D.7 stay archived.*

---

## 1. Reference re-study (craft level, nothing copied)

The three references were studied this session (full notes in
`DESIGN-RESEARCH-75D7.md`); re-examined for THIS phase through the lens of
materiality and environment, plus fresh technique research:

- **OpenAI GPT-6 Astra** — the lesson is *visual confidence*: one continuous
  stage, generous but structured composition, motion that holds beats. The page
  owns the whole viewport; nothing sits "in a box on a page."
- **Portfolio (anbu07-96)** — instant legibility and honest density: numbers,
  labels, sections. Reminder that information itself, well-set, is premium.
- **Graffico Office** — one continuous material world; the environment is the
  experience. Directness: you address objects, everything responds.
- **Fresh craft research (2026 liquid-glass / kinetic-type techniques)**:
  - Real refraction on the web = SVG `feDisplacementMap` bending a backdrop
    copy — high-contrast edges make the bend read instantly; backdrop-filter
    blur alone is *not* refraction. Refraction + full-screen blur is expensive;
    it must be bounded.
  - Layered glass reads as depth by *looking through* layers (rising blur per
    layer, falling opacity), not by drop shadows.
  - Kinetic/spatial typography is a 2026 brand-voice direction; type as the
    primary spatial material works without any imagery.

## 2. Lessons carried forward from 75D.7 (rejected visually)

1. White paper on white canvas = empty. **Environments must participate.**
2. The object needs **visual mass** (45–70% of the central field at key beats).
3. Grey bars / blue blocks read as developer placeholders — **rich synthetic
   content only** (real sentences, real table values, a chart, a "photograph",
   captions, small-caps labels).
4. Timer-driven timelines made screenshots lie. **Deterministic beat controls**
   (START / MID / RECONSTRUCT / COMPLETE) — each beat is a fully authored
   composition; motion is the transition between beats.
5. Debug-style exploration UI is out of scope for R&D. Art direction is the gate.
6. Completion must be the strongest frame, not the emptiest.

## 3. Shared design decisions

- **PDF = structured information, not office paper.** Source compositions are
  information (type, data, image, structure); only the *destination* resolves
  into a recognizable document.
- **The viewport is the transformation space**: each world paints a full
  environment (gradient field + light + vignette) — never `#ffffff` with an
  object in the middle.
- **Deterministic beats**: `data-beat` on the lab root drives every element's
  position/opacity through CSS; PLAY just sequences beats. Screenshots freeze
  exact authored states; state↔filename agreement is verified programmatically.
- **Shared synthetic document** (same information in every world, so the three
  directions are comparable): "Quarterly Field Report, Q3 2026" — 4 real
  paragraphs, a 4-row regional table, a 7-point weekly-intake chart, a "field
  site" photograph (painted with gradients/clip-path), captions, small-caps
  labels, meta chips. The destination reorganizes the same content.
- **Reduced motion**: beats are authored stills, so `prefers-reduced-motion`
  simply removes transitions — every composition remains fully available.

## 4. The three worlds

### World 1 — Information Glass (`/design-lab/transformation/information-glass`)
The document as **layered translucent information surfaces**: four glass plates
— Layout (guide grid), Text (real paragraphs), Images (photo), Tables (data) —
fanned so their translucency reads by *looking through* each other (rising
backdrop-blur, falling opacity per layer). A vertical **transformation field**
(a lens curtain with a bent-light streak and prismatic edge — explicitly not an
orb) refracts faint environmental rule lines through a bounded SVG
displacement filter while panes cross it, skewing and brightening as they pass.
Complete: the panes converge and resolve into a single solid Word pane — title,
two columns, table, chart, figure — the hero, with one spectral top edge as the
signature. Environment: cool mineral blue-white, pointer-tracked light.

### World 2 — Spatial Typography (`/design-lab/transformation/spatial-type`)
The document **is** typography in space — no page object at all. A dense
editorial composition: serif display headline, italic dek, three real paragraph
blocks at different depths, a rules-only table, a thin data chart with numerals,
a quiet figure, small-caps margin labels, hairline baseline rules — and a giant
environmental pilcrow (¶, the paragraph mark) ghosted into the background.
Transformation = **the alignment system changes**: baseline rules dim, a new
primary-tinted grid appears, the headline lifts, paragraphs slide apart along
baselines, the table unfolds row by row, the figure detaches and tilts — then
everything flows to the new grid and locks into a resolved editorial document.
Environment: warm pearl with a warm light source; serif (Georgia) display over
sans data type.

### World 3 — Document Matter (`/design-lab/transformation/document-matter`)
The document as **structured digital matter**: ~46 authored fragments — heading
chips, paragraph strips with real (tiny) text, six tiles that are slices of one
photograph, table-cell chips with real values, page-boundary frames, layout
anchors — assembled as a document-shaped mass. Transformation = controlled
fragmentation: groups release along three visible streamlines (semantic groups
stay loosely together — strips travel as a ribbon, tiles as a flock), pass
through a volumetric light column, and dock into a forming Word structure:
strips align into rows, tiles merge into a 2×3 figure, cells snap into a grid,
frames align into the page outline. Complete: the resolved document as hero,
light settling overhead. More fluid choreography (staggered per-fragment
transitions with docking overshoot), never dust, never particles without
meaning. Environment: pearl-grey graphite, vertical light column.

## 5. Technology decision (per world, visual-quality driven)

**Zero new dependencies — chosen for visual quality, not convenience:**

| World | Tech | Why not WebGL |
|---|---|---|
| Glass | CSS 3D + `backdrop-filter` layering + ONE bounded SVG `feDisplacementMap` on the lens (refracting painted rule lines, not live DOM) | Real glass over real text needs DOM text crispness; WebGL text becomes SDF/texture work. The displacement filter gives true refraction cheaply on a static backdrop. |
| Spatial Type | DOM text + CSS 3D transforms | Editorial typography quality (kerning, optical sizing, variable system serif) exceeds WebGL text pipelines at any budget. |
| Matter | ~46 absolutely-positioned fragments, per-beat CSS transforms with per-fragment delays | 46 composited transforms = trivial GPU load; fragments contain real text/content that stays crisp. |

WebGL/Three.js would earn its cost for volumetrics, fluid sims, or thousands of
particles — all on this phase's avoid-list. No package.json change; production
builds and CI completely untouched. If a world is chosen, its productionization
phase can revisit WebGL for the specific effects that survive review.

## 6. Scores, self-critique and recommendation

**Scores (1–10, honest; verified states, iterated once per world):**

| Criterion | Glass | Spatial Type | Document Matter |
|---|---|---|---|
| Visual impact | 7 | 8 | 9 |
| Originality | 7 | 8 | 8 |
| Premium feel | 8 | 9 | 8 |
| Transformation clarity | 7 | 9 | 8 |
| Environmental depth | 8 | 7 | 9 |
| Interaction quality | 7 | 6 | 7 |
| Completion frame | 8 | 8 | 9 |
| Memorability | 7 | 8 | 9 |
| Performance feasibility | 7 | 9 | 8 |
| Scalability across tools | 8 | 8 | 7 |
| **Total /100** | **74** | **80** | **85** |

**The four questions:**
- *Which makes you want to keep looking at it?* **Document Matter** — the fragment
  flight through the light column is the most cinematic; Information Glass is a
  close second on material beauty.
- *Which communicates transformation fastest?* **Spatial Typography** — an
  alignment system visibly changing is the most instantly legible metaphor.
- *Which feels least like existing PDF websites?* **Document Matter** — no
  competitor in the category does structured-fragment choreography.
- *Strongest potential as PDFKit's visual identity?* **Document Matter**, with
  Spatial Typography's alignment language as the legibility foundation.

**Recommendation (not a decision):** pursue **Document Matter** as the identity
direction, importing Spatial Typography's alignment-system grammar for the
destination structure and reserving Glass's material treatment for production
surface accents (subtle, never full glassmorphism). The final gate is human
visual review of the 18 screenshots.

**Severe self-critique:**
- *Information Glass*: in stills it still risks reading as "frosted cards";
  the lens "refraction" is a turbulence displacement, not a true Snell-law
  bend (subtle at screenshot scale); pane content is small; with animation
  removed it survives as a beautiful glass stack, but the transformation
  story is the least literal of the three.
- *Spatial Typography*: the least interactive world (parallax only); its MID
  state spreads content widest and could read as disorder rather than
  choreography; the giant ¶ must stay restrained or it becomes a gimmick;
  completion is calm to a fault — the drawn rule carries the resolve.
- *Document Matter*: fragment text is intentionally micro (7–8px — readable
  as texture, not as words; critics may call it noise); 43 fragments must
  remain meaning-bound or the world drifts toward the particle effects this
  phase explicitly bans; the 390×844 adaptation is an honest scaled
  composition (structure metric ≈ 0 at that scale) and would need a true
  mobile recomposition in productionization; highest per-tool design cost.
- *Process honesty*: the worlds were verified programmatically (state
  signatures per beat, 9–15% pixel deltas between beats, structure coverage,
  composition metrics, contrast via exact browser color conversion) — not by
  human eyes. The reviewer's 18-screenshot pass is the real gate.

**Approximate visual complexity:** Glass ~45 scene elements (5 backdrop-filter
surfaces, 1 bounded SVG displacement filter); Type ~60 DOM text elements
(transform-only); Matter 43 fragments + 6 overlays (composited transforms, one
pointer rAF writing 2 custom properties per world; all animation paused when
the tab is hidden; all beats are transition-based, so idle scenes run zero
loops).

