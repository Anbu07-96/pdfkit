# PDFKit architecture

This document describes how PDFKit is actually built today (Phase 1: foundation
and product shell) and the boundaries that keep future phases — real PDF
processing, OCR, AI, accounts, storage and billing — additive rather than a
rewrite.

---

## 1. Layering

```text
Presentation            src/app, src/components
      ↓
Application logic       src/lib/tools, src/lib/upload, src/lib/config
      ↓
API                     (future) src/app/api/**  — does not exist yet
      ↓
PDF processing          (future) server-side services — contract only today
      ↓
Storage                 (future) temporary object storage — does not exist yet
```

Rules that hold in the current codebase:

- **No processing logic lives in a component.** There is no processing logic at
  all yet, and the place it will live (`src/lib/processing`) contains a contract
  file with types only — no implementation, no mock, no simulation.
- **Components never import a processing implementation.** They import the
  catalog and pure helpers.
- **The upload component is independent of processing.** `UploadZone` validates
  and lists a selection; it does not know what will eventually be done with it.
- **No unnecessary services.** Phase 1 is a single Next.js app: no database, no
  queue, no worker, no external infrastructure.

---

## 2. Why this stack

**Next.js 16 (App Router) + React 19 + TypeScript.**
Most of PDFKit is content: a catalog, category pages and tool pages. Server
components render these statically, so the client only downloads JavaScript for
genuinely interactive parts (search, theme, mobile menu, upload zone). The App
Router also gives the future processing API a home (`app/api/**`) inside the
same deployment, so Phase 2 does not require a second service. Static generation
covers SEO (metadata, canonical URLs, `sitemap.xml`, `robots.txt`).

**Tailwind CSS v4.** Design tokens are CSS variables consumed by utilities:
theming is a variable swap, there is no styling runtime, and the shipped CSS
stays small. Dark mode uses a `.dark` class (rather than only
`prefers-color-scheme`) so the user can override the system setting.

**Owned design system instead of a component library.** The primitives PDFKit
needs are small and behaviour-specific (upload states, status badges, tool
cards). Writing them locally avoids a large dependency and keeps accessibility
decisions explicit. Where the platform already solves a problem well, the
platform is used: `<dialog>` for the modal, `<details>` for FAQs, `<input
type="search">` for search.

**Vitest + Testing Library.** Vite-native and fast, and tests query by
accessible role/name, which doubles as an accessibility check.

**Self-hosted fonts (`geist` package).** No third-party font CDN request, which
matches the privacy positioning and removes an external dependency from the
critical path.

Rejected alternatives: a separate SPA + API server (two deployments, no SEO
benefit, unnecessary now); a component kit such as MUI (heavier than the small
set of primitives needed); CSS-in-JS (runtime cost); a database (nothing to
persist in Phase 1).

---

## 3. Directory structure

```text
src/
├─ app/                       Routing and page composition only
│  ├─ layout.tsx              Providers, header/footer, skip link, theme script
│  ├─ page.tsx                Homepage — composes src/components/home sections
│  ├─ tools/page.tsx          Catalog page (search + filters)
│  ├─ tools/[toolId]/         Tool page, generated from the catalog
│  ├─ categories/[categoryId] Category page, generated from the catalog
│  ├─ styleguide/             Internal design-system reference (noindex)
│  ├─ pricing, privacy, terms, help, faq, developers, roadmap
│  ├─ sitemap.ts, robots.ts   Derived from the catalog
│  └─ error.tsx, loading.tsx, not-found.tsx
├─ components/
│  ├─ ui/                     Design system primitives (no product knowledge)
│  ├─ layout/                 Header, desktop/mobile nav, footer, breadcrumbs
│  ├─ home/                   Homepage sections
│  ├─ tools/                  Tool card, category card, search, tool page shell
│  ├─ upload/                 UploadZone, FileCard
│  └─ theme/                  ThemeProvider
└─ lib/
   ├─ tools/                  types, categories, catalog, search, selectors
   ├─ upload/file-validation  Pure validation rules (no React, no DOM)
   ├─ processing/contract.ts  Future boundary — types only
   ├─ config/site.ts          Site metadata and navigation
   ├─ theme.ts                Theme store + pre-paint script
   └─ utils/                  cn(), formatting helpers
```

Conventions:

- Pages compose sections; they do not contain layout-heavy markup themselves.
- `components/ui` knows nothing about tools; `components/tools` knows nothing
  about routing internals beyond the catalog's `route` field.
- Anything pure and testable belongs in `src/lib`, next to its `*.test.ts`.

---

## 4. Design system

Tokens are declared once in `src/app/globals.css`:

- `:root` defines the light palette; `.dark` defines a separately designed dark
  palette (not an inversion — surfaces, borders and the brand colour are tuned
  for contrast on dark backgrounds).
- `@theme inline` maps those variables to Tailwind utilities, so
  `bg-surface`, `text-muted`, `border-border`, `shadow-md`, `rounded-xl` and
  friends are theme-aware everywhere.
- Radius, elevation and font tokens are defined in the same place.

Component conventions:

- Variants are plain lookup maps (`variants[variant]`), merged with
  `cn()` (clsx + tailwind-merge) so callers can override safely.
- Focus is a single global treatment (`:focus-visible` outline using
  `--color-ring`) so every control is visibly focusable.
- Interactive controls are at least 44px tall on touch viewports.
- State is never communicated by colour alone: status badges carry text,
  filters expose `aria-pressed`, and errors are announced with `role="alert"`.
- Motion is limited to short colour/shadow transitions, and
  `prefers-reduced-motion` disables animation globally.

