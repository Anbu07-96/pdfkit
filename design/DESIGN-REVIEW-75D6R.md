# Phase 75D.6R — Design Review Report
*Three visual directions for PDF → Word, prototyped in isolation for human review. Production tool untouched (75D.5 baseline).*

---

## 1. Repository sync verification

- Branch `arena/01a081d8-pdfkit`; local HEAD = remote HEAD = `a8deb31` at phase start (verified via fetch + `ls-remote`).
- Protected uncommitted files (`.github/workflows/ci.yml`, `.arena/*.md`) preserved throughout; never staged.
- Sandbox environment had been reset (node_modules/dev server wiped) — repaired via `npm ci` + offline Prisma stub/placeholder generate before any work.

## 2. Research performed

- **Recovered prior audit** (from git history `707a2df`): Linear (narrow weight band, tracking ramps, hairline surface ladder, one accent, identity via prohibitions), Vercel/Geist (monochrome-first, "no cards nested inside cards," stacked micro-shadows), Stripe (typography as hierarchy anchor, restraint = confidence, complete microstates), Raycast (weight-500-on-dark, opacity hovers), competitor audit (Smallpdf/iLovePDF/Acrobat converging on the same kit).
- **Fresh research this phase**: Superhuman's system — "maximum confidence through minimum decoration," warm cream surfaces, ONE dramatic gradient gesture, depth from color contrast and borders rather than shadow stacks, compressed display type, no pills (styles.refero.design / open-design.ai teardowns). 2026 trend syntheses: modern skeuomorphism (soft materials/shadows), progressive blur, spatial design, "2026 minimalism is not 2019 minimalism — restraint without brand character reads as unfinished." Upload/processing UX pattern research (SaaS UI 2026): constraints stated before the pick, a visible landing spot, both drop + click affordances, per-state feedback, honest processing states, aria-live announcements.

## 3. Why the rejected 75D.6 design failed

Measured + human verdict (too sparse, flat, narrow, empty, unfinished):

1. **Narrow**: max-w-3xl (768px) on 1366–1920 viewports → a small app floating in a large page.
2. **Surface removal without replacement**: 43 boxes → 7, but the replacement hierarchy (1px hairlines at ~6% contrast, white-on-white tonal steps) was below perception — no anchors remained.
3. **Typography-only hierarchy**: 30px title + 11px eyebrows + 13px mono could not carry a whole workspace; primary file information set in quiet mono read as tertiary.
4. **Processing visual without mass**: 4px marks, 1px baselines, 2px caret — in a static frame (screenshot) the field looked like faint ruled lines, i.e. empty.
5. **Empty state = absence**: 278px well + type on white, no focal object.
6. **Result state under-resolved**: an open row and a small glyph gave completion no visual event.
7. **No material warmth**: pure white-on-white light mode felt sterile.

## 4. Principles learned (applied to all three directions)

- Premium minimalism = composition + focal points + controlled richness + finished empty states — not removal.
- Use laptop width: 930–1050px workspaces measured.
- Fewer surfaces, but each one *visible*: real shadows, real tonal steps.
- One dramatic gesture per state (Superhuman): the processing stage is the gesture during work; the Download is the gesture at completion.
- Processing visuals need mass and a static-frame presence (screenshots must not look empty).
- Empty state contributes to identity (layered glyph / concentric target / ghost card + tray).
- Each concept keeps 75D.5's UX gains: same-region processing/result, laptop fit, obvious download, privacy.

## 5–8. The three directions (+ processing concept each)

### A — "The Atelier" (Refined Layered Workspace)
A premium studio worktable: one layered worktop panel (border + stacked soft shadows + inset inner highlight), a 992px composition, an inset **drop field** (solid hairline + inner shadow, not dashed), a layered-document glyph, constraint chips; the selected state is a **file plate** (dimensional file card + page tag + inline Convert); completion is the plate with a grid-faced result card and a large Download. Processing: **Layered Document Morph** — three document layers fan apart in 2.5D, four signal dots cross between them, then the layers converge and a structured grid face fades in (8 animated elements). Trust: single quiet line under the worktop.

### B — "Signal Studio" (Soft Technical / Ambient)
A calm technical instrument: an ambient panel with a controlled blue wash (gradient + radial glow that breathes only while processing and blooms once on completion), an eyebrow/title head, and a **concentric-ring drop target** that breathes (three 1px rings + center disc — no dashed rectangle anywhere). Selected: an inline file row with a live status dot. Processing: **Structured Signal Transformation** — five fragments travel two visible dashed guide paths (CSS `offset-path`, exact path following) through two station nodes that light as fragments pass, and assemble a 2×3 output grid whose cells fill exactly on each arrival (delay-synced). Trust: footnote line under the panel.

### C — "The Press" (Editorial / Spatial Hybrid)
An editorial spread crossed with a spatial workspace: a typographic left rail (masthead "PDF → Word", serial rule, numbered 01/02/03 protocol with live active step, file block, ink-colored Convert action, trust at the rail foot) and a large right **spatial stage** holding a recessed 3D tray. Empty: a ghost card floats above the empty tray. Selected: the document card rests in the tray. Processing: **Dimensional Transformation** — the card slowly turns in 3D (front face = loose content lines, back face = structured grid) while five content fragments orbit it on tilted rings; the protocol step and rail status narrate. Completion: the card lands showing its grid face + check, with a full-width blue Download bar under the stage.

