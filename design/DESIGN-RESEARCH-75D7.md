# Phase 75D.7 — Research: Interactive Document Experience

*Study of three reference experiences + critique of 75D.5 / 75D.6R A–C, and the technology decision for the Spatial Document Engine. Principles only — nothing copied.*

---

## 1. Reference findings

### 1.1 OpenAI — GPT-6 Astra announcement page
- **Interaction architecture**: editorial scroll narrative, not an app. One cinematic gesture (launch film) at the top, then long-form content with choreographed reveals: benchmark charts animate as they enter the viewport, pull-quotes, embedded demo films. Passive-but-paced — the user consumes a *timed story*.
- **Visual hierarchy**: dramatic type scale (huge display headline → small refined body), monochrome-first palette with the model identity as the single expressive element. Whitespace is structural, not empty.
- **Motion choreography**: one thing moves at a time; sections hold (scroll-plateau pattern — transition in, hold, transition out), so each idea gets a beat. Nothing competes.
- **What makes it memorable**: restraint + one signature visual. The page feels expensive because everything *except* the hero is quiet.
- **Accessibility/performance**: real text (not baked images) for content; films are progressive enhancements with controls.

### 1.2 Portfolio (anbu07-96.github.io)
- **Interaction architecture**: conventional single-page portfolio — hero with availability badge, stat row (6+ years / 900+ endpoints / 97% SLA), sectioned cards (Who I Am / What I Do / By the Numbers), CTA links. Lightweight static page; no animation framework.
- **What works**: immediate signal (availability, role, numbers above the fold), scannable stat blocks, one clear primary action. It proves that *instant legibility* and honest numbers create trust without any motion at all.
- **Lesson for PDFKit**: clarity first — status and facts stated plainly, one primary CTA. (Interaction depth must be added *on top of* this legibility, never instead of it.)

### 1.3 Graffico Office (office.graffico.it)
- **Interaction architecture**: a real 3D space (Blender + React Three Fiber) explored first-person — WASD walk, mouse look, `E` to interact. The scene **is** the content: a radio that plays real stations, a screen where you write HTML/CSS that renders live, a project board, a pullable wall plug.
- **Why it feels alive**:
  1. **One continuous material reality** — a single consistent world, not panels on a page.
  2. **Direct manipulation** — you address objects themselves (radio, plug), no proxy chrome. Interactive objects *light up* = unmistakable invitation.
  3. **Cause and effect everywhere** — every input has a visible, physical response (plug leaves the socket, lights change).
  4. **Real functionality inside the scene** — the radio actually streams; the screen actually renders. The "toy" is real.
- **Performance techniques**: baked lighting (all lights/shadows pre-rendered into textures → cinematic look at near-zero runtime cost), progressive loading with an explicit % meter, keyboard+mouse as the only controls.
- **Accessibility note**: the experience is keyboard-driven by design, but a full first-person 3D scene is fundamentally heavy and exclusive; it works because Graffico's *product* is the demonstration.

## 2. Synthesis — what actually creates "interactive premium"

| Principle | OpenAI | Portfolio | Graffico |
|---|---|---|---|
| One continuous world/material | ◐ (editorial stage) | ✗ | ✓ |
| Object is the interface (direct manipulation) | ✗ | ✗ | ✓ |
| Every input → visible physical response | ◐ (scroll) | ✗ | ✓ |
| Choreography: one thing at a time, holds between beats | ✓ | — | ✗ |
| Restraint: one signature gesture | ✓ | ✓ | ✗ |
| Instant legibility of purpose | ✓ | ✓ | ◐ |
| Performance discipline | ✓ | ✓ | ✓ (baked) |

**Conclusion**: PDFKit needs Graffico's *directness* (the document is an object you address; everything responds) with OpenAI's *restraint* (choreographed, one beat at a time, mostly quiet) on top of the portfolio's *legibility* (facts and next action always plain). No WASD, no free-roam 3D, no shader spectacle — a utility product.

## 3. Why 75D.5 and 75D.6R A/B/C still read as "normal SaaS page + interesting processing card"