`/styleguide` renders every primitive and every upload state so both themes can
be reviewed side by side. It is `noindex` and not linked from the main nav.

### Theming

`src/lib/theme.ts` is a tiny external store:

- The preference (`light | dark | system`) is stored in `localStorage` under
  `pdfkit-theme` and exposed through `useSyncExternalStore`, so React never
  writes state from an effect during hydration.
- The system preference is a second store backed by `matchMedia`, so a `system`
  preference follows the OS live.
- An inline script in `<head>` applies the resolved theme before first paint,
  preventing a flash. It is the only inline script in the app.

---

## 5. Tool catalog

`src/lib/tools` is the single source of truth. Everything else derives from it:
homepage, search, category pages, tool pages, related tools, footer counts,
sitemap and static params.

```ts
interface Tool {
  id: string;                  // "merge-pdf"
  name: string;                // "Merge PDF"
  description: string;
  category: ToolCategoryId;    // organize | convert | edit | security | ocr | ai
  icon: ToolIconName;          // string key, resolved by the presentation layer
  route: string;               // "/tools/merge-pdf"
  status: ToolStatus;          // AVAILABLE | COMING_SOON | PRO | DISABLED
  plannedTier: "free" | "pro"; // informational only
  supportedFileTypes: string[];// [".pdf"]
  acceptedMimeTypes: string[]; // ["application/pdf"]
  keywords: string[];          // extra search terms
  howItWorks: string[];        // honest description of the planned steps
}
```

Design decisions:

- **Icons are string keys, not components.** The catalog stays serializable and
  free of React imports; `components/tools/tool-icon.tsx` maps keys to icons.
- **Status is the honesty mechanism.** `isToolUsable()` is the only way the UI
  decides whether a tool can be used, and a unit test asserts that every tool is
  `COMING_SOON` while no processing exists. When a tool ships, exactly one field
  changes and the whole interface follows.
- **`plannedTier` never implies access.** It only renders as
  “Coming soon · Pro”.
- **Routes are derived** (`/tools/{id}`) and asserted by a test, so a page can
  never disagree with a card.

### Search

`searchTools(query, options)` in `src/lib/tools/search.ts` is pure and
synchronous:

- matches name, description, category name, keywords and file extensions;
- every whitespace-separated term must match (AND semantics);
- results are ranked (exact name → prefix → substring → keyword → description);
- an empty query returns the catalog, so the same function powers browsing,
  filtering and searching.

With ~42 entries this needs no index, no debounce and no network call, which is
why search feels instant and works without JavaScript-heavy machinery.

---

## 6. Upload and the processing boundary

`UploadZone` (client) handles selection only:

- states: empty, hover, drag-over, selected, error, disabled;
- validation delegated to `src/lib/upload/file-validation.ts`, which is pure and
  independently tested (type, size, empty file, duplicates, count);
- rejections render as an accessible error region, selections as removable
  `FileCard`s;
- when a tool is not implemented, the zone is rendered `disabled` with a
  **Coming soon** badge and a plain-language explanation.

`src/lib/processing/contract.ts` declares `ProcessingRequest`,
`ProcessingResult` and `ToolProcessor` — and nothing else. Phase 2 will:

1. implement a `ToolProcessor` for one tool on the server;
2. expose it through a route handler under `src/app/api/`;
3. call that endpoint from the tool page (never a processing library directly);
4. flip that tool's `status` to `AVAILABLE`.

No component, hook or page will need restructuring for that to happen.

---

## 7. Accessibility

- Semantic landmarks (`header`, `nav`, `main`, `footer`, `section` with
  `aria-labelledby`) and a skip link as the first focusable element.
- Icon-only controls require a `label` prop (`IconButton`), so they always have
  an accessible name.
- The theme menu implements the ARIA menu pattern (arrow keys, Home/End,
  Escape, focus return); the mobile menu locks scroll, moves focus into the
  panel and closes on Escape.
- Search uses `type="search"` with a real label, a visible clear control,
  Escape-to-clear and a polite live region announcing result counts.
- FAQs use `<details>`/`<summary>` and the modal uses `<dialog>`, inheriting
  native keyboard behaviour.
- Tests query by role and accessible name, so regressions surface quickly.

---

## 8. Performance

- Server components by default; `"use client"` only for search, theme, mobile
  nav, dialogs/toasts and the upload zone.
- All catalog, category and tool pages are statically generated at build time.
- Fonts are self-hosted and variable; no external CSS or font requests.
- Icons are imported individually from a tree-shakeable set.
- Styling is compile-time Tailwind; no runtime style engine.
- Animation is limited to colour/shadow transitions and respects
  `prefers-reduced-motion`.

---

## 9. Security posture (Phase 1)

- No secrets exist in the app; `.env*` is git-ignored apart from `.env.example`.
- Only `NEXT_PUBLIC_*` values are read, and they contain no sensitive data.
- No analytics, tracking or third-party runtime scripts.
- The single inline script is a static, self-contained theme initialiser.
- Future server credentials must stay server-side (no `NEXT_PUBLIC_` prefix) and
  be read only in route handlers or server modules.

---

## 10. Testing strategy

- **Pure logic** (`src/lib`) is unit tested directly: catalog integrity, search
  behaviour, file validation, formatting.
- **Components** are tested through the DOM with Testing Library, using roles
  and accessible names, covering navigation, theme switching, search, tool cards
  and every meaningful upload state.
- **Honesty guard:** a test fails the build if any tool is marked available
  while no processing exists — the rule is enforced, not just documented.
- `next/link` and `next/navigation` are mocked in `vitest.setup.ts` so component
  tests run without the Next.js runtime.
