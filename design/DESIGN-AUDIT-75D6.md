# PDFKit Design Audit — Phase 75D.6
*Design Director review, produced before any implementation. Method note: this audit was built from a full computed-style extraction of the live rendered app (typography census, container/border census, palette, contrast, shadows) via headless Chromium at 1440×900 light+dark and 390×844, plus live web research of current best-in-class products. Raw data: `/home/user/design-audit-75d6/design-audit.json`.*

---

## A. Current PDFKit visual audit (quantified)

Measured on the live PDF → Word page (4 states) + homepage, light & dark:

| Finding | Measurement | Verdict |
|---|---|---|
| **Border monoculture** | The *same* 1px gray border (`#e5e7eb`-equivalent) appears **19× per page state, 40× on the homepage**. Upload zone, file row, info strip, success panel, FAQ, privacy card, metadata card, 4 related-tool cards — all identical chrome. | The #1 genericness driver. Every region looks like the same component-library card. |
| **Card-in-card** | **43–52 bordered/rounded boxes per state; 10–16 nested inside another card.** Workspace column is literally: card + card + card + card. | Vercel's design system lists "no cards nested inside cards" as an explicit prohibition. We violate it everywhere. |
| **Flat typography** | **14px w400 dominates everything** (32–42 of ~95 text nodes). Largest text on the tool page: 20px (×3). Metadata, status, filenames, body, actions — all the same size. | No editorial voice. Hierarchy must be *searched for*, not seen. |
| **One shadow token, barely used** | Only `0 1px 2px 6%` exists; most "elevation" is done with borders. | Surfaces read as outlined, not layered. Flat composition. |
| **Color** | Blue-600 accent (good, ownable) + a green success panel + a *second* green "Available" badge per related card. Palette itself is restrained. | Accent ratio too high: green panel + green badges + blue buttons + blue links compete. No single focal signal. |
| **Contrast** | Zero WCAG failures (<4.5:1) across all measured text. | **Must preserve.** Current a11y is a strength. |
| **Type family** | Geist Sans + Geist Mono already installed; Mono is barely used. | Underused asset — mono is our "technical" voice. |
| **Workspace fit** | Workflow bottom = 339px at every desktop viewport; 429px spare at 1366×768; no horizontal overflow. | **Keep.** The 75D.5 spatial engineering is correct. |

**What the rendered page says today:** "a competent Tailwind/shadcn-style tool site." Not "a precision instrument." The identity is *defaults*.

## B. Competitor / inspiration audit

