# PDFKit architecture

This document describes how PDFKit is actually built today (Phase 1: foundation
and product shell; Phase 2: the processing layer and Merge PDF; Phase 3:
page-level infrastructure, multi-artifact processing and Split PDF; Phase 4:
Extract and Delete PDF Pages on that same foundation; Phase 5: real page
rasterisation and Reorder PDF Pages; Phase 6: Rotate PDF and visual page
selection) and the boundaries that keep future phases
— more tools, OCR, AI, accounts, storage and billing — additive rather than a
rewrite.

---

## 1. Layering

```text
Presentation            src/app, src/components
      ↓  (browser)
Processing client       src/lib/processing/client.ts      — the only fetch call
      ↓  HTTP multipart
API route               src/app/api/tools/<tool>/route.ts (thin)
      ↓
Hardened handler        src/lib/hardening/route.ts        — guards: length gate, cap, timeout
      ↓
HTTP adapter            src/lib/processing/http.ts        — parsing, limits, headers
      ↓
Processing service      src/lib/processing/service.ts     — validate, run, report
      ↓
Tool processor          src/lib/processing/processors/*   — implements the contract
      ↓
PDF library             pdf-lib
      ↓
Result                  one document streamed back, or several bundled as a ZIP
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

**fflate for ZIP bundling.** Split PDF can produce many documents and browsers
cannot download a set of files from one response. fflate is ~8 kB with zero
dependencies and a synchronous API, so bundling stays a small delivery detail
rather than a new subsystem. Archives are *stored*, not deflated: the entries
are PDFs pdf-lib already compressed.

**pdfium (WebAssembly) for rasterising pages.** pdf-lib can rearrange pages but
cannot *draw* them, and Phase 5 needed genuine previews. The candidates were
weighed on licence, runtime and size: **mupdf** renders beautifully but is
AGPL-3.0, which is not acceptable for this product; **pdfjs-dist + a native
canvas** is ~35 MB and needs a platform-specific binary; **@hyzyla/pdfium** is
an MIT wrapper around Google's pdfium (BSD-3-Clause) shipped as WebAssembly —
no native binaries, no browser automation, runs anywhere Node runs. It was
verified in this environment before being adopted. It returns raw RGBA pixels,
which a ~120-line local PNG encoder turns into images using the zlib stream
fflate already provides, so no imaging dependency (sharp/canvas/jimp) was added.

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
   ├─ engines/                Conversion engine abstraction (Phases 67-69)
   │  ├─ types.ts             ConversionType, EngineDescriptor, EngineResult…
   │  ├─ errors.ts            EngineRoutingError (internal invariant only)
   │  ├─ registry.ts          One engine per conversion type, deterministic
   │  ├─ router.ts            selectEngine(type) — always the current engine
   │  ├─ processor.ts         Engine-backed ToolProcessor factory
   │  ├─ profile.ts           DocumentProfile (signature/full tiers, lazy)
   │  ├─ validation.ts        Structural OutputValidator (diagnostic only)
   │  ├─ quality.ts           QualityGate v1 (diagnostic-only verdicts)
   │  └─ adapters/current.ts  Thin adapters over the existing processors
   ├─ hardening/
   │  ├─ config.ts            Timeout/concurrency config (env, documented defaults)
   │  ├─ guards.ts            Numeric Content-Length gate + job slot counter
   │  └─ route.ts             Hardened handleProcessingRequest for every tool route
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

With ~44 entries this needs no index, no debounce and no network call, which is
why search feels instant and works without JavaScript-heavy machinery.

---

## 5a. Page-level infrastructure (Phase 3)

`src/lib/processing/pages.ts` is a tool-agnostic answer to "which pages does the
user mean?", and it is deliberately isomorphic — no `server-only`, no pdf-lib —
so the browser validates with exactly the code the server enforces.

- **Model:** `PageRange { start, end }`, `PageSelection { mode, ranges }`,
  `PageSelectionMode = "every-page" | "ranges"`.
- **Numbering:** 1-based and inclusive everywhere, because users think in page
  numbers. `toZeroBasedIndices()` is the *single* place that converts to the
  0-based indices pdf-lib wants, which keeps the off-by-one risk in one tested
  function.
- **Syntax:** `1-3, 5, 7-9`; commas, semicolons or newlines; whitespace ignored;
  a bare number is a single-page range.
- **Validation:** empty input, zero/negative pages, reversed ranges, missing
  endpoints, non-numeric tokens and pages beyond the document are all rejected
  with a user-safe message. Nothing is silently corrected.
- **Overlaps are rejected by default** (`allowOverlap` exists for future tools).
  For splitting, `1-5, 4-8` is far more likely to be a typo than a request to
  duplicate pages, and silently duplicating them would be a surprising result.
  Extract and Delete inherit the same rule, so the three page tools behave
  identically.
- **Complement (Phase 4):** `complementPages(ranges, pageCount)` returns the
  pages a selection does *not* cover — what Delete keeps. Unlike a selection,
  the complement is always in ascending document order, because surviving pages
  keep their original order. `complementPageRanges()` expresses the same result
  as ranges, and `pagesToRanges()` collapses consecutive pages.

Two other pieces of shared infrastructure landed with it:

- `pdf-document.ts` — one defensive wrapper around pdf-lib (`loadPdfDocument`,
  `readPageCount`, `readPageIndices`, `copyPagesInto`, `savePdfDocument`). Merge
  and Split both use it, so encrypted and lazily-failing documents are handled
  identically and only once.
- `inspect.ts` + `POST /api/documents/inspect` — the server-authoritative page
  count. The browser never derives a page count itself. Split, Extract and
  Delete all use this one endpoint.
- `file-names.ts` — one sanitiser (`baseDocumentName`, `derivedDocumentName`)
  shared by every processor, so no tool can leak a path into a file name.
- `processors/page-selection-input.ts` — the single parse → validate → map-to-
  error-code step for tools whose options are a raw `ranges` string.

### Multi-artifact processing

`ProcessingSuccess.artifacts` was already an array, so the contract needed only
two additions: an optional `bundleName`, and a `ProcessingContext` passed to
`process()` carrying the effective limits (so a processor can enforce
`maxOutputs` without reading the environment itself).

Delivery stays in the HTTP layer, where it belongs:

- exactly one artifact → streamed as-is (`application/pdf`) — Merge PDF is
  byte-for-byte unchanged;
- several artifacts → `createZipArchive()` bundles them (`application/zip`).

`X-PDFKit-Artifacts` reports how many documents were produced.

## 5b. Split PDF: how a request flows

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

### Split PDF specifics

1. **Inspect.** On upload the workspace posts the file to
   `/api/documents/inspect` and shows the real page count ("24 pages"), or an
   error — never a guess.
2. **Configure.** Mode radios; range mode validates as you type with
   `parseAndValidatePageRanges`, so obvious mistakes never reach the server.
3. **Process.** `POST /api/tools/split-pdf` with `mode` and `ranges`. The
   processor re-parses and re-validates everything against the real document.
4. **Guard.** `ranges.length > limits.maxOutputs` fails with `TOO_MANY_OUTPUTS`
   *before* a single output is generated — no partial results.
5. **Generate.** One new `PDFDocument` per range, pages copied in the requested
   order, each saved and named from the sanitised source name.
6. **Deliver.** One output → PDF; several → ZIP with sanitised entry names.

### Phase 4: Extract and Delete PDF Pages

Both are single-PDF, page-selection tools, and each was built with the four-step
recipe below — no new infrastructure, no new dependency, no new API shape.

| | Extract PDF Pages | Delete PDF Pages |
| --- | --- | --- |
| Selection means | pages to **keep** | pages to **remove** |
| Output order | exactly as typed (`8-10, 1-2` → 8,9,10,1,2) | ascending document order |
| Built from | the selection itself | `complementPages(selection, pageCount)` |
| Extra guard | — | `NO_PAGES_REMAIN` when nothing would survive |

They are deliberately *not* the same operation with a flag: Extract copies the
selection, Delete copies its complement, and a test asserts the two produce
opposite page sets from the same input.

The UI shares `page-selection-workspace.tsx` — upload, inspect, validate,
process, download — with each tool supplying wording, an optional extra
validation rule (Delete's "keep at least one page") and its own request
function. Neither imports pdf-lib.

## 5c. Page rasterisation (Phase 5)

`src/lib/thumbnails/` is a self-contained, reusable layer with the same shape as
the processing layer — and the same rule: the rest of the app must not know what
the rasterizer is.

```text
UI (PdfPageThumbnail)
   ↓  data URL