## 9–10. Screenshots

Desktop 1440×900 (empty / selected / processing / completed / processing-dark) + mobile 390×844 (processing) for each concept — **18 shots** in `/home/user/verification-75d6r/concept-{A,B,C}/`, plus the production baseline `baseline/75d5-production-1440.png`. No horizontal overflow on any concept at any tested size.

## 11. Performance characteristics

- Pure CSS/SVG/DOM; transform/opacity only; zero JS animation loops; no libraries.
- Animated elements while processing: **A: 8 · B: 14 · C: 6** (all fixed-count; no per-page scaling, no random DOM).
- DOM weight: 168–180 nodes per page including site chrome.
- GPU-composited: A uses 3D layer transforms; B uses `offset-path` travel + gradient-opacity glow; C uses nested `preserve-3d` (single card + 5 orbit fragments).
- B's glow is an animated opacity on a static radial gradient (no blur filters).

## 12. Accessibility behavior

- **Contrast**: measured via proper oklch→sRGB conversion — **zero WCAG AA failures** across all three concepts (prototype text lifted from the 3.58:1 `subtle` token to `muted` where small).
- Keyboard: all controls are real `<button>`/`<details>`; visible `:focus-visible` rings (2px ring token) everywhere.
- Semantics: `role="status" aria-live="polite"` processing text in each concept; decorative stages `aria-hidden="true"` (verified in rendered DOM).
- Reduced motion: **0 running animations** (measured) — each concept degrades to a deliberately composed static: A shows the converged object with its grid face; B shows filled paths and the completed grid; C shows the resting card on its structured face. Switcher uses `aria-pressed`.

## 13–14. Scoring + strengths/weaknesses/risks

| Criterion (1–10) | A · Atelier | B · Signal Studio | C · The Press |
|---|---|---|---|
| Premium feel | 8 | 8 | 9 |
| Uniqueness | 6 | 8 | 9 |
| Clarity | 9 | 8 | 7 |
| Modernity | 8 | 9 | 8 |
| Visual balance | 8 | 7 | 8 |
| Motion quality | 7 | 9 | 8 |
| Performance | 9 | 8 | 8 |
| Mobile quality | 8 | 7 | 6 |
| Scalability across tools | 9 | 7 | 6 |
| **Total /90** | **72** | **71** | **69** |

**A** — Strengths: safest premium; genuinely layered depth; the clearest file plate; easiest to systematize across 33 tools. Weaknesses: least distinctive; "refined SaaS" rather than ownable identity. Risks: forgettable; reads as a template of good taste.

**B** — Strengths: the strongest processing narrative (paths literally diagram input→transformation→output); ownable "signal" motif; calm-tech atmosphere; motion is legible in screenshots. Weaknesses: light-mode glow balance is delicate; stage simplification on mobile loses diagram richness. Risks: ambient language drifts toward sci-fi HUD if discipline slips; not every tool converts naturally into "signals."

**C** — Strengths: the most memorable and identity-rich; typography does real editorial work; the document-as-protagonist stage is unique in the category. Weaknesses: asymmetry costs clarity; mobile stacking is dense (rail + long stage). Risks: hardest to scale — many tools lack rail-worthy content; 3D flip needs restraint on low-end devices.

## 15. Arena's recommendation (not a decision)

**B — Signal Studio** as the primary direction, importing **A's** worktop/file-plate materiality as the component system: B's identity (signals, ambient depth, arrival-synced motion) is the most ownable without sacrificing clarity, and its narrative generalizes to any document operation (fragments in → structure out). C is the boldest statement but the least scalable; A is the safest but the least distinctive. The final choice belongs to the human reviewer.

## 16. Prototype routes

- `/design-lab/pdf-to-word/a` · `/design-lab/pdf-to-word/b` · `/design-lab/pdf-to-word/c`
- Each has a state switcher (empty / selected / processing / completed). Not in navigation, not in the sitemap, `noindex` metadata, and `robots.ts` now disallows `/design-lab`.

## 17. Files changed

- `src/app/design-lab/layout.tsx` (new) — lab layout, imports lab CSS
- `src/app/design-lab/design-lab.css` (new) — all three concepts' styles, scoped `.dl-/.la-/.sb-/.pr-`
- `src/app/design-lab/pdf-to-word/{a,b,c}/page.tsx` (new) — noindex pages
- `src/components/design-lab/prototype-shell.tsx` (new) — dev banner + state switcher + mock data
- `src/components/design-lab/concept-{a,b,c}.tsx` (new) — the three prototypes
- `src/app/robots.ts` — added `Disallow: /design-lab` (keeps prototypes out of SEO)
- `design/DESIGN-REVIEW-75D6R.md` — this report

## 18. Test/build results

See the phase's final message: tsc clean, full vitest suite, lint, production build, prisma validate — all green; production pages byte-identical to the 75D.5 baseline.

## 19–20. SHAs

Final commit + verified remote SHA: recorded in the phase's final report message (this document is committed with the prototype).