**Premium product/SaaS (studied via current design-system teardowns):**
- **Linear** — near-black canvas, **weight band capped at ~510** (hierarchy carried by size/spacing/color, never weight), **tracking that tightens as type grows** (−0.022em at 48px+), hairline borders + a *surface ladder* instead of shadows, **one accent at a tiny pixel ratio**, and — critically — identity defined by *prohibitions* (no gradients, no drop shadows, no second accent, no radius above 12px).
- **Vercel/Geist** — "design in monochrome; use color only when it adds significant meaning"; ink (#171717) IS the brand; Geist at 400/500/600 only; negative display tracking; stacked micro-shadows + inset hairline ring so cards "sit on the page without feeling material-heavy"; **"no cards nested inside cards," no decorative gradients/glows**.
- **Stripe** — typography as the hierarchy anchor (single family, systemic scale), restrained color ("restraint reads as confidence"), every interactive element with all six microstates, tabular numbers for data, skeletons that match the layout they replace.
- **Raycast** — weight 500 baseline on dark; *positive* tracking on dark for airiness; hover via opacity, not color swap; "dense product, sparse marketing"; dramatic negative space.

**Document/productivity competitors (live pages):**
- **Smallpdf** — SEO-first layout: feature icon cards, numbered how-to steps with screenshot, FAQ, blog-link banners, ratings widget, green brand, giant upload rectangle. Polished but *advertisement-shaped*.
- **iLovePDF** — giant "Select PDF file" button, "Powered by" attribution, upload speed/time stats, generic spinner + "Converting…" text. Utilitarian, dated.
- **Adobe Acrobat web** — enterprise-heavy, dense chrome, corporate gray.

**2026 trend synthesis:** minimalism has evolved — "2026 minimalism is not 2019 minimalism; empty space reads as unfinished… the distinction between minimalism and genericness is *brand character*." Micro-animations are now "usability infrastructure" (confirm, orient, reduce uncertainty), <300ms, purposeful. Depth is back via subtle layering/spatial composition, not glassmorphism-everywhere.

## C. Patterns we must NOT copy (the generic PDF-site kit)

1. Giant centered upload rectangle as the whole hero.
2. Bright colored per-tool branding / rainbow tool grids.
3. Feature icon-card rows ("Fast!", "Secure!", "Any device!") — marketing copy inside the tool.
4. Generic success: big green alert box.
5. Spinner + "Converting…" processing screens.
6. Blog/rating/link-farm clutter crowding the tool.
7. "Another nicer iLovePDF" — the whole category converges on this kit; our difference must be structural, not cosmetic.

## D. Design principles learned (what we take, not copy)

1. **Hierarchy without shouting** — narrow weight band (400/500/600 max), size + spacing + color do the work.
2. **Tracking ramps with size** — tighten display, open up uppercase micro-labels.
3. **Surface ladder over borders** — separate planes by tonal step + hairlines, not outline-everything.
4. **One accent, tiny ratio** — blue = action + live signal only; green = a check, never a panel.
5. **Prohibitions define identity** — we will write ours down and enforce them.
6. **Mono is a voice** — filenames, counts, and technical strings in Geist Mono.
7. **Motion as feedback** — four verbs only: respond, direct, transform, confirm.
8. **Interaction completeness** — every control: default/hover/focus/active/disabled/loading.
9. **Calm = confidence** — one focal element per state; everything else recedes.
10. **Minimalism needs character** — restraint earns nothing without a signature.

## E. PDFKit's design philosophy — *"The Precision Document Bench"*

PDFKit is a **precision document workspace**: the quiet, instrument-grade bench on which documents are measured, transformed, and returned. The personality is that of a **typesetter's composing bench crossed with a lab instrument** — measured, exact, calm, fast. Premium comes from *precision made visible*: baseline grids, a working caret, tabular figures, hairline structure, and one luminous signal.

**Identity prohibitions (ours, enforceable):**
- No card nested inside a card. Ever.
- No border where a tonal step or a hairline divider will do.
- No green/amber/red panels — status is a glyph + a line of type, in context.
- No second accent. Blue is the only chromatic voice (plus semantic glyphs).
- No weight above 600. No display type above 32px in-workspace.
- No decorative motion; every animation names its verb (respond/direct/transform/confirm).
- Filenames, counts, sizes: mono. Prose: sans. Never mixed within a line.

**Recognizable without a logo:** the combination of (1) the working caret, (2) baseline-field processing visual, (3) mono technical strings inside editorial sans, (4) single raised bench surface — is ours.

## F. Typography direction

| Role | Spec | Notes |
|---|---|---|
| Tool title | 30px / 600 / **−0.02em** / lh 1.15 (24px mobile) | Editorial anchor; tightens like Linear display type |
| Section label (eyebrow) | 11px / 500 / **+0.08em** / uppercase / subtle | "PRIVATE", "RESULT", "RELATED TOOLS" — taxonomy, not display |
| Body | 14px / 400 | unchanged |
| Secondary / status | 13px / 400–500 | status gets a leading verb ("Converting — Analyzing structure…") |
| **Technical strings** | **Geist Mono 12.5–13px** | filenames, sizes, page counts, timings, file types |
| Actions | 14px / 500 | buttons never shout via size |

## G. Color & depth direction

- **Blue stays** (evolve later, globally, in its own phase — not in this prototype). New discipline: blue appears **only** on the primary action, the live signal (caret + active elements), and focus. Everything else is ink/gray.
- **Success** = a check glyph in success-green + ink text. No panel, no fill. (Green pixel ratio drops ~95%.)
- **Depth:** the page canvas takes one step *back* (light: `surface-muted`; dark: one step down), the **bench** — the single workspace surface — sits one step *up* with a stacked soft shadow (two offsets, no border). Inside the bench: no boxes; hairline dividers and whitespace. The upload target is the only *inset well* (one step down + hairline) because it is an interactive zone.
- Radius vocabulary collapses to **12px (bench), 8px (controls), 9999 (pills)** — three radii, nothing else.

## H. Workspace philosophy — one continuous bench

The page is **one bench**, not a stack of cards. The journey reads as a single composition:

```
┌──────────────── THE BENCH (one raised surface) ────────────────┐
│  [ inset well: drop PDF ]            ← SELECT                 │
│  ─────────────────────────── hairline                          │
│  filename.pdf · 2.4 MB · 4 pages      [ Convert → ]  ← CONFIGURE
│  text-extraction note + details                                │
│  ─────────────────────────── hairline                          │
│  baseline field + caret               ← PROCESS (same region)  │
│  Converting — Analyzing structure…                             │
│  ─────────────────────────── hairline                          │
│  ✓ Done   document.docx · 12 KB     [ ↓ Download ]   ← RESULT  │
└────────────────────────────────────────────────────────────────┘
   PRIVATE · processed in memory · discarded immediately   details
```

- File row, processing, and result occupy the **same region** (kept from 75D.5 — measured, stable).
- Selection collapses the well to a slim open strip (no box).
- Trust is a **quiet signature line** under the bench — always present, never a card.
- How-it-works / FAQ / related tools stay (product + SEO requirements) but as **open editorial sections** with hairline dividers and typographic headings; related tools become a text list, not 4 cards.

## I. Motion philosophy — "settle, don't slide"

One product-wide system, four verbs:

| Verb | Duration / curve | Used for |
|---|---|---|
| **respond** | 140ms `ease-out` | hover, press, focus ring |
| **direct** | 220ms `cubic-bezier(0.22, 1, 0.36, 1)` | disclosure, well↔strip collapse, panel swap |
| **transform** | 450ms same curve | result arrival, success settle |
| **confirm** | one-shot ≤600ms | check draw, download CTA entrance |

Continuous motion exists **only** while a job is live (the caret loop). Everything transform/opacity. Reduced-motion: static composed field, no loop.

## J. Processing visual concept — **"The Typesetting Field"**

*What would someone remember?* Not a machine, not a journey from icon to icon — **a document being re-set.** Text extraction is literally re-flowing text into paragraphs; the visual should be that, abstracted:

- A wide, shallow **baseline field**: 5 faint horizontal baselines (the ruled sheet of a typesetting bench), rendered in gentle 2.5D (slight perspective tilt for depth, no sci-fi).
- **Abstract text marks** — small rounded bars of varying width (words/lines, never a PDF icon) — sit *off-baseline* (unstructured) at loop start.
- The signature element: a **working caret** — a slim vertical caret in signal blue — sweeps slowly across the field; as it passes, marks **settle onto their baselines** (staggered, with a 200ms settle each). The document is being *re-composed* in place.
- Loop (6s): caret sweeps → marks set → brief hold (composed) → marks gently lift and scatter → repeat. Calm, hypnotic, precise.
- **Success:** caret parks at the final baseline position, blinks once, all marks set, baselines brighten a step, check badge draws — the field *becomes* the result.
- **Error:** the caret stops mid-field; marks freeze at half-opacity; a restrained error badge. Nothing shatters.
- **Fixed elements:** 8 marks + 1 caret + 5 baselines + 2 ambient specks = 16, always. No JS animation, no canvas, pure CSS keyframes.
- **Mobile:** 5 marks, 4 baselines, shorter sweep — a recomposed composition, not a shrunken one.

This is honest (it *is* what the engine does), typographic (it *is* our identity), and ownable (no PDF product uses a typesetting caret as its processing state).

## K. Result / download concept

The green panel dies. Completion is the **natural end-state of the field**: the last mark sets, the caret parks, and the result region settles (450ms) into:

- `✓ Converted` — check glyph + eyebrow, success-green check only
- `document.docx` in mono + `· 12 KB · 4 pages` meta
- **Download button** — the single most prominent element on the page: full blue, the only saturated rectangle in the workspace, entering with a 450ms settle + 8px rise
- `Convert another PDF` as a quiet ghost action, not a second button

Processing → result is one continuous composition in the same region — no layout jump (the 339px-bottom guarantee is preserved).

## L. Mobile philosophy

Not a shrunken bench: the bench goes full-bleed edge-to-edge (radius 0, margin 0, shadow 0 — the screen *is* the bench), title drops to 24px, the field recomposes to 5 marks/4 baselines, the trust line moves below the bench, and Download stretches full-width. Upload well keeps its generous tap target. No horizontal overflow (verified).

---

## Implementation scope (this prototype)

**PDF → Word only.** Files: `tool-page-shell.tsx` (compact variant), `pdf-to-word-workspace.tsx`, `upload-zone.tsx` (compact restyle), `job-processing-visual.tsx` (+`TypesettingFieldTreatment`, DIC + V1 preserved as archived), `globals.css` (bench tokens + `ts-` block; `rec-`/`dic-` stay archived). Header/nav: unchanged in this phase. All functionality, API, limits, a11y contracts unchanged.
