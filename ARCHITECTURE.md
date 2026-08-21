# PDFKit architecture

This document describes how PDFKit is actually built today (Phase 1: foundation
and product shell; Phase 2: the processing layer and the first working tool,
Merge PDF) and the boundaries that keep future phases — more tools, OCR, AI,
accounts, storage and billing — additive rather than a rewrite.

---

## 1. Layering

```text
Presentation            src/app, src/components
      ↓  (browser)
Processing client       src/lib/processing/client.ts      — the only fetch call
      ↓  HTTP multipart
API route               src/app/api/tools/merge-pdf/route.ts (thin)
      ↓
HTTP adapter            src/lib/processing/http.ts        — parsing, limits, headers
      ↓
Processing service      src/lib/processing/service.ts     — validate, run, report
      ↓
Tool processor          src/lib/processing/processors/*   — implements the contract
      ↓
PDF library             pdf-lib
      ↓
Result                  bytes streamed back in the same response
```

Rules that hold in the current codebase:

- **No processing logic lives in a component.** `MergePdfWorkspace` owns
  selection and request state only; it never imports pdf-lib or a processor.
- **The boundary is enforced, not just documented.** Every processing module
  starts with `import "server-only"`, so `next build` fails if a client
  component ever pulls one in.
- **The route handler is thin.** It supplies a tool id and a fallback file name;
  all HTTP concerns live in the shared adapter, so the next tool route is ~10
  lines.
- **The upload component is independent of processing.** `UploadZone` validates,
  lists and orders a selection; it does not know what will be done with it.
- **No unnecessary services.** Still a single Next.js app: no database, no
  queue, no worker, no object storage.

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

**pdf-lib for PDF work.** Nothing already in the project could parse or write
PDFs. pdf-lib is pure TypeScript with no native binaries or system packages
(unlike Ghostscript/qpdf bindings), which keeps deployment simple, and its
`copyPages` API is exactly what merging needs. It runs only in the Node runtime,
never in the browser bundle.

**Vitest + Testing Library.** Vite-native and fast, and tests query by
accessible role/name, which doubles as an accessibility check. Server tests opt
into the Node environment with `// @vitest-environment node`, and the
`server-only` marker is aliased to an empty stub so those modules can be unit
tested directly.

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
│  ├─ api/tools/merge-pdf/    POST endpoint (delegates to the HTTP adapter)
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
│  ├─ tools/workspaces/       Interactive UIs for implemented tools
│  └─ theme/                  ThemeProvider
└─ lib/
   ├─ tools/                  types, categories, catalog, search, selectors
   ├─ upload/file-validation  Pure client-side rules (no React, no DOM)
   ├─ processing/
   │  ├─ contract.ts          The boundary: request, artifact, result, processor
   │  ├─ registry.ts          Implemented processors (authoritative)
   │  ├─ service.ts           Validate → run → structured result + safe logging
   │  ├─ http.ts              Multipart parsing, size guards, response headers
   │  ├─ errors.ts            Error codes, HTTP mapping, safe bodies (isomorphic)
   │  ├─ limits.ts            Env-configured limits with documented defaults
   │  ├─ rules.ts             Per-tool input rules shared with the UI
   │  ├─ client.ts            Browser-side API client (the only fetch)
   │  ├─ validation/          PDF signature and limit checks
   │  └─ processors/          merge-pdf.ts
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

## 5a. Merge PDF: how a request flows

1. **Selection.** `UploadZone` (controlled, `orderable`) validates types and
   sizes in the browser and lets the user reorder or remove documents. Order is
   just array order — no drag-and-drop dependency was added.
2. **Request.** `runMergePdf()` builds a `FormData` with one `files` field per
   document, in display order, and POSTs it with an `AbortSignal` so Cancel
   really cancels.
3. **HTTP adapter.** Rejects non-multipart requests, rejects an oversized
   `Content-Length` before reading the body (with a small allowance for
   multipart overhead), caps the file count, then reads each part while
   accumulating the total size.
4. **Service.** Resolves the processor from the registry, runs shared validation
   (count, extension, MIME, emptiness, per-file size, **PDF signature**, total
   size), then calls the processor.
5. **Processor.** Loads each document with pdf-lib, copies its pages into a new
   document in order, serialises the result. Every library failure is mapped to
   a typed `ProcessingError` — malformed input is never silently skipped.