POST /api/documents/thumbnails      (thin route)
   ↓
thumbnails/service.ts               shared validation + limits
   ↓
thumbnails/renderer.ts              the ONLY pdfium-aware module
   ↓
pdfium (WASM) → RGBA pixels → thumbnails/png.ts → PNG
```

- **`types.ts`** — `PageThumbnail`, `PageThumbnailPayload`; no rasterizer detail.
- **`limits.ts`** — `PDFKIT_THUMBNAIL_MAX_PAGES` (60), `PDFKIT_THUMBNAIL_WIDTH`
  (220), `PDFKIT_THUMBNAIL_MAX_BYTES` (500 kB), each with a hard ceiling so a
  misconfigured environment cannot exhaust memory.
- **`png.ts`** — IHDR/IDAT/IEND, CRC32 and a zlib stream from fflate. Tested
  against an independent decoder, pixel for pixel.
- **`renderer.ts`** — one WASM instance per process, jobs serialised through a
  small queue, documents destroyed in a `finally`. pdfium's `width` option
  stretches pages, so the scale is computed from the real page size; a
  4× aspect-ratio cap stops a pathological page allocating a huge bitmap.

**Delivery:** thumbnails come back as `data:` URLs inside the JSON response.
That keeps them ephemeral — no temporary files, no object storage, no URL anyone
else could fetch, and nothing for the browser to revoke (unlike object URLs,
data URLs are collected with the React state that holds them). The cost is ~33%
base64 overhead, which is acceptable for 220px-wide previews.

**Reuse:** Split, Extract, Delete and any future page organiser can call the
same endpoint and render the same `PdfPageThumbnail` component; nothing about it
is Reorder-specific.

## 5d. Reorder PDF Pages (Phase 5)

Reorder asks a different question from the other page tools: not *which* pages,
but *in what order*. It therefore uses a **page order** rather than a page
selection — `PageOrder = number[]`, validated as a complete permutation of
`1..pageCount`: no missing pages, no duplicates, no extras, no out-of-range
values, and never silently repaired.

`movePageInOrder(order, from, to)` is a pure function in `pages.ts`, so the move
buttons, the drag gestures and the tests all exercise the same logic. The UI
holds the order in state and submits it **in full**; the server re-parses and
re-validates it against the real document before copying a single page.

Page identity is kept separate from position throughout: a card knows it is
page 5, and separately that it currently sits at position 2.

## 5e. Rotate PDF and visual page selection (Phase 6)

**Rotation model.** `pages.ts` gained a third page concept alongside selection
and order: `PageRotation` is `0 | 90 | 180 | 270` — a union, not a number, so an
impossible angle cannot be represented. `rotateClockwise`/`rotateCounterClockwise`
are pure cycle helpers used by every control, and `addRotations` composes two
angles. Validation rejects `45`, `-90`, `"90"`, `360`, `NaN` and decimals rather
than rounding them: silently turning 45° into 90° would be a guess about intent.

**Wire format.** `rotations={"1":90,"3":180}` — a JSON object parsed with
`JSON.parse` (never `eval`), then strictly checked: plain object only, integer
page keys only, numeric legal angles only. Omitted pages mean "unchanged", so a
client can send just what it altered.

**Additive semantics.** The processor adds the requested angle to the page's
existing `/Rotate` value, because that is what pressing "rotate" on a sideways
page means. Only that entry changes — no rasterising, no rebuilding — so the
output stays a real vector/text PDF with the same pages in the same order.

**Rotated previews.** Rather than re-saving the PDF and re-rendering it, the
rasterised bitmap is turned by `rotate-pixels.ts`: exact, no resampling, and
90°/270° swap width and height so the aspect ratio can never drift. The Phase 5
`render({ width })` stretching trap stays fixed because rotation happens after
scaling, and a test asserts the rotated area equals the original area.

**Preview caching.** The rotate workspace caches previews by `page:rotation`, so
turning a page back to an angle already seen costs nothing and a stale preview
is never shown. It is browser-side state only — no server cache, no storage.

**Selection announcements (Phase 10).** The picker's page buttons are real
buttons (`aria-pressed`, screen-reader labels, focus rings), so keyboard
operation works natively; because pressed-state changes alone are not reliably
spoken, the grid also mirrors the selection count into a polite live region
(deliberately without `role="status"` — the workspace owns that one for
processing and results). Tests cover the keyboard path and the announcements
for both input directions.

**Visual page selection.** Extract and Delete gained a page picker built from
the same `PdfPageThumbnail`, extracted into a shared `PagePreviewGrid`. It is an
*alternative editor for the existing range field*, not a second model: clicking
a page rewrites the range string, and typing in the field re-derives the
highlighted pages. Split shows the same grid read-only — turning ranges into
drag-selected regions would have meant a second selection model, which this
phase deliberately avoided. Above the preview limit, or when rendering fails,
all three fall back to the text field with an explanation rather than fake
images.

## 5f. Compress PDF (Phase 7)

**Two real passes, one honesty rule.** Compression is the first tool whose
result is a *measurement*, not just a document. The processor may produce up to
two candidates and returns the smallest of them and the original — a saving is
only ever reported when the returned bytes are strictly smaller. When nothing
helps, the untouched original bytes are returned and the interface says the PDF
is already well optimised (a neutral state, never "Saved 0 %").

**Lossless pass** (`lib/processing/optimize/lossless.ts`, every level): the
document is re-saved with PDF object streams and a compressed cross-reference
stream, XMP metadata and optional Info entries are removed, and at
`medium`/`high` every safe stream is re-deflated at maximum effort —
uncompressed streams become `/FlateDecode`, already-deflated streams are
re-deflated when strictly smaller. This is provably lossless: the deflated
representation is swapped for another deflated representation of the *same*
decompressed bytes, and a test decodes every stream before and after and
compares them. Streams are deliberately skipped when they use image codecs
(`/DCTDecode`, `/JPXDecode`, `/CCITTFaxDecode`, `/JBIG2Decode`), carry predictor
parameters, are cross-reference/object streams, or cannot be decoded — they
survive byte-for-byte rather than being risked.

**Aggressive pass** (`lib/processing/optimize/rasterize.ts`, `high` only): each
page is rendered by pdfium exactly as a reader displays it (page rotation
included, opaque white background) at ~110 DPI with bitmap guards (5000 px per
side, 12 MP per page), encoded with `jpeg-js` at quality 60 and rebuilt into a
fresh PDF of full-page JPEGs. This is lossy — image detail drops and text
becomes pixels — and the interface says so before the user chooses it. The pass
is only attempted when the document actually contains image XObjects (a text
page rasterises *larger*, so why try) and the page count is within
`PDFKIT_COMPRESS_MAX_RASTER_PAGES` (default 60, ceiling 300); both the skip and
a genuine failure are recorded (`rasterSkipped`, logged server-side without
document data) and the valid lossless result is returned instead.

**Dependency decision.** `jpeg-js@0.4.4` (BSD-3-Clause, zero dependencies,
~76 kB, pure JavaScript, no native binaries) was the only addition. Alternatives
were rejected: writing a JPEG encoder is out of scope, `sharp`/`jimp` pull large
native or multi-package dependencies, and WASM mozjpeg encoders are browser-first
with heavier APIs. One interop trap was found by the tests: jpeg-js returns Node
`Buffer`s that view a *pooled* ArrayBuffer, while pdf-lib's JPEG scanner reads
`.buffer` from offset 0 — so encoded bytes are copied into a fresh offset-0
array before embedding.

**Shared rasterising infrastructure.** The renderer exposes
`runWithPdfiumDocument(bytes, job)`, so compression queues through the same
single-instance WASM discipline as thumbnails instead of building a second
pdfium entry point.

**Level model and statistics** (`lib/processing/compression.ts`, browser-safe
like `pages.ts`): `low` = structural only, `medium` = structural + stream
re-compression (both lossless), `high` = medium + the aggressive pass. The
processor computes typed statistics (`originalBytes`, `outputBytes`,
`bytesSaved`, `reductionPercent`, `wasReduced`, `strategy`, `level`) with a pure
function, ships them in `meta`, the HTTP adapter forwards them as `X-PDFKit-*`
headers, and the browser reads the headers — the interface never measures or
guesses anything itself.

## 5g. Image ↔ PDF conversion (Phase 8)

**Three tools, one extension.** Images to PDF, PDF to JPG and PDF to PNG reuse
every existing layer — contract, service, registry, HTTP adapter, validation,
ZIP delivery, UploadZone, the AbortController client pattern and the catalog
guards. Nothing was duplicated; the additions are one input rule set, two
error codes, a content-check hook and a render API.

**Content validation without a second validator.** `ProcessorInputRules`
gained an optional `contentKind: "pdf" | "image"`. Unset means `pdf`, so every
Phase 2–7 tool validates exactly as before; `image` switches the shared
signature check to the JPEG (`FF D8 FF`) and PNG headers and raises the new
`INVALID_IMAGE` (422) for disguised files. The new `OUTPUT_TOO_LARGE` (413)
covers rendered outputs above the conversion byte cap.

**Images → PDF** (`processors/images-to-pdf.ts`, `lib/processing/images.ts`):
pixel dimensions are read straight from the headers — no decoding — and
rejected above 24 MP / 12 000 px per side *before* anything is embedded.
JPEG bytes are placed into the PDF untouched (`embedJpg`, no re-encode, no
quality loss); PNGs go through `embedPng`, which keeps the alpha channel as a
soft mask, over a white rectangle because a PDF page has no background of its
own. Each page matches its image at 96 DPI (uniformly capped at the PDF
14 400 pt limit), centred, full-bleed — never stretched or cropped.

**Full-page rendering API.** The renderer gained `renderEachPdfPage(bytes,
{dpi, maxPages}, handlePage)`: the conversion-grade counterpart of the
thumbnail path, sharing the same single-instance WASM discipline and
serialised queue while keeping deliberately separate limits. Exactly one
bitmap exists at a time — `handlePage` encodes and releases before the next
page renders — and the page-count rejection happens before a pixel is
allocated.

**PDF → JPG/PNG** (`processors/pdf-to-image.ts`): one shared processor class;
the format selects the encoder (jpeg-js quality 90 / the in-house RGBA PNG
encoder), the file names and the bundle name. One page returns a single
image; several pages return artifacts that the existing HTTP layer bundles
into a sanitised ZIP — the Split PDF delivery contract. The pooled-Node-Buffer
trap from Phase 7 is shared as `freshBytes` in `lib/processing/images.ts`,
used by the JPEG encoder path and the compress rasteriser.

## 5h. PDF metadata (Phase 11)

**Model first.** `lib/processing/metadata.ts` is a browser-safe module (like
`pages.ts`) that states the field split up front: title, author, subject,
keywords and creator are editable; producer and both dates are read-only
because pdf-lib re-stamps them on every save — accepting edits for them would
silently lose the user's input, so the interface says so instead. Length
budgets (2 000 chars per field, 50 keywords × 200 chars) live in the same
module and are enforced by the processor, never trusted from the browser.

**Reading reuses inspection.** The shared `inspectPdf` response gained a
`metadata` object — additive, so every existing consumer simply ignores it.
Absent Info entries are reported as `null`, never invented. One quirk is
handled explicitly: pdf-lib keeps Keywords as a single decoded string and its
array setter joins with spaces, so the readout splits on commas and the
processor writes the comma-joined string itself — the tool's own output
round-trips exactly, and a space-separated list from another producer reads
back as one keyword.

**Editing is Info-dictionary-only.** The processor writes the five supported
keys via `PDFHexString.fromText` and removes them with a dictionary delete when
a field arrives empty — removals are proven by re-reading the output in tests.
`getInfoDict` (the same accessor every pdf-lib metadata getter uses) creates
the dictionary for documents that have none. Pages, content and structure are
never touched; absent fields are left unchanged.

## 5i. Metadata removal (Phase 12)

**The privacy tool that verifies itself.** Remove Metadata reuses the Phase 11
model and readout, and deletes Title/Author/Subject/Keywords plus the XMP
stream. Two pdf-lib behaviours had to be understood and are handled
explicitly:

- **Orphaned objects still get serialised.** Dropping the catalog `/Metadata`
  reference alone leaves the XMP stream in the file as an unreferenced object
  whose private bytes are still written — unacceptable for a privacy tool. The
  processor therefore also deletes the object from the `PDFContext`, and a test
  asserts the XMP payload bytes are physically absent from the output.
- **`updateInfoDict` re-stamps on save.** Producer and ModificationDate are
  overwritten unconditionally; Creator is re-inserted (with pdf-lib's own
  string) only when the key is missing — so Creator is *emptied* rather than
  deleted, which keeps the library from re-adding its text while leaving no
  user data.

The job only succeeds after re-opening the produced bytes and confirming every
targeted field is gone or empty and the XMP reference is absent; the response
reports what was found (`X-PDFKit-Removed-Fields`, `-Xmp-Removed`,
`-Verification`) and the interface states plainly that the document is not
completely metadata-free.

## 5j. PDF to Word, text only (Phase 15)

The Phase 14 feasibility study concluded that full-fidelity Office conversion
is not viable inside this architecture (AGPL-licensed Python stacks; LibreOffice
needs child processes, temp files and sandbox isolation). What **is** honest
and safe is text extraction — and the building blocks already existed:
pdfium's `getText()` (exposed through a new `extractPdfPageTexts` in the
renderer, with the usual single-instance WASM discipline and page-count guard)
plus the MIT-licensed `docx` generator, the one new dependency.

The processor writes one paragraph per extracted line and a page break between
pages — no layout, image or table reconstruction, and every surface (catalog,
UI, docs, `X-PDFKit-Mode: text-only` header) states that.

**Text-quality audit (Phase 19).** Two behaviours were established with
probes. First, a *confirmed defect*: a PDF can carry raw control bytes inside
a `Tj` string, pdfium extracts them verbatim, and the `docx` generator writes
them raw into `word/document.xml` — an invalid Office file. Extracted lines
are therefore stripped of XML-invalid code points
(`stripXmlInvalidCharacters`); tabs and all readable text survive, and a
crafted-PDF regression test proves the output stays well-formed. Second, an
*unavoidable limitation*, now documented: pdfium merges text on the same
baseline left-to-right, so single-column wrapped text comes out as separate
lines (one paragraph each) while side-by-side columns on one baseline are
interleaved into a single line. Reordering by layout analysis would be
speculative reconstruction, which this tool deliberately does not do. Pages without
extractable text get an italic marker instead of silently vanishing; an
image-only PDF succeeds with `characters: 0` and the interface explains why.
The output is validated **in memory** as a real Office ZIP
(`[Content_Types].xml` + `word/document.xml`) before the job may succeed —
the same self-verifying pattern as metadata removal. Page limits are shared
with image export (`PDFKIT_CONVERSION_MAX_PAGES`).

## 5k. PNG to PDF (Phase 17)

The Images-to-PDF processor was generalised with a constructor config (tool
id, input rules, output name, optional `requireExactKind`) so PNG to PDF is
the *same* conversion core rather than a copy — the existing mixed-tool
instance and its behaviour are unchanged. The PNG tool differs in one
security-relevant way: `requireExactKind: "png"` makes the processor verify
each file's detected signature, so a JPEG renamed to `.png` is rejected with
`INVALID_IMAGE` instead of being silently embedded as a JPEG (the mixed tool
deliberately embeds by detected kind). The workspace side follows the same
principle: `ImagesToPdfWorkspace` accepts a `variant` (acceptance lists,
labels and the client call, defaulting to the mixed tool), and the PNG
workspace is a thin client-component wrapper — client-side because a variant
carries a function, which cannot cross the server/client boundary.

## 5l. Watermark (Phase 21)

The Phase 20 audit's recommendation, implemented with the primitives it
verified: pdf-lib `drawText` with `opacity` + `rotate` (and the shared
`rgb` grey), drawn directly onto existing pages — no rasterising, no page
rebuilding, so size, `/Rotate`, content and count are untouched and the
output stays a searchable PDF. The watermark is ordinary page content with an
alpha `ExtGState`; tests prove presence by decoding the produced content
streams and finding the hex text operators on exactly the selected pages.

The option model (`lib/processing/watermark.ts`, browser-safe like
`pages.ts`) is deliberately small and exact: text (trimmed, ≤ 200 chars),
opacity 25/50/75, rotation 0/45/-45, placement center / diagonal-tiled /
bottom-right corner, pages all/first/last. The server never repairs values —
anything outside the sets is `INVALID_WATERMARK_CONFIGURATION` (400).
Diagonal tiling covers a square the size of the page diagonal so every
rotation angle fully covers the page; corner placement anchors the rotated
text so its bounding box hugs the bottom-right. Two honest limits, stated in
the UI and docs: the standard-font watermark covers the standard Latin
character set only (pdf-lib's WinAnsi fonts; other characters are rejected
with a clear message), and a visible watermark is a **deterrent, not
protection**.

## 5m. Page Numbers (Phase 22)

The watermark pipeline's sibling, implemented on the same principle: vector
`drawText` on existing pages, no rasterising, no rebuilding. The option model
(`lib/processing/page-numbers.ts`, browser-safe) mirrors `watermark.ts`'s
exactness — position bottom-left/center/right, start 1-9999, font size 8-24,
format `1` / `Page 1` / `Page 1 of 10`, pages all/first/last; anything outside
the sets is `INVALID_PAGE_NUMBER_CONFIGURATION` (400), never repaired.

Two semantics are deliberate and tested: page **N** prints `start + N - 1`
(sequential across the document; first/last modes stamp only their page but
keep its sequential number), and `Page X of Y` always uses the document's
**real** page count — so a start above 1 is an explicit front-matter offset
that can print X above Y, stated in the workspace before conversion rather
than silently clamped. Presence is proven by decoding produced content
streams (hex text operators at the requested `Nn Tf` size).

## 5n. Crop PDF (Phase 24)

The Phase 23 audit's plan, implemented exactly: **CropBox only** via pdf-lib's
`setCropBox` — the visible window of a page changes and nothing else. The
MediaBox, content streams, page order, rotation, annotations, links and forms
are untouched (probes and tests verify each), and unselected pages keep their
original boxes. No rasterising, no page rebuilding, no new dependency.

The model (`lib/processing/crop.ts`, browser-safe) offers two modes with
PDF-native coordinates only: an absolute **rectangle** (points, bottom-left
origin, unrotated space) validated against **every** selected page's MediaBox
— one misfit rejects the whole request, naming the page — or **margins**
computed from each page's own MediaBox, so heterogeneous sizes crop correctly
per page. Validation **rejects, never clamps**: finite values only (pdf-lib
itself would accept Infinity and degenerate boxes), sides ≥ 10 pt, rectangle
fully inside the MediaBox, margins ≥ 0 leaving ≥ 10 pt. Geometry for all
selected pages is computed **before the first mutation** — no partial crops.

**The critical honesty rule, proven in tests and over HTTP:** cropping is
*not* redaction. Cropped-out content remains in the file and remains
recoverable — a processor test extracts the "hidden" text back from the output
with pdfium, and the E2E suite repeats the proof against the production
server. The workspace warns before converting and again in the success state;
the docs and catalog say the same. (The Phase 23 probes showed MediaBox
shrinking adds no security either, so the least destructive CropBox-only
choice is also the honest one.) The output uses the fixed name `crop.pdf`, so
hostile source filenames never travel into the response.

## 5o. Flatten PDF (Phase 26)

The Phase 25 audit's plan, implemented exactly: **vector flattening only**,
via pdf-lib's `PDFForm.flatten()` — field appearance streams are drawn into
the page content and the interactive fields are removed. Pages are never
rasterised or rebuilt as images, so flattened values remain selectable,
extractable text; links and other ordinary annotations survive; and page
count, order and rotation are untouched. No new dependency.

**Signed PDFs are rejected before any mutation** with a structured
`SIGNED_PDF` (422). Detection is belt-and-braces and runs first: pdf-lib's
typed field model (`PDFSignature`), the raw `/FT /Sig` entry on each field
dictionary, and the AcroForm `SigFlags` "signatures exist" bit. Flattening
rewrites the file and would invalidate a signature — refusing is the only
honest behaviour; a signature is never silently destroyed.

**The known pdf-lib 1.17.1 issue is handled explicitly.** `flatten()` empties
the AcroForm `/Fields` but leaves the deleted widget references dangling in
each page's `/Annots` array. A cleanup pass removes exactly the references
that no longer resolve to any object — annotations that still resolve (links,
notes) are preserved untouched, never blindly removed — then drops an
`/Annots` array left empty and the now-empty AcroForm dictionary. Documents
without any AcroForm pass through with zero flattened fields; `getForm()` is
never called on them, so no form structure is ever fabricated.

**Self-verification on every run:** the output is re-opened and checked —
page count, per-page MediaBox size (order) and rotation equal to the input,
no AcroForm remaining, and every remaining `/Annots` entry resolving. The
extractability of flattened values is proven with pdfium in the processor
tests and again over real HTTP in E2E.

**Honesty rules, stated everywhere the tool appears:** flattening is
irreversible (fields become permanent page content); document-level
JavaScript and OpenActions are **not** removed (a test pins that they
survive); and the tool is never presented as a security or sanitisation
feature. The number of flattened fields is measured server-side and reported
in `X-PDFKit-Flattened-Fields`. The output uses the fixed name
`flattened.pdf`, so hostile source filenames never travel into the response.

## 5p. Production hardening (Phase 28)

Wave 1 hardens the edge of every processing route without changing the
processing core. `src/lib/hardening/route.ts` exports the handler every
`/api/tools/*` route now calls; it wraps the unchanged HTTP adapter with
three guards, each cheap and deterministic:

1. **Numeric Content-Length gate** (`guards.ts`). A present-but-malformed
   `Content-Length` (non-decimal, negative, fractional, exponential, beyond
   the safe integer range) is a 400 before one byte of the body is parsed.
   A missing header is allowed — chunked uploads are legitimate, and the
   adapter's exact byte accounting still applies.
2. **Optional concurrency cap** — `PDFKIT_MAX_CONCURRENT_JOBS` (default `0`,
   no cap; ceiling 1024). A module-level slot counter (one Node process = one
   instance) admits or refuses; a refused request gets `503 SERVER_BUSY`
   immediately. There is no queue: this is not a multi-tenant SaaS.
3. **Request timeout** — `PDFKIT_REQUEST_TIMEOUT_MS` (default 120 s, ceiling
   600 s). The response race honours the budget with `504 REQUEST_TIMEOUT`,
   but the job is **not** aborted: pdfium WASM work cannot be cancelled
   mid-render and pdf-lib has no cancellation token, so an "aborted" claim
   would be a lie. The job finishes privately, its slot is released only
   when it actually ends (never when the timeout fires), and the watchdog
   timer is `unref`'d so it cannot pin the process.

`config.ts` reads both values per request so tests and deployments change
them without a rebuild. Routes keep `runtime = "nodejs"` and
`dynamic = "force-dynamic"` — nothing runs on the edge. The Guards/timeout
behaviour is unit-tested with a stubbed adapter (busy path, timeout path,
slot lifecycle, unexpected-throw path); every pre-existing route test passes
through the hardened handler unchanged, which pins the retrofit. A GitHub
Actions workflow (`ci.yml`) runs lint, typecheck, tests and a production
build on pushes and PRs to `main`.

## 5q. Password Protect (Phase 29)

pdf-lib deliberately cannot write encryption, so protecting for real needs a
second implementation: `@pdfsmaller/pdf-encrypt-lite` (~9 KB, built on
pdf-lib), which applies the classic **RC4 128-bit Standard Security Handler
(V2/R3)** — key derivation, `/O` and `/U` entries, `/Encrypt` dictionary and
RC4 stream/string encryption of every indirect object. That is the scheme
copied verbatim into the interface, the catalog, the route docblock and this
document. It is never called AES-256, "military-grade" or "zero-knowledge",
anywhere.

The processor (`processors/password-protect.ts`) opens the input with the
shared loader first — malformed files map to `INVALID_PDF`, and an
already-encrypted file is refused with a tool-specific `ENCRYPTED_PDF`
message instead of being silently re-encrypted. Password options are parsed
by a browser-safe module (`lib/processing/password-protect.ts`): 1–128
characters, used exactly as typed, never trimmed. Characters the legacy
handler cannot encode (PDFDocEncoding) surface as the library's
`PasswordEncodingError` and map to a 400 with clear Latin-character guidance.

Nothing is claimed that was not measured. Before the artifact is returned
the processor verifies the promise three ways (any mismatch fails the job):
the trailer's encryption dictionary reports RC4 128-bit (V2/R3); the bytes
refuse to open without a password (pdf-lib's default refusal); and the exact
password supplied reopens the document with every original page. Password
hygiene is structural and tested: the value never appears in logs (the
service logs tool/outcome/counts only), error messages/details, names, URLs
or headers — the route test iterates every response header asserting absence.

## 5r. Unlock PDF (Phase 30)

The inverse tool decrypts with `@pdfsmaller/pdf-decrypt-lite` (~8 KB): RC4
40-bit (V1/R2) and 128-bit (V2/R3) — the latter exactly matching what
Password Protect writes, so the protect → unlock round trip is a real test
over both HTTP routes. Only authentication happens: the supplied password is
checked against the `/O`/`/U` values; there is no guessing, no recovery. The
decryption strips `/Encrypt` from the trailer, and the processor proves the
result is an ordinary PDF by re-opening it without a password and counting
every page before the download exists.

The inspection step is where the honesty lives, because the decrypt library
communicates through exceptions:

- a readable unprotected document → `PDF_NOT_ENCRYPTED` — but only *after*
  the file genuinely parses (a damaged file that merely lacks `/Encrypt` is
  `INVALID_PDF`, not a false "nothing to remove");
- the reader's "Unsupported encryption" throw (AES-class, V≥4) →
  `UNSUPPORTED_ENCRYPTION`, with the supported schemes named in the message;
- "Incorrect password" → `WRONG_PASSWORD`, and the entry is never echoed;
- a damaged `/O`/`/U` dictionary → `INVALID_PDF`.

Files that open without a prompt yet carry owner restrictions (empty user
password) unlock with an empty entry — the workspace says so and a test
covers it. Known gaps, owned openly: RC4-40 is library-supported but not
fixture-tested, and the AES reject path is tested with a hand-declared V4/R4
dictionary (a valid PDF whose trailer declares AES-class parameters), not a
genuinely AES-encrypted fixture.

## 5s. Add Text (Phase 31)

The third edit-pipeline tool, built exactly on the watermark/page-numbers
pattern: a browser-safe options module (`lib/processing/add-text.ts`), a
thin route on the hardened handler, a server processor, and a workspace
reading options straight from the shared module. Scope is one honest text
box: up to 500 characters on 20 lines, nine anchor positions, four font
sizes (12/16/24/36 pt), and the all/first/last page choice.

The processor draws with pdf-lib's WinAnsi Helvetica — real vector text, no
rasterising — and the tests prove it by re-extracting the output text with
pdfium (added lines present, original content intact). Two failure modes are
handled the honest way: characters the standard font cannot encode become a
400 with clear guidance (never silent replacement), and oversized text is
scaled down to fit the page (width and height both bounded; the workspace
discloses the behaviour). The stamped-page count travels in
`X-PDFKit-Text-Pages`, parsed by the client into the result like the other
measured headers.

## 5t. Database Usage Metering & Plan Quotas (Phase 43)

**Provider-Neutral Persistence Abstraction (`src/lib/usage/`).**
The processing layer connects to usage metering through a provider-neutral abstraction (`UsageRepository` & `UsageService`) rather than depending directly on PostgreSQL or Prisma internals:

- `types.ts` — `UsageRecord`, `TierQuotaConfig`, `QuotaPreflightResult`, `UsageRepository`, `PersistedUserAccount`.
- `config.ts` — Centralized quota limits per tier (`anonymous`: 10 jobs/50MB, `free`: 50 jobs/250MB, `pro`: 500 jobs/2GB, `business`: 5000 jobs/20GB) with environment variable override support.
- `repository.ts` — `PrismaUsageRepository` (PostgreSQL + Prisma) for production with atomic `increment` updates, `InMemoryUsageRepository` for local development/tests, and `getUsageRepository()` resolver.
- `quota.ts` — Date period formatting ("YYYY-MM-DD" UTC), preflight quota check calculations, remaining job/byte budget evaluation, and profile summary snapshot.
- `service.ts` — Server-only high-level usage service (`evaluatePreflight`, `recordJobSuccess`, `getUserSummary`).

**Centralized Gate Integration.**
Quota preflight checks run in `src/lib/hardening/route.ts` right after Content-Length validation and identity resolution, *before* reading request bodies or acquiring concurrency slots. Requests exceeding job count or byte budgets are rejected with `429 QUOTA_EXCEEDED` without consuming quota or executing PDF operations. Successful jobs record usage metrics upon completion.

---

## 5u. Production Stripe Billing & Subscription Architecture (Phase 44)

**Provider-Isolated Stripe Billing Layer (`src/lib/billing/`).**
The Stripe integration is isolated behind a server-only service boundary (`BillingService`) to decouple checkout and webhook logic from application components and PDF processing routes:

- `types.ts` — `BillingConfig`, `CheckoutSessionOptions`, `CheckoutSessionResult`, `WebhookResult`.
- `config.ts` — Reads `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRO_PRICE_ID`. Safe fallback (`isConfigured: false`) when credentials are unset.
- `stripe.ts` — Lazy Stripe SDK client initializer (`getStripeClient()`).
- `service.ts` — High-level `BillingService`:
  - `createCheckoutSession`: Authenticates user, reuses or creates Stripe Customer ID (`UserAccount.stripeCustomerId`), generates Stripe Checkout session for `"pro"` plan.
  - `handleWebhookEvent`: Verifies Stripe webhook signature (`STRIPE_WEBHOOK_SECRET`), checks idempotency via `StripeWebhookEvent` model, and processes subscription lifecycle events (`checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`) to synchronize `UserAccount.tier` (`pro` vs `free`).

**Endpoints & Account UI Integration.**
- `POST /api/billing/checkout` — Authenticated checkout creation endpoint. Rejects unauthenticated users (401) and arbitrary price/tier requests (400).
- `POST /api/billing/webhook` — Webhook ingestion endpoint. Verifies raw body signature (400 on bad signature), executes idempotent account state sync.
- `/account` & `<UpgradeButton />` — Displays subscription status, PRO plan availability, and checkout redirect button while clearly reinforcing that PDF processing remains 100% available to anonymous and free users within daily quotas.

---

## 5v. Bulk Tools & Batch Processing (Phase 61)

**Client-orchestrated batches over the existing single-file endpoints.**
The `/bulk` section batches conversions — PDF → Word/Excel/Text/JPG/PNG,
Images → PDF (one PDF per image) and Extract Images — without any new
server-side processing surface. The browser's batch runner
(`src/lib/bulk/runner.ts`) sends **one file per request** to the existing
`/api/tools/<tool>` endpoint, sequentially, with ≥1.1 s between request
starts.

Why not a server-side batch endpoint (audit conclusion): the MVP holds every
document in memory, caps requests at 120 s, and delivers an all-or-nothing
result — a batch of N files would hold N inputs plus N outputs in RAM, could
not finish rasterisation within the request timeout, and could not report
per-file progress, cancellation or retry. Client orchestration gets all of
that for free while every existing guard (quota preflight + metering, IP
rate limit, concurrency cap, origin check, validation, sanitisation,
in-memory-only processing, cleanup) applies to each file exactly as before.
A bulk operation may only exist when its underlying single-file tool is
`AVAILABLE` (`src/lib/tools/bulk.test.ts` enforces it).

**Components.**

- `src/lib/tools/bulk.ts` — bulk operations catalog, tier ceilings and the
  `resolveBulkBatchCaps(tier, dailyJobLimit, dailyByteLimit)` derivation.
  Pure data, shared by server pages and the browser runner.
- `src/lib/bulk/runner.ts` — transport-only batch loop: pacing, 429/503
  backoff, abort, per-file statuses, quota stop, page/output/image budgets.
- `src/lib/bulk/zip.ts` — client-side "Download all" ZIP (fflate). Archive
  results are unpacked and flattened into one sanitised folder per source
  file; every entry name is re-sanitised (no paths, traversal or control
  characters), mirroring the server's `sanitizeZipEntryName`.
- `GET /api/usage` — the caller's daily quota snapshot (read-only, session
  identity with anonymous fallback, rate-limited) so the workspace can show
  "this batch needs X jobs / Y MB" before it starts.
- `src/components/bulk/bulk-workspace.tsx` — shared UX for all operations:
  multi-file drag & drop with count/total-size validation, live per-file
  status, cancel, retry of unfinished files, individual downloads and the
  batch ZIP.

**Batch limits and why.** Files per batch and upload bytes are
`min(tier ceiling, daily quota)`: anonymous 10 (its whole daily job quota),
free 50 (whole daily job quota), pro/business 100 (20%/2% of daily job quota,
where browser memory and session duration bind before the quota does).
Shared budgets: 200 rendered pages per batch (150 DPI JPEG ≈ 1 MB/page worst
case → ~200 MB of browser-held output), 200 MB of results per batch (all
outputs live in browser RAM while the ZIP is assembled; mobile browsers are
killed well before desktop limits), 400 extracted images per batch (2× the
per-file server cap). Budgets are checked *between* files, so the overshoot
is one file's output — bounded by the server's per-file caps. Concurrency is
one in-flight request per batch; the server-side
`PDFKIT_MAX_CONCURRENT_JOBS` is unchanged.

**Extract Images hardening (Phase 61).** The processor now counts image
XObjects on the selected pages *before* extracting anything and rejects
documents over `PDFKIT_EXTRACT_IMAGES_MAX_IMAGES` (default 200, ceiling
1000) with `TOO_MANY_OUTPUTS` — closing a pre-existing gap where a crafted
PDF with thousands of tiny embedded images could allocate unbounded
in-memory artifacts. The count is also reported via the
`X-PDFKit-Extracted-Images` header, which the bulk runner uses for the batch
image budget.

## 5w. Bulk Observability & Production Load Readiness (Phase 62)

**Same architecture, honest signals.** Phase 62 changed no architecture and
no limits; it made the Phase 61 batch system observable and load-safe.

- **Batch correlation** — every request in a batch carries
  `x-pdfkit-batch-id` (generated client-side as a UUID). `readBatchIdHeader`
  (`src/lib/processing/http.ts`) validates it against
  `^[a-zA-Z0-9][a-zA-Z0-9-]{7,63}$` and drops anything else; the value is
  attached to job logs (`batchId` field, with the caller's `tier`) for
  correlation only. It is **never** used for authorization, quota or any
  security decision — client values remain untrusted.
- **Honest Retry-After** — the rate limiter (`src/lib/hardening/
  distributed-protection.ts`) returns the real remaining seconds of its
  window (Redis path: the Lua script returns the key's TTL on reject;
  in-memory path: `resetAt - now`), clamped to 1–60 s. When the value is
  unknown, no header is sent — nothing is faked. The runner parses
  delay-seconds only (HTTP-date forms are deliberately not interpreted),
  clamps to ≤120 s, and falls back to a 60 s cooldown. Retry budgets
  (2 × rate-limit, 3 × busy, 1 × network per file) still bound every
  backoff, so no header value can stall or storm a batch.
- **Structured events** — `logStructuredEvent` in the existing logger emits
  `rate_limited` (with `retryAfterSeconds`), `quota_rejected` (`toolId`,
  `tier`, `reason`, `requestedBytes`) and `request_timeout` (`toolId`,
  `timeoutMs`). No second logging system; nothing logs document contents,
  tokens or secrets.
- **Error classification** — `src/lib/bulk/errors.ts` maps server error codes
  to twelve user-facing categories with `retryable` flags and retry hints.
  Permanent validation failures (invalid PDF, unsupported, too large, batch
  limit) are never auto-retried; transient ones (rate limited, busy, timeout,
  network, cancelled) are. Unknown codes map honestly to "unknown" without
  leaking internals.
- **Batch summary & CSV** — the workspace shows a completion summary
  (counts, bytes, elapsed, average, remaining quota) and exports an RFC 4180
  CSV (`src/lib/bulk/csv.ts`) with a formula-injection guard (leading `'` on
  `=+-@` cells) and a UTF-8 BOM. CSV carries metadata only — never document
  contents.
- **Honest progress** — `BulkBatchPhase` events (file-start, pacing, backoff,
  waiting-online, batch-stopped, batch-done) drive a live banner with
  whole-file counts and percentages. Intra-file progress is never invented.
  While offline the runner pauses before dispatching (2 s abortable polls)
  instead of burning failures. A `beforeunload` guard warns while running;
  nothing replayable is persisted, so a refresh cannot duplicate processing.
- **ZIP hardening** — `buildBatchEntries` caps archive results at 2,000
  entries per result and the batch at 25,000 total entries (archive-bomb
  defense-in-depth), and the entry sanitizer now preserves Unicode letters,
  numbers and marks (`\p{L}\p{N}\p{M}`) so CJK/Cyrillic/Greek filenames
  survive; path separators, control characters and traversal remain blocked,
  mirroring the server sanitizer exactly.
- **Bulk search** — `searchBulkOperations` (`src/lib/tools/search.ts`) makes
  the bulk section discoverable ("bulk pdf", "batch pdf to word", "multiple
  files") with the same AND-over-terms semantics as the tool search. The
  tool catalog itself is untouched and stays honest: `AVAILABLE` tools only.
- **Stop-reason honesty** — after a budget stop, remaining files are labelled
  `skipped-budget` (matching the first violator) rather than `cancelled`, so
  summary counts distinguish user cancels from budget skips.
- **Limit review** — `docs/bulk-limit-review.md` documents each limit, why it
  is conservative, the metric to observe, the threshold to raise and the
  condition to reduce. No limits were raised in Phase 62.
- **Load tests** — `src/lib/bulk/runner.load.test.ts` runs 12 deterministic
  simulated-fetch scenarios (10/50/100-file batches, mixed failures,
  sustained 429/503, cancellation, quota/page/output/image budget stops,
  large and many-small files, raster-heavy extraction) asserting
  single-flight concurrency, pacing, retry budgets, exact request counts,
  no duplicate submissions and ZIP validity.


## 5x. Production Observability, Telemetry & Load Validation (Phase 63)

**Measure the architecture before changing it.** Phase 63 changed no limits
and no processing behavior; it made the running system observable and
validated the current architecture under simulated multi-user load.

- **Typed telemetry pipeline** (`src/lib/monitoring/telemetry.ts` +
  `telemetry-events.ts`) — processing code emits typed metadata events
  (`job_started/completed/failed`, `quota_rejected`, `rate_limited`,
  `request_timeout`, `server_busy`, `http_response`). Events flow to two
  sinks: the existing structured logger (Phase 62 shapes preserved) and a
  bounded metrics provider. `job_started`/`http_response` are metrics-only
  to avoid doubling log volume. Recording never throws.
- **Provider-neutral metrics layer** (`src/lib/monitoring/metrics/`) — a
  `MetricsProvider` interface with a strictly bounded in-memory default:
  61-bucket minute ring, 25-bucket hour ring, 4,096-entry duration ring
  (p50/p95/p99 over the newest window), ≤128-key sanitized maps, monotonic
  counters. Raw events are never retained. Future PostgreSQL/Redis/Sentry
  providers implement the interface without touching processing code
  (`PDFKIT_METRICS_PROVIDER`; unknown values fail open with a warning).
- **Request correlation** — `handleProcessingRequest` generates a
  `req_<16hex>` id per request, returns it in `x-pdfkit-request-id`, and
  attaches it to timeout/job telemetry; job logs also gained a safe
  `errorCategory` field.
- **`GET /api/admin/metrics`** — the full snapshot (traffic, durations,
  errors by tool/code/category, statuses, bytes, quota rejections by tier,
  bulk aggregates, RSS/heap/Node version). **Fail closed**: 404 when
  `PDFKIT_ADMIN_METRICS_TOKEN` is unset; with it, constant-time token check
  (401 otherwise) plus a dedicated `admin-metrics` rate-limit scope.
- **`GET /api/health/ready`** — readiness distinct from liveness: pings the
  configured database (`DATABASE_URL`) and Redis when present, verifies the
  tool registry; verdict `ok`/`degraded` (200) or `unavailable` (503), 5 s
  cache, never leaks connection strings. `pingDatabase` uses an
  always-empty unique lookup because the bundled dev Prisma client is a
  generated no-op stub (`scripts/generate-prisma-client.js`) — production
  must run `prisma generate` (documented, not silently worked around).
- **Bulk lifecycle beacons** — the browser runner (client-orchestrated
  architecture unchanged) reports batch transitions through
  `POST /api/bulk/telemetry`: strict validation (known event/operation,
  batch-id allowlist, clamped counts, ≤2 KB), origin check, own rate-limit
  scope. Client values remain untrusted aggregates — never authorization,
  quota or security inputs. The runner accepts a caller-supplied `batchId`
  (validated) so beacons and per-file requests share one correlation id.
- **Multi-user load validation**
  (`src/lib/hardening/multi-user.load.test.ts`) — scenarios A–F: 10/25/50
  concurrent users (isolation, accounting, concurrency cap, bounded
  metrics), 5 concurrent bulk batches across different operations
  (41 files, no cross-batch contamination), shared-IP saturation (exact
  60/min behavior with honest Retry-After), tier independence
  (anonymous 10, free 50, pro 500, business 5000 metered separately), and
  the watchdog (honest 504, no slot leak, private completion still
  counted). All run the REAL route handlers, processors, quota metering
  (in-memory repository) and limiter. Measured results and bottlenecks:
  `docs/load-validation-results.md`; observability design and dashboard
  spec: `docs/production-observability.md`. No production capacity claims.
- **Bulk limits pinned by tests**
  (`src/lib/bulk/bulk-limits.validation.test.ts`) — every current limit
  (files/batch, upload bytes, 200 pages, 200 MB output, 400 images,
  25 MB/file, 100 MB/request, 1.1 s pacing, 120 s timeout, 60/min) is
  asserted from the enforcing code, so an accidental change breaks loudly.
  `docs/bulk-limit-review.md` gained explicit failure signals per limit;
  limits remain unchanged until production telemetry is collected.

## 5y. Staging Infrastructure Validation (Phase 64)

**Prove the shared-state architecture, then stop touching it.** Phase 64
changed no limits and no processing behavior; it made the existing
PostgreSQL/Redis architecture real, testable and fail-closed:

- **Real Prisma client, no engine binaries** — the client now generates with
  `engineType = "client"` (WASM query compiler) and runs on the pure-JS
  `@prisma/adapter-pg` driver adapter. The development stub client is
  unambiguously marked (`PrismaClient.PDFKIT_STUB`), never overwrites a real
  generated client, and the repository **refuses to start** if `DATABASE_URL`
  is configured while only the stub is bundled — a deployment can no longer
  silently run a no-op database.
- **Migration repair (genuinely required)** — the email-verification flow and
  `PersistedUserAccount` reference five `UserAccount` columns the initial
  migration never created; the stub's hand-written types masked the mismatch.
  Migration `20260909000000_add_account_verification_fields` adds them
  (additive only). Anonymous usage also now ensures its parent `UserAccount`
  row (`DailyUsage_userId_fkey`) — previously anonymous metering crashed on
  real PostgreSQL while the in-memory repository masked it.
- **Fail-closed shared protections** — `PDFKIT_REDIS_REQUIRED=true` declares
  Redis mandatory: unavailable Redis → visible 503 responses and 503
  readiness, never a silent per-process downgrade that would multiply the
  rate limit and concurrency cap by the instance count. A cold ioredis
  connection bug (first command bypassing the global budget) was found by the
  real-Redis tests and fixed with a bounded readiness wait.
- **Validated against real infrastructure in-sandbox** — embedded PostgreSQL
  16 (npm binaries) + Redis 7.2.5 + two production `next start` instances:
  21/21 multi-instance harness checks, 19/19 integration tests, 1616 unit
  tests, all gates. The full evidence matrix, security review and honest
  limitations: `docs/distributed-infrastructure-validation.md`; operational
  guide: `docs/staging-deployment.md`.

---

## 5z. Conversion engine abstraction (Phases 67-69)

An **additive abstraction layer** between the processing registry and the
conversion implementations PDFKit already ships. It introduces **no second
engine, no retry, no fallback, no OCR and no quality-based rejection** —
each of those is a later, separately approved stage.

```text
API route → hardening → runProcessingJob
    → ToolProcessor (processing registry entry)
        → ConversionRouter (src/lib/engines/router.ts)
        → EngineRegistry (src/lib/engines/registry.ts)
        → current engine adapter (src/lib/engines/adapters/current.ts)
        → the existing processor implementation (unchanged)
```

### Stage 1 (Phase 67): the abstraction skeleton

- `src/lib/engines/types.ts` — `ConversionType` (the eleven conversion
  tools: pdf-to-word/excel/text/jpg/png, extract-images, extract-tables,
  images-to-pdf, png-to-pdf, compress-pdf, compare-documents),
  `EngineDescriptor`, `EngineRequest`, `EngineResult`, `EngineFailure`
  (typed for later stages, never constructed) and the `ConversionEngine`
  interface.
- `src/lib/engines/registry.ts` — exactly one engine per conversion type
  (duplicate ids and duplicate primary registrations throw at import
  time), deterministic ordering, engines marked unavailable are never
  routed to.
- `src/lib/engines/adapters/current.ts` — thin adapters that delegate
  straight to the existing processors. No conversion logic is duplicated;
  input rules are borrowed from the underlying processor so request
  validation is identical.
- `src/lib/engines/router.ts` — `selectEngine(conversionType)` returns the
  one registered engine. Routing takes **only** the conversion type as
  input: document profiles, tier, bulk mode, engine health and quality
  requirements are PLANNED future inputs and cannot influence routing.
  Unknown types throw `EngineRoutingError` (an internal invariant) rather
  than guessing.
- `src/lib/engines/processor.ts` — `createEngineProcessor()` produces the
  engine-backed `ToolProcessor` entries that the processing registry maps
  the eleven conversion tools to.

### Stage 2 (Phase 68): DocumentProfile + OutputValidator

Two diagnostic foundations. Neither changes engine selection, conversion
behaviour, API contracts or user-visible output.

**DocumentProfile** (`src/lib/engines/profile.ts`) — a versioned
(`profileVersion: 1`), privacy-safe description of an input document:
counts, ratios and flags only; never text content, names, titles or
metadata. Two tiers, deliberately:

- *Signature tier* (`describeInputFile`) — documentKind by real byte
  signature (pdf/jpeg/png/unknown), fileSizeBytes, client-reported MIME.
  One scan of the first KiB, no parsing. This is the only tier the live
  conversion path uses: adapters attach it to `EngineResult.profile`.
- *Full tier* (`buildDocumentProfile`) — diagnostic infrastructure that is
  **not** invoked by the conversion request path, because every conversion
  already parses its input exactly once and an upfront profile would
  duplicate that work. Computes (FACT): pageCount, encrypted,
  textPageCount, emptyTextPageCount, textCharacterCount, textYieldRatio
  (textPageCount/pageCount), imageObjectCount, imageBearingPageCount
  (structural pdf-lib walk, capped at 200 pages; pdfium text pass capped
  at 200 pages) — and (HEURISTIC) likelyScannedPageCount /
  likelyScannedRatio: pages with **no extractable text AND at least one
  image object**. Absent text alone never counts as "scanned" (blank,
  vector-only and malformed pages exist); no OCR exists. `analysisState`
  says how far the analysis got (`signature-only` / `complete` /
  `encrypted-input` / `unreadable-input` / `text-limited`) — absent fields
  mean *unknown*, never false. `createLazyDocumentProfile` memoizes the
  full tier for future consumers; nothing resolves it in Stage 2.

**OutputValidator** (`src/lib/engines/validation.ts`) — structural
validation of produced artifacts, diagnostic only.
`validateEngineResult` runs after every successful engine execution and
records its verdict on `EngineResult.validation` — it never throws, never
fails a job and never reaches the user; the Stage 3 QualityGate (PLANNED)
will decide what to do with the verdict.

| Output class | Structural checks                              |
| ------------ | ----------------------------------------------- |
| PDF          | `%PDF-` signature, `%%EOF` trailer              |
| DOCX         | ZIP central directory, required Office parts    |
| XLSX         | ZIP central directory, required Office parts    |
| ZIP          | ZIP central directory, non-empty entry list    |
| PNG          | signature, IHDR-first, chunk walk reaches IEND  |
| JPEG         | SOI signature, EOI marker                       |
| text/*       | non-empty bytes                                 |
| unknown      | non-empty + name sanity → `not-evaluated`       |

All checks read in-memory bytes and never decompress, re-render or
re-parse documents — a full output re-parse through pdfium/pdf-lib is a
deliberate deferral. The ZIP check reads the central directory (entry
names only), which cannot be made to allocate decompressed data.

**What Stage 2 does NOT do:** no quality scoring or quality-based
rejection (text-yield, layout, table, font, image or OCR fidelity are
Stage 3 QualityGate — PLANNED), no retry, no fallback, no second engine,
no OCR, no routing input from profiles, no bulk changes. The existing
tool-local validators (pdf-to-word's throwing DOCX check, unlock-pdf's
re-open verification, password-protect's encryption verification) remain
the authoritative, behavior-defining checks and were not weakened or
moved.

### Stage 3 (Phase 69): QualityGate v1

A conservative, conversion-aware, **diagnostic-only** quality assessment
(`src/lib/engines/quality.ts`) that runs after the OutputValidator on every
successful engine execution and records its verdict on
`EngineResult.quality`.

```text
Engine → OutputValidator (structural) → QualityGate (quality) → verdict
```

- **States**: `healthy` (available signals consistent with a good
  conversion) · `suspicious` (technically valid, but a measurable signal
  indicates quality may be poor or incomplete — NOT a failure) ·
  `insufficient` (too little evidence for a meaningful determination — also
  NOT a failure) · `not-evaluated` (no policy for the type).
- **Score**: 0–100 weighted index (share of evaluated weight that passed).
  It is a heuristic index, NOT a fidelity percentage, and scores from
  different `qualityVersion`s are not comparable. `qualityVersion: 1`.
- **Checks**: structured `{ id, state, weight, reason }` entries — ids like
  `output-structurally-valid`, `source-text-availability`,
  `output-content-volume`, `output-page-coverage`, `image-content-volume`,
  `table-content-volume`; reasons are short and contain counts only.
- **Conversion-specific policies**: text conversions judge source/output
  text signals (a scanned source yields an honest `suspicious`, never a
  failure — no OCR exists); raster conversions judge structure and page
  coverage only (text-free sources are never penalized); extract-images
  treats zero images as a low-weight diagnostic and accepts zero when the
  source provably has no image objects; excel/tables are deliberately
  conservative (sparse and image-only documents are legitimate);
  compress-pdf judges structure only (size change is NOT a quality signal);
  compare-documents invents no semantic score (its fidelity check is
  immaterial, weight 0).
- **Signals are free**: the gate consumes only what the request already
  produced — the signature-tier profile, the Stage 2 validation verdict,
  the processor's own meta (character/row/image/page counts), artifact
  facts and one derived boolean (marker-only text output, computed where
  the content already lives, never retained). No re-parsing, no
  decompression, no rendering; a full `DocumentProfile` is used only when a
  caller genuinely has one. Unavailable signals are recorded as
  `not-evaluated` — unknown beats false precision.
- **Privacy**: assessments contain a typed state, a numeric score, check
  ids, non-sensitive reasons and a version — never document content, names
  or metadata values (enforced by test).

**Stage 3 does not select another engine. Stage 3 does not reject
successful output. Stage 3 does not retry conversion. Stage 3 does not
implement fallback.** The verdict is recorded for the future retry/fallback
stage to consume explicitly.

### Behavioural guarantees

Enforced by `src/lib/engines/equivalence.test.ts` and friends:

- Router → current engine behaves exactly like the previous direct
  processor call: the same request object, the same success shape, and
  failures propagate as the original `ProcessingError` instances (no
  catching, wrapping or classification anywhere in the layer).
- The only observable difference is two additive `meta` keys on success —
  `engineId` and `attempt` — type-compatible additions to the free-form
  meta record. The HTTP layer surfaces meta only through explicitly
  mapped `x-pdfkit-*` response headers; nothing maps these two keys and
  no UI renders them, so the API contract is unchanged.
- Zero new dependencies; everything runs in-process, in memory, with no
  child processes, no temp files and no logging.

### PLANNED (documented only — not implemented, not activated)

- A second engine for any conversion type, selected by benchmarks run
  before any replacement decision. The factual readiness matrix and the
  benchmark design that must precede any engine selection:
  `docs/stage4-readiness.md` (Phase 70 audit artifact); the Phase 71
  candidate audit, licensing gates and benchmark foundation:
  `docs/engine-candidates.md` + `docs/benchmark-plan.md`
  (`src/lib/benchmarks/` — benchmark-only, isolated from production by
  test); the Phase 72 controlled execution evidence and per-conversion
  CONDITIONAL GO / NO-GO / NOT APPLICABLE decisions:
  `docs/benchmark-results-phase72.md` (+ machine-readable
  `docs/benchmark-results-phase72.json`). Phase 72 did NOT implement any
  second engine — Stage 4 approval is still required.
- Retry and fallback (`EngineFailure` classification, engine chains),
  consuming QualityGate verdicts and engine health explicitly.
- Enforcing quality thresholds (QualityGate v1 is diagnostic-only; any
  rejection/switching semantics are a separate, approved decision).
- Document profiling in the request path and richer, typed routing
  inputs.
- Per-tool engine configuration (`PDFKIT_ENGINE_<CONVERSION>=a,b,c`) with
  a kill switch that restores the current engine.

---

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

1. implement a `ToolProcessor` under `src/lib/processing/processors/`
   (reusing `pages.ts` for page selection and `pdf-document.ts` for pdf-lib);
2. register it in `registry.ts` and add its input rules to `rules.ts`;
3. add a ~15-line route handler that calls the hardened
   `handleProcessingRequest` (`src/lib/hardening/route.ts`, keeping
   `runtime = "nodejs"` and `dynamic = "force-dynamic"`), with a `readOptions`
   callback if the tool takes options;
4. add a workspace component, map it in `components/tools/workspaces`, and flip
   the catalog status to `AVAILABLE`.

Split PDF was built exactly this way, and Extract and Delete PDF Pages then
reused the result without touching the contract, the HTTP adapter or the service
— only a processor, a rules entry, a route and a workspace each.

Validation, limits, error shaping, logging and response headers are shared, so
no component, hook or page needs restructuring.

---

### Memory and future scaling

Processing is still entirely in memory, which is why the size, count and output
limits exist — together they bound what one request can allocate. Buffers are
released in a `finally` block after every job and after every inspection.

This design has a ceiling: very large documents, or many concurrent jobs, will
eventually need streaming to temporary storage and a worker/queue architecture
so requests do not hold a whole document set in RAM. That is deliberately **not**
built yet; the limits keep the current approach honest until it is needed.

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
- **Output limits.** A job may not produce more than `PDFKIT_MAX_SPLIT_OUTPUTS`
  documents, checked before generation so a long PDF cannot be used to force
  large amounts of work.
- **Safe file names.** Output names come from one shared sanitiser
  (`file-names.ts`), and ZIP entry names are additionally stripped of
  directories, traversal (`../`), drive letters and control characters, then
  de-duplicated.
- **No empty documents.** Delete PDF Pages refuses to produce a zero-page PDF;
  the check runs before any page is copied.
- **Rotation is validated server-side.** Angles and page numbers are re-checked
  against the real document before anything is written, and an invalid request
  produces no output document at all.
- **Rasterisation is bounded.** Page count, render width and per-image bytes are
  all capped, with hard ceilings above the configurable values; a 4× aspect
  ratio cap bounds the bitmap for unusual page shapes. Rendering happens in
  memory only — no temporary files, so there is no cleanup path to get wrong and
  nothing under `public/`.
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
- **Server tests** run in the Node environment and exercise the real processors
  with real PDFs built by pdf-lib, plus the route handlers through their exported
  `POST`/`GET` functions. Split PDF tests build documents whose page widths encode
  the page number, so page identity and ordering can be asserted after copying.
- **ZIP responses are opened in tests**, every PDF inside is parsed, and its page
  count and page identity are checked — an HTTP 200 is never treated as proof.
- **Page identity, not just page counts.** Fixtures encode the page number in
  the page width, so tests prove that page 3 really is page 3 after extracting,
  deleting, splitting or reordering. A document with the right number of wrong
  pages fails.
- **Thumbnail identity by pixels.** A fixture gives every page a distinct solid
  colour; thumbnail tests decode the returned PNG and check the centre pixel, so
  "three images were returned" can never pass for "the right three pages".
- **Honesty guard:** a test fails if a tool is marked available without a
  registered processor, or a processor exists without an available catalog entry
  — the rule is enforced, not just documented.
- `next/link` and `next/navigation` are mocked in `vitest.setup.ts` so component
  tests run without the Next.js runtime.
