# PDFKit

**Your documents. Processed simply.**

PDFKit is a fast, privacy-conscious web application for everyday PDF and
document work — organising pages, converting formats, editing, securing, and
later OCR and AI document intelligence.

> ## Current status: Phase 2 — first working tool
>
> **[Merge PDF](http://localhost:3000/tools/merge-pdf) genuinely works**: upload
> two or more PDFs, arrange them, and the server returns a real merged document.
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
Security, OCR and AI — of which **1 (Merge PDF) is implemented** today.

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
| PDF engine         | **pdf-lib**                                   | Pure TypeScript, no native binaries or system dependencies, runs in the Node runtime and handles document merging (`copyPages`) reliably. Nothing already in the project could parse or write PDFs. |
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

## Processing limits

Configurable through the environment, with safe defaults:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PDFKIT_MAX_FILES_PER_JOB` | `20` | Files accepted in one request |
| `PDFKIT_MAX_UPLOAD_SIZE` | `26214400` (25 MB) | Maximum size of one file |
| `PDFKIT_MAX_TOTAL_UPLOAD_SIZE` | `104857600` (100 MB) | Maximum combined size |

Limits are enforced by the server on every request. The numbers shown in the
interface come from the build-time configuration, so rebuild after changing
them if you want the hints to match exactly.

## What is deliberately not implemented

Split, compress, rotate, delete/reorder/extract pages, JPG↔PDF, PDF↔Office,
editing, security tools, OCR, AI, authentication, cloud storage, databases,
payments, API keys, a public developer API, background workers and job queues
are **not** implemented. There is no simulated processing anywhere: no fake
progress bars, no fake results, no fake downloads. Only Merge PDF is real.

---

## Project structure

```text
src/
├─ app/                      # Routes (App Router)
│  ├─ page.tsx               # Homepage
│  ├─ api/tools/merge-pdf/   # Merge PDF endpoint (thin route handler)
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

`.env` files are git-ignored (`.env.example` is the only tracked one). Secrets
for future phases must be server-only — never prefixed with `NEXT_PUBLIC_`.

---

## Testing

```bash
npm test                # run once
npm run test:watch      # watch mode
npm run test:coverage   # with coverage
```

Covered today (15 files, 123 tests):

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

Phase 2 stops here on purpose. The planned order (see also `/roadmap`):

1. **Phase 3 — more organise tools:** split, extract, delete and reorder pages
   on the same processing foundation, with page previews.
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