6. **Response.** Bytes are streamed back as `application/pdf` with
   `Content-Disposition`, `no-store` and `nosniff`. The browser turns the blob
   into an object URL for the download link and revokes it when it is replaced.

Failure handling is uniform: every expected problem is a `ProcessingError` with
a code, an HTTP status, a user-safe message and optional per-file details.
Unexpected errors collapse to `INTERNAL_ERROR`; the real cause is logged
server-side only.

### Temporary data and logging

The MVP never writes uploads to disk. Documents live in memory for the duration
of one request; the service clears the input array in a `finally` block, on
success and failure alike, so buffers are released immediately. Because there
are no temporary files, there is no cleanup job, no public temp directory and
no predictable file names to guess.

Logging is deliberately thin: `tool`, `outcome`, `files`, `bytes`, `ms` and an
error code. File names, metadata and document contents are never logged.

### Two guards that keep this honest

- `registry.test.ts` asserts catalog ↔ registry parity in both directions: a
  tool may only claim `AVAILABLE` if a processor exists, and every processor
  must have a catalog entry marked `AVAILABLE`.
- `import "server-only"` in every processing module makes the build fail if the
  browser bundle ever reaches for them.

## 6. Upload and the processing boundary

`UploadZone` (client) handles selection only:

- states: empty, hover, drag-over, selected, error, disabled, busy;
- optional controlled mode (`files` + `onFilesChange`) and `orderable` mode with
  accessible move up/down controls, used by Merge PDF;
- validation delegated to `src/lib/upload/file-validation.ts`, which is pure and
  independently tested (type, size, empty file, duplicates, count);
- rejections render as an accessible error region, selections as removable
  `FileCard`s;
- when a tool is not implemented, the zone is rendered `disabled` with a
  **Coming soon** badge and a plain-language explanation.

`src/lib/processing/contract.ts` declares `ProcessingRequest`,
`ProcessingArtifact`, `ProcessingResult` and `ToolProcessor`. Adding the next
tool is now a fixed, four-step recipe:

1. implement a `ToolProcessor` under `src/lib/processing/processors/`;
2. register it in `registry.ts` and add its input rules to `rules.ts`;
3. add a ~10-line route handler that calls `handleProcessingRequest`;
4. add a workspace component, map it in `components/tools/workspaces`, and flip
   the catalog status to `AVAILABLE`.

Validation, limits, error shaping, logging and response headers are shared, so
no component, hook or page needs restructuring.

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

## 9. Security posture

Every uploaded file is treated as untrusted input:

- **Independent server-side validation.** File name, extension and browser MIME
  type are all advisory; the server additionally checks the `%PDF-` signature in
  the first kilobyte before handing anything to the parser.
- **Request-size protection.** `Content-Length` is checked before the body is
  read, then the file count and per-file and cumulative sizes are enforced while
  parsing. All three limits are configurable.
- **No public temporary files.** Nothing is written to disk or to `public/`.
- **Safe errors.** Clients receive a code and a short message; stack traces,
  library internals and causes never leave the server.
- **Privacy-safe logging.** Counts, byte totals, durations and error codes only.
- **Response hardening.** `no-store`, `nosniff` and a sanitised
  `Content-Disposition` file name (control characters and quotes stripped, so
  the header cannot be split).
- **Secrets.** None exist; `.env*` is git-ignored apart from `.env.example`, and
  future credentials must stay server-side (no `NEXT_PUBLIC_` prefix).

This is a foundation, not a hardened production deployment: there is no rate
limiting, no authentication, no virus scanning and no per-IP quota yet.

---

## 10. Testing strategy

- **Pure logic** (`src/lib`) is unit tested directly: catalog integrity, search
  behaviour, file validation, formatting.
- **Components** are tested through the DOM with Testing Library, using roles
  and accessible names, covering navigation, theme switching, search, tool cards
  and every meaningful upload state.
- **Server tests** run in the Node environment and exercise the real processor
  with real PDFs built by pdf-lib, plus the route handler through its exported
  `POST`/`GET` functions.
- **Honesty guard:** a test fails if a tool is marked available without a
  registered processor, or a processor exists without an available catalog entry
  — the rule is enforced, not just documented.
- `next/link` and `next/navigation` are mocked in `vitest.setup.ts` so component
  tests run without the Next.js runtime.
