# PDFKit

**Your documents. Processed simply.**

PDFKit is a fast, privacy-conscious web application for everyday PDF and
document work — organising pages, converting formats, editing, securing, and
later OCR and AI document intelligence.

> ## Current status: Phase 1 — foundation and product shell
>
> **No document processing is implemented yet.** The catalog, the interface and
> the tool pages exist, but no tool merges, splits, compresses, converts or reads
> a document. Every tool is honestly marked **Coming soon**, and upload areas on
> tool pages are deliberately disabled. Nothing in this application uploads a
> file anywhere.

---

## Table of contents

- [What PDFKit is](#what-pdfkit-is)
- [Technology stack](#technology-stack)
- [Getting started](#getting-started)
- [Available scripts](#available-scripts)
- [What is implemented today](#what-is-implemented-today)
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

The catalog currently describes **42 planned tools** in six categories:
Organize, Convert, Edit, Security, OCR and AI.

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
| Tests              | **Vitest** + **Testing Library** + jsdom      | Fast, Vite-native, and tests behaviour through accessible roles rather than implementation details. |
| Linting            | **ESLint** with `eslint-config-next`          | Catches React, hooks and Next.js issues, including accessibility rules. |

No database, no backend service, no queue and no cloud infrastructure are used
in this phase, because nothing in Phase 1 needs them.

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

## What is deliberately not implemented

Merge, split, compress, rotate, delete/reorder/extract pages, JPG↔PDF,
PDF↔Office, editing, security tools, OCR, AI, authentication, cloud storage,
databases, payments, API keys, a developer API, background workers and job
queues are **not** implemented. There is no simulated processing anywhere: no
fake progress bars, no fake results, no fake downloads.

---

## Project structure

```text
src/
├─ app/                      # Routes (App Router)
│  ├─ page.tsx               # Homepage
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
│  └─ theme/                 # ThemeProvider
└─ lib/
   ├─ tools/                 # Tool catalog, categories, search (source of truth)
   ├─ upload/                # Pure file validation rules
   ├─ processing/            # Future processing CONTRACT only — no implementation
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
| `NEXT_PUBLIC_SITE_URL`      | Absolute URL used for metadata and sitemap |
| `NEXT_PUBLIC_CONTACT_EMAIL` | Optional public contact address            |

`.env` files are git-ignored (`.env.example` is the only tracked one). Secrets
for future phases must be server-only — never prefixed with `NEXT_PUBLIC_`.

---

## Testing

```bash
npm test                # run once
npm run test:watch      # watch mode
npm run test:coverage   # with coverage
```

Covered today:

- **Catalog integrity** — unique ids, valid categories, route derivation, and a
  guard test asserting no tool claims to be available while no processing exists
- **Search** — name/description/category/keyword matching, ranking, multi-term
  queries, empty and no-result cases
- **Navigation** — desktop links, mobile menu open/close, Escape handling
- **Theme switching** — default to system, switching, persistence, focus return
- **Tool cards and status badges** — status communicated as text, correct links
- **UploadZone** — empty, selected, error and disabled states, validation limits
- **Pure helpers** — file validation and formatting

---

## Future phases

Phase 1 stops here on purpose. The planned order (see also `/roadmap`):

1. **Phase 2 — first real processing:** a server-side processing layer behind an
   API route, one tool end to end, real progress/result/error handling and a
   temporary file lifecycle.
2. More organise and convert tools.
3. Editing and security tools.
4. OCR.
5. AI document intelligence.
6. Accounts, cloud storage, billing and a developer API.

A tool's status changes to `AVAILABLE` only when its processing genuinely works.

---

## Documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) — structure, decisions, design system,
  tool catalog and the processing boundary