1. **The document is a guest, not the host.** In A/B/C the layout is still header → panel → content; the processing visual lives *inside* a bounded card. The page's owner is the chrome; the document never occupies the room.
2. **State tableaux, not a persistent object.** Empty/selected/processing/completed are four different compositions. Nothing persists and transforms — so nothing feels like *one thing you're working on*.
3. **No direct manipulation.** Before processing starts, the pointer does nothing. The upload zone is a form control with decoration. There is no cause-and-effect from the user's hand (the single strongest "alive" signal in Graffico's office).
4. **Motion plays *at* the user, looped.** A/B/C choreography loops on a timer regardless of the user; premium motion (OpenAI) holds beats and responds to progress and input.
5. **Depth is cosmetic.** Shadows/tilt exist, but depth never *means* anything — layers don't correspond to real document structure, and the user can't address them.
6. **Identity from styling, not from a spatial metaphor.** Atelier/Studio/Press differ in decoration; none of them say "PDFKit is the place where documents physically become other documents."

## 4. The new interaction philosophy — "Spatial Document Engine"

**The document itself becomes the interface.**

- One persistent document object owns the stage across the whole flow. It is dropped onto, it opens, it decomposes into its real structures (text / images / tables / layout), those structures travel and rebuild as a Word document, and the Word document settles and offers itself for download.
- The stage is a light-box room, not a card: no bounding panel, a floor with real ground shadows, restrained perspective.
- Every input has a physical response: pointer proximity tilts/parallaxes the stack, drag-over magnetizes and separates pages, drop lands with weight.
- Structure is literal: what lifts out of the PDF is labeled by what it *is* (TEXT, IMAGES, TABLES, LAYOUT) — an elegant exploded technical drawing, never random particles.
- Choreography with holds: presence → open → separate → analyze → travel → rebuild → settle → download. One beat at a time; ambient motion quiets during beats.
- Utility first: a first-time user sees "PDF object → it transforms → Download Word" with zero instruction; all spectacle is *about* the actual conversion.

## 5. Technology decision

**Chosen: CSS 3D transforms + CSS custom-property pointer physics (rAF, no React re-renders) + CSS-keyframe choreography + a few `setTimeout`s for status text. Zero new dependencies.**

| Option | Verdict | Reason |
|---|---|---|
| CSS 3D + rAF + CSS keyframes | **CHOSEN** | The entire scene is ~10 flat planes with typography — CSS perspective renders layered planes convincingly (2.5D), DOM text stays crisp and accessible, transform/opacity-only animation is compositor-friendly (60fps), perfect reduced-motion statics, zero bundle cost, verifiable headless. |
| Web Animations API | partial | Native and fine, but CSS keyframes with explicit delays already give a deterministic timeline; WAAPI adds sequencing code without visual gain. May use for one-off transitions if needed. |
| Motion / Framer Motion | rejected | +tens of KB for springs we can express with `cubic-bezier(.34,1.56,.64,1)`; its re-render model fights the "no rerenders on pointermove" requirement (motion values ≈ our CSS vars). |
| Canvas 2D | rejected | Text-heavy scene; canvas text is blurry/second-class, loses accessibility and crispness, and forces a hand-rolled render loop. |
| Three.js / R3F / WebGL | rejected | Justified only for a true 3D world with meshes/camera/shaders (Graffico's room). Our scene is planes with typography — WebGL text becomes texture work; +60–150KB gzipped, context-loss handling, fallbacks, and GPU cost that a utility product shouldn't pay. Baked-lighting-style discipline is achieved instead with pre-rendered CSS gradients/shadows. |
| Shaders | rejected | No dissolve/liquid/particle requirement; our fixed-count structural elements don't need GPU effects. |

**Bundle impact: none.** No package.json/package-lock changes; the experiment is a route-isolated design-lab page (code-split, `noindex`, robots-disallowed); production routes are untouched.

## 6. Performance & accessibility plan

- Pointer physics: `pointermove` writes to a ref; a single rAF loop lerps two CSS custom properties on the stage root (one style write per frame, zero React renders); loop parks itself when settled; cleaned up on unmount. Skipped entirely under `prefers-reduced-motion` and coarse pointers.
- Transform/opacity only; shadows are static or opacity-crossfaded; no blur filters on animated elements; fixed element counts (~10 structural objects, no per-page scaling).
- Decorative scene `aria-hidden`; semantic file/phase/result info lives in an accessible action row with `role="status"`; keyboard: stage is focusable, Enter/Space opens the file picker; visible focus ring; contrast measured (oklch→sRGB, WCAG AA) with zero failures; reduced-motion gets deliberately composed static states, not `duration: 0s` on a mid-flight frame.
