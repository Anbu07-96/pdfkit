# PDFKit

**Your documents. Processed simply.**

PDFKit is a fast, privacy-conscious web application for everyday PDF and
document work — organising pages, converting formats, editing, securing, and
later OCR and AI document intelligence.

> ## Current status: Phase 4 — page tools
>
> **Four tools genuinely work:**
>
> - **Merge PDF** — combine several PDFs in the order you choose.
> - **Split PDF** — split every page into its own file, or split by page ranges;
>   several outputs are delivered as a ZIP.
> - **Extract PDF Pages** — keep only the pages you list, in the order you list them.
> - **Delete PDF Pages** — remove the pages you list and keep the rest.
>
> **Every other tool is still unimplemented** and honestly marked
> **Coming soon**, with its upload area disabled. There is no simulated
> processing anywhere in this codebase.

---

## Table of contents

- [What PDFKit is](#what-pdfkit-is)
- [Technology stack](#technology-stack)
- [Getting started](#getting-started)
- [Available scripts](#available-scripts)
- [What is implemented today](#what-is-implemented-today)
- [Merge PDF](#merge-pdf)
- [Split PDF](#split-pdf)
- [Extract and Delete PDF Pages](#extract-and-delete-pdf-pages)
- [Page ranges](#page-ranges)
- [Processing limits](#processing-limits)
- [What is deliberately not implemented](#what-is-deliberately-not-implemented)
- [Project structure](#project-structure)
- [Environment variables](#environment-variables)
- [Testing](#testing)
- [Future phases](#future-phases)
- [Documentation](#documentation)

---

## What PDFKit is

A single web app for common document tasks, built around three product rules:

1. **Honesty** — a tool is only marked available when it genuinely works.
2. **Privacy** — no accounts, tracking or analytics are required to use the
   basic tools; documents are not retained beyond what an operation needs.
3. **Speed and reach** — a light interface that works from 320px phones to large
   desktop screens, keyboard-accessible throughout.

The catalog describes **42 tools** in six categories — Organize, Convert, Edit,
Security, OCR and AI — of which **4 are implemented** today: Merge PDF, Split
PDF, Extract PDF Pages and Delete PDF Pages.

---

## Technology stack

| Concern            | Choice                                        | Why |
| ------------------ | --------------------------------------------- | --- |
| Framework          | **Next.js 16** (App Router, Turbopack)        | Server components keep the catalog and pages static and fast; route handlers give a natural home for the future processing API without adding a separate service. |
| Language           | **TypeScript** (strict)                       | The tool catalog, statuses and file constraints are typed, so the interface cannot invent a tool or a status that does not exist. |
| UI library         | **React 19**                                  | Required by Next.js; server components by default, client components only where interaction demands it. |
| Styling            | **Tailwind CSS v4**                           | Design tokens live in CSS variables and are consumed as utilities — no runtime CSS-in-JS, no extra JavaScript for styling. |
| Components         | Local design system in `src/components/ui`    | A small, owned set of primitives instead of a heavy third-party kit; no dependency risk and full control over accessibility. |
| Icons              | **lucide-react**                              | Tree-shakeable SVG icon set; icons are decorative and always paired with text. |
| Class utilities    | **clsx** + **tailwind-merge**                 | Tiny helpers for conditional and conflict-free class names. |
| Fonts              | **geist** (self-hosted via `next/font/local`) | No requests to third-party font CDNs, which fits the privacy goal and avoids a render-blocking external dependency. |
| PDF engine         | **pdf-lib**                                   | Pure TypeScript, no native binaries or system dependencies, runs in the Node runtime and handles page copying (`copyPages`) reliably for both merging and splitting. |
| ZIP bundling       | **fflate**                                    | ~8 kB, zero dependencies, synchronous API; needed to deliver the several PDFs a split produces as one download. |
| Server guard       | **server-only**                               | Makes `next build` fail if a client component ever imports the processing layer. |
| Tests              | **Vitest** + **Testing Library** + jsdom      | Fast, Vite-native, and tests behaviour through accessible roles rather than implementation details. |
| Linting            | **ESLint** with `eslint-config-next`          | Catches React, hooks and Next.js issues, including accessibility rules. |

No database, no queue, no object storage and no cloud infrastructure are used:
merging happens inside the Next.js server process, in memory, for the duration
of a single request.

---

## Getting started

Requirements: **Node.js 20.9+** (developed on Node 22) and npm.

```bash
git clone https://github.com/Anbu07-96/pdfkit.git
cd pdfkit
npm install
cp .env.example .env.local   # optional: all values have sensible defaults
npm run dev
```

Open <http://localhost:3000>.

Production build:

```bash
npm run build
npm start
```

---

## Available scripts

| Command                 | What it does                                      |
| ----------------------- | ------------------------------------------------- |
| `npm run dev`           | Start the development server (Turbopack)          |
| `npm run build`         | Production build, including type checking         |
| `npm start`             | Serve the production build                        |
| `npm run lint`          | ESLint over the whole project                     |
| `npm run lint:fix`      | ESLint with autofix                               |
| `npm run typecheck`     | `tsc --noEmit`                                    |
| `npm test`              | Run the test suite once                           |
| `npm run test:watch`    | Run tests in watch mode                           |
| `npm run test:coverage` | Run tests with a coverage report                  |

> `npm run typecheck` relies on the route types Next.js generates, so run
> `npm run build` (or `npm run dev`) at least once first.

---

## What is implemented today

**Extract and Delete PDF Pages (real, end to end)**

- Server-authoritative page count, then live validation of the page selection
- Extract keeps the selected pages **in the order selected** (`8-10, 1-2` works)
- Delete removes the selected pages and keeps the rest in document order
- Deleting every page is blocked in the browser and rejected by the server
- One real PDF per request, downloaded directly

**Split PDF (real, end to end)**

- Server-authoritative page count shown after upload (never guessed in the browser)
- Two modes: split every page, or split by page ranges (`1-3, 4-6, 7-10`)
- Live range validation using the same module the server enforces
- One PDF is downloaded directly; several arrive as a ZIP
- Configurable output limit, checked before anything is generated

**Page-level infrastructure** (`src/lib/processing/pages.ts`)

- `PageRange`, `PageSelection`, `PageSelectionMode` — 1-based and inclusive
- Parser, validator and the single 0-based conversion point for pdf-lib
- Isomorphic, so Extract / Delete / Reorder Pages can reuse it unchanged

**Merge PDF (real, end to end)**

- Multiple-PDF selection with drag and drop or browse
- Accessible reordering (move up / move down) — the order sent to the server is
  the order you see
- File removal, per-file and total size feedback
- Server-side merge with `pdf-lib` behind `POST /api/tools/merge-pdf`
- Real result: the merged PDF is streamed back and downloaded
- Cancel, error and empty states — no fake progress bars

**Processing foundation** (`src/lib/processing`)

- `contract.ts` — the boundary every tool implements
- `registry.ts` — the authoritative list of implemented tools
- `service.ts` — validate → process → structured result, with safe logging
- `http.ts` — multipart parsing, request-size protection, response headers
- `errors.ts` — typed error codes mapped to HTTP statuses
- `limits.ts` — configurable limits with documented defaults
- `validation/pdf-input.ts` — counts, sizes, extensions and **PDF signature**
  checks that do not trust the browser

**Foundation**

- Next.js App Router project with strict TypeScript and path aliases (`@/*`)
- Tailwind CSS v4 design tokens, ESLint, Vitest, `.env.example`

**Design system** (`src/components/ui`)

- Tokens for colour, typography, spacing, radius and elevation in light and dark
- `Button`, `ButtonLink`, `IconButton`, `Card`, `Badge`, `Input`, `SearchInput`,
  `Dialog`, `Dropdown`, `Tooltip`, `Toast`, `FaqList`, `SectionHeader`,
  `EmptyState`, `ErrorState`, `LoadingState`, `Skeleton`
- Live reference at [`/styleguide`](http://localhost:3000/styleguide)

**Application shell**

- Sticky header with desktop navigation, accessible mobile menu, theme control
- Skip link, semantic landmarks, footer with product/resources/legal groups

**Homepage** — hero with search, popular tools, categories, privacy section,
why PDFKit, FAQ, footer.

**Tool architecture**

- One central catalog (`src/lib/tools`) with 42 tools and 6 categories
- Status model `AVAILABLE | COMING_SOON | PRO | DISABLED` (everything is
  `COMING_SOON` today, enforced by a test)
- Client-side search over name, description, category and keywords
- `/tools`, `/tools/[toolId]` and `/categories/[categoryId]` pages generated
  from the catalog, plus a reusable tool page template

**Upload interface**

- Reusable `UploadZone` with empty, hover, drag-over, selected, error and
  disabled states, file validation, size formatting and removal — selection
  only, wired to nothing

**Themes** — light, dark and system, persisted in `localStorage`, applied before
first paint to avoid a flash.

**Quality** — responsive from 320px, keyboard accessible, visible focus, loading
/ empty / error states, 66 automated tests.

---

## Merge PDF

**In the interface:** open `/tools/merge-pdf`, add at least two PDFs, drag or use
the arrow buttons to order them, then press **Merge PDFs** and download the
result.

**Through the API:**

```bash
curl -X POST http://localhost:3000/api/tools/merge-pdf \
  -F "files=@cover.pdf;type=application/pdf" \
  -F "files=@chapter-1.pdf;type=application/pdf" \
  -o merged.pdf
```

The `files` fields are merged in the order they are sent. Success returns
`application/pdf` with `Content-Disposition: attachment; filename="merged.pdf"`.
Failures return JSON:

```json
{ "error": { "code": "INVALID_PDF", "message": "Some files are not valid PDF documents.",
             "details": ["invoice.pdf does not contain a PDF file signature."] } }
```

| Code | HTTP | When |
| --- | --- | --- |
| `VALIDATION_ERROR` | 400 | Missing files, fewer than two files, non-multipart request |
| `UNSUPPORTED_FILE` | 415 | Extension or MIME type is not a PDF |
| `FILE_TOO_LARGE` | 413 | A single file exceeds the per-file limit |
| `TOO_MANY_FILES` | 413 | More files than the configured maximum |
| `TOTAL_SIZE_EXCEEDED` | 413 | Combined upload exceeds the total limit |
| `INVALID_PDF` | 422 | Content is not a readable PDF (signature or structure) |
| `ENCRYPTED_PDF` | 422 | The document is password protected |
| `PROCESSING_ERROR` / `INTERNAL_ERROR` | 500 | Unexpected failure (no details leak) |

**How files are handled:** documents are read into memory, merged and returned in
the same request. Nothing is written to disk, nothing is stored, and only
counts, byte totals and durations are logged — never file names or contents.

## Split PDF

**In the interface:** open `/tools/split-pdf`, upload a PDF (its real page count
appears), pick a mode, and download the result.

**Through the API:**

```bash
# Every page becomes its own PDF (returned as a ZIP)
curl -X POST http://localhost:3000/api/tools/split-pdf \
  -F "files=@document.pdf;type=application/pdf" \
  -F "mode=every-page" \
  -o document-split.zip

# One PDF per range, in the order given
curl -X POST http://localhost:3000/api/tools/split-pdf \
  -F "files=@document.pdf;type=application/pdf" \
  -F "mode=ranges" -F "ranges=1-3, 4-7, 8-10" \
  -o document-split.zip
```

| Field | Required | Meaning |
| --- | --- | --- |
| `files` | yes | Exactly one PDF |
| `mode` | yes | `every-page` or `ranges` |
| `ranges` | for `ranges` mode | e.g. `1-3, 4-6, 7-10` |

**Output naming:** `document-1.pdf`, `document-2.pdf`, … for every-page mode;
`document-part-1.pdf`, … for ranges. A single output is returned as
`application/pdf`; several are bundled into `document-split.zip`
(`application/zip`). Responses carry `X-PDFKit-Artifacts` and `X-PDFKit-Pages`.

**Page count:** `POST /api/documents/inspect` with one `files` entry returns
`{ "fileName": "report.pdf", "size": 248113, "pageCount": 24 }`. The interface
uses it so the page count always comes from the server.

Additional error codes: `INVALID_SPLIT_CONFIGURATION` (400),
`INVALID_PAGE_RANGE` (400), `PAGE_OUT_OF_RANGE` (400), `OVERLAPPING_RANGES`
(400), `TOO_MANY_OUTPUTS` (413).

## Extract and Delete PDF Pages

Both take one PDF and a page selection; both return one real PDF.

```bash
# Keep pages 1-3, 5 and 8-10, in that order
curl -X POST http://localhost:3000/api/tools/extract-pdf-pages \
  -F "files=@document.pdf;type=application/pdf" \
  -F "ranges=1-3, 5, 8-10" \
  -o document-extracted.pdf

# Remove pages 2, 4 and 7; everything else survives in its original order
curl -X POST http://localhost:3000/api/tools/delete-pdf-pages \
  -F "files=@document.pdf;type=application/pdf" \
  -F "ranges=2, 4, 7" \
  -o document-pages-removed.pdf
```

| | Extract PDF Pages | Delete PDF Pages |
| --- | --- | --- |
| `ranges` means | pages to **keep** | pages to **remove** |
| Output order | the order you typed | original document order |
| Output name | `document-extracted.pdf` | `document-pages-removed.pdf` |
| Extra rule | — | at least one page must remain (`NO_PAGES_REMAIN`, 400) |

Responses are `application/pdf` with `X-PDFKit-Pages` (input) and
`X-PDFKit-Output-Pages` (result), `no-store` and `nosniff`.

> The two tools were previously catalogued as `extract-pages` and
> `delete-pages`; those URLs now redirect to the new ones.

## Page ranges

Ranges are **1-based and inclusive**: `1-3` means pages 1, 2 and 3. Separate
them with commas, semicolons or line breaks; a bare number is a single page. The
same module runs in the browser and on the server for Split, Extract and Delete,
so their rules and messages are identical.

```text
1            → page 1
1-3          → pages 1, 2, 3
1-3, 5, 7-9  → three separate outputs
```

Rejected (never silently corrected): `0`, `-1`, `3-1`, `1-`, `abc`, and any page
beyond the end of the document. **Overlapping or duplicated ranges are rejected**
— `1-5, 4-8` is far more likely to be a typo than a request to duplicate pages.
The same module runs in the browser and on the server, so the messages match.

## Processing limits

Configurable through the environment, with safe defaults:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PDFKIT_MAX_FILES_PER_JOB` | `20` | Files accepted in one request |
| `PDFKIT_MAX_UPLOAD_SIZE` | `26214400` (25 MB) | Maximum size of one file |
| `PDFKIT_MAX_TOTAL_UPLOAD_SIZE` | `104857600` (100 MB) | Maximum combined size |
| `PDFKIT_MAX_SPLIT_OUTPUTS` | `50` | Documents one job may produce |

Limits are enforced by the server on every request. The numbers shown in the
interface come from the build-time configuration, so rebuild after changing
them if you want the hints to match exactly.

## What is deliberately not implemented

Compress, rotate and reorder pages, JPG↔PDF, PDF↔Office, editing, security
tools, page thumbnails, OCR, AI, authentication, cloud storage, databases,
payments, API keys, a public developer API, background workers and job queues
are **not** implemented. There is no simulated processing anywhere: no fake
progress bars, no fake results, no fake downloads. Only Merge PDF, Split PDF,
Extract PDF Pages and Delete PDF Pages are real.

---

## Project structure

```text
src/
├─ app/                      # Routes (App Router)
│  ├─ page.tsx               # Homepage
│  ├─ api/tools/merge-pdf/   # Merge PDF endpoint (thin route handler)
│  ├─ api/tools/split-pdf/   # Split PDF endpoint (thin route handler)
│  ├─ api/tools/extract-pdf-pages/  # Extract endpoint (thin route handler)
│  ├─ api/tools/delete-pdf-pages/   # Delete endpoint (thin route handler)
│  ├─ api/documents/inspect/ # Page count for page-level tools
│  ├─ tools/                 # Catalog + dynamic tool pages
│  ├─ categories/            # Category pages
│  ├─ styleguide/            # Internal design-system reference
│  ├─ pricing|help|faq|…     # Content pages
│  ├─ sitemap.ts, robots.ts  # SEO
│  └─ layout.tsx, error.tsx, loading.tsx, not-found.tsx
├─ components/
│  ├─ ui/                    # Design system primitives
│  ├─ layout/                # Header, nav, footer, breadcrumbs, container
│  ├─ home/                  # Homepage sections
│  ├─ tools/                 # Tool cards, search, tool page shell
│  ├─ upload/                # UploadZone, FileCard
│  ├─ tools/workspaces/      # Interactive tool UIs (Merge PDF)
│  └─ theme/                 # ThemeProvider
└─ lib/
   ├─ tools/                 # Tool catalog, categories, search (source of truth)
   ├─ upload/                # Pure client-side file validation rules
   ├─ processing/            # Contract, registry, service, HTTP adapter, limits,
   │                         # errors, validation and processors (server only)
   ├─ config/                # Site and navigation config
   ├─ utils/                 # Formatting and class helpers
   └─ theme.ts               # Theme store and pre-paint script
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the reasoning behind this layout.

---

## Environment variables

Copy `.env.example` to `.env.local`. Every value is optional in Phase 1.

| Variable                    | Purpose                                    |
| --------------------------- | ------------------------------------------ |
| `NEXT_PUBLIC_SITE_URL`          | Absolute URL used for metadata and sitemap |
| `NEXT_PUBLIC_CONTACT_EMAIL`     | Optional public contact address            |
| `PDFKIT_MAX_FILES_PER_JOB`      | Files per processing request (default 20)  |
| `PDFKIT_MAX_UPLOAD_SIZE`        | Bytes per file (default 25 MB)             |
| `PDFKIT_MAX_TOTAL_UPLOAD_SIZE`  | Bytes per request (default 100 MB)         |
| `PDFKIT_MAX_SPLIT_OUTPUTS`      | Documents one job may produce (default 50) |

`.env` files are git-ignored (`.env.example` is the only tracked one). Secrets
for future phases must be server-only — never prefixed with `NEXT_PUBLIC_`.

---

## Testing

```bash
npm test                # run once
npm run test:watch      # watch mode
npm run test:coverage   # with coverage
```

Covered today (26 files, 314 tests):

- **Page complement** — the pages that survive a deletion, in document order
- **Extract processor** — single page, ranges, multiple ranges, selection order,
  all pages, invalid/out-of-range/overlapping input, malformed and encrypted PDFs
- **Delete processor** — first/last/middle/non-contiguous removals, all-but-one,
  the zero-page guard, and proof that Delete is the complement of Extract
- **Extract and Delete APIs** — real PDFs parsed back and page identity checked

- **Page selection** — range parser, validation, overlap and boundary rules, and
  the 1-based → 0-based conversion
- **Split processor** — every-page and range modes against real PDFs, page
  identity and order, output limits, malformed and encrypted documents
- **ZIP bundling** — archive contents, path-traversal safety, name collisions
- **Split API** — ZIPs are extracted and every PDF inside is parsed and checked
- **Inspect API** — real page counts, invalid documents rejected
- **Merge processor** — real PDFs built with pdf-lib are merged, page counts and
  order verified, malformed and password-protected documents rejected
- **API route** — success response and headers, ordering, and every validation
  failure (too few files, wrong type, disguised non-PDF, oversized, too many,
  non-multipart, wrong method), plus a check that no internals leak
- **Server validation** — PDF signature detection and every limit
- **Processing service and registry** — catalog/registry parity, limit
  configuration, buffer release after a job
- **Merge workspace** — ordering, removal, request payload order, success and
  download, server errors, network failure, reset
- **Catalog integrity** — unique ids, valid categories, route derivation, and a
  guard test asserting only implemented tools are marked available
- **Search** — name/description/category/keyword matching, ranking, multi-term
  queries, empty and no-result cases
- **Navigation** — desktop links, mobile menu open/close, Escape handling
- **Theme switching** — default to system, switching, persistence, focus return
- **Tool cards and status badges** — status communicated as text, correct links
- **UploadZone** — empty, selected, error and disabled states, validation limits
- **Pure helpers** — file validation and formatting

---

## Future phases

Phase 4 stops here on purpose. The planned order (see also `/roadmap`):

1. **Phase 5 — reorder pages and page previews:** Reorder Pages on the same
   foundation, plus page thumbnails and a visual page picker.
2. Convert tools (images ↔ PDF, Office ↔ PDF).
3. Editing and security tools.
4. OCR.
5. AI document intelligence.
6. Accounts, cloud storage, billing and a public developer API.

A tool's status changes to `AVAILABLE` only when its processing genuinely works.

---

## Documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) — structure, decisions, design system,
  tool catalog and the processing boundary
