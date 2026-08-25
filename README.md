# PDFKit

**Your documents. Processed simply.**

PDFKit is a fast, privacy-conscious web application for everyday PDF and
document work — organising pages, converting formats, editing, securing, and
later OCR and AI document intelligence.

> ## Current status: Phase 44 — Production Stripe Billing & Subscription Architecture
>
> **Twenty-nine tools genuinely work:**
>
> - **Merge PDF** — combine several PDFs in the order you choose.
> - **Split PDF** — split every page into its own file, or split by page ranges;
>   several outputs are delivered as a ZIP.
> - **Extract PDF Pages** — keep only the pages you list, in the order you list them.
> - **Delete PDF Pages** — remove the pages you list and keep the rest.
> - **Reorder PDF Pages** — real page previews, drag or keyboard reordering.
> - **Organize PDF** — reorder, rotate and delete pages in a single visual workflow.
> - **Rotate PDF** — turn individual pages or the whole document, with previews
>   that update to match.
> - **Compress PDF** — real size reduction with honest before/after numbers;
>   lossless optimisation, plus an aggressive image-heavy mode.
> - **Images to PDF** — JPG/JPEG/PNG images become one PDF, one page per image,
>   in your order (JPEG data is embedded untouched).
> - **PNG to PDF** — the same pipeline in PNG-only form: transparency is
>   preserved as a soft mask, and non-PNG payloads are rejected by signature.
> - **PDF to JPG / PDF to PNG** — every page rendered by pdfium at 150 DPI;
>   one image for single pages, a ZIP per document otherwise.
> - **Edit PDF Metadata** — see the real document properties, edit title,
>   author, subject, keywords and creator, or clear them; Producer and dates
>   are shown read-only because pdf-lib re-stamps them on every save.
> - **Remove Metadata** — delete title, author, subject, keywords, creator and
>   the XMP stream, verified by re-reading the output; the honest limits
>   (creator emptied, producer/timestamps re-stamped) are stated in the tool.
> - **PDF to Word** — text-only extraction into a real .docx (one paragraph per
>   line, page breaks preserved). The tool says plainly that formatting,
>   images, tables and exact layout are **not** preserved.
> - **Watermark** — real vector text stamps (opacity, angle, placement, page
>   choice) without rasterising pages. Stated plainly: a visible watermark is
>   a deterrent, not protection.
> - **Page Numbers** — sequential numbers as visible text (position, start,
>   size, format, page choice). `Page X of Y` always reports the real page
>   count; a start above 1 is a front-matter offset.
> - **Crop** — set the visible area of selected pages by rectangle or margins
>   (points, bottom-left origin). CropBox only: size, rotation and content are
>   untouched, and the tool says plainly that cropping **is not redaction** —
>   cropped-out content stays in the file and remains recoverable.
> - **Flatten PDF** — turn interactive form fields into permanent page content
>   with vector flattening (pdf-lib's `PDFForm.flatten()`); pages are never
>   rasterised, so values stay selectable and links keep working. Signed PDFs
>   are rejected before any change (flattening would invalidate the
>   signature), and the tool says plainly that **document scripts are NOT
>   removed** and that **flattening is irreversible**.
> - **Password Protect** — real RC4 128-bit encryption (PDF Standard Security
>   Handler V2/R3): opening the document genuinely requires the password.
>   Verified, not just claimed — and honestly labelled: it is **not** AES-256.
>   The password is used in memory for the request only and is never logged.
> - **Unlock PDF** — remove a password you already have from an RC4-protected
>   PDF (40-bit and 128-bit; the output is verified to open without any
>   password). AES-protected files are refused honestly, and a wrong password
>   is reported without ever being echoed. Not password recovery — the
>   supplied password is only authenticated.
> - **Add Text** — add a multi-line text box as real, searchable vector text
>   (nine anchor positions, four font sizes, all/first/last pages) without
>   rasterising pages. Oversized text is scaled down to fit — stated plainly.
> - **Add Shapes** — add vector rectangles, circles, ellipses, and lines with
>   custom stroke width, stroke color, and fill color, strictly constrained to page boundaries.
> - **Add Images** — insert JPG or PNG logos, photos, or stamps into a PDF page.
> - **Highlight** — add visual semi-transparent color overlays to mark areas (not redaction).
> - **Draw** — draw freehand vector strokes and shapes directly on PDF pages.
> - **Annotations** — embed native PDF sticky note comments (/Text) and URI hyperlinks (/Link).
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
- [Reorder PDF Pages](#reorder-pdf-pages)
- [Rotate PDF](#rotate-pdf)
- [Compress PDF](#compress-pdf)
- [Images to PDF](#images-to-pdf)
- [PDF to JPG and PDF to PNG](#pdf-to-jpg-and-pdf-to-png)
- [Password Protect](#password-protect)
- [Unlock PDF](#unlock-pdf)
- [Add Text](#add-text)
- [Page previews](#page-previews)
- [Page ranges](#page-ranges)
- [Processing limits](#processing-limits)
- [Production hardening](#production-hardening)
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

The catalog describes **44 tools** in six categories — Organize, Convert, Edit,
Security, OCR and AI — of which **27 are implemented** today: Merge PDF, Split
PDF, Extract PDF Pages, Delete PDF Pages, Reorder PDF Pages, Rotate PDF,
Compress PDF, Images to PDF, PNG to PDF, PDF to JPG, PDF to PNG, PDF to Word,
Edit PDF Metadata, Remove Metadata, Watermark, Add Text, Page Numbers, Crop,
Flatten PDF, Password Protect and Unlock PDF.

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
| ZIP bundling       | **fflate**                                    | ~8 kB, zero dependencies, synchronous API; needed to deliver the several PDFs a split produces as one download. It also provides the zlib stream for the PNG encoder. |
| Page rasteriser    | **@hyzyla/pdfium** (WebAssembly)              | MIT wrapper around Google's pdfium (BSD-3-Clause). Renders real page previews with no native binaries and no browser automation. mupdf was rejected (AGPL-3.0); pdfjs-dist + a native canvas was heavier and platform-specific. |
| JPEG encoder       | **jpeg-js**                                   | BSD-3-Clause, ~76 kB, zero dependencies, pure JavaScript. Encodes the page bitmaps of the aggressive compression pass; verified in this environment before adoption. |
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

**PDF to Word (real, end to end, text only)**

- Every page's text is extracted with the existing pdfium rasteriser and
  written into a real .docx — one paragraph per line, a page break between
  pages, pages without text marked as such
- The tool is honest everywhere: catalog, interface and docs all say text
  only — formatting, images, tables and exact layout are not preserved, and
  there is no fake reconstruction
- The server reports what it measured (`X-PDFKit-Characters`, `-Paragraphs`,
  `-Mode: text-only`); an image-only PDF honestly reports zero characters
- Page limit shared with image export (`PDFKIT_CONVERSION_MAX_PAGES`); the
  output is validated in memory as a real Office ZIP before it is returned

**Remove Metadata (real, end to end)**

- Deletes Title, Author, Subject, Keywords and the XMP metadata stream; the
  XMP object is removed from the file itself, so its bytes are physically gone
  (verified, not just unreferenced)
- The removal is **verified by re-reading the output** before it is returned —
  a failed verification fails the job, it never returns a "clean" file that is
  not clean
- Honest limits, stated in the tool: the Creator field is emptied rather than
  deleted (pdf-lib re-inserts its own text when the key is missing), and the
  Producer string and modification timestamp are rewritten on save — the
  result is never claimed to be completely metadata-free
- Pages, order, dimensions and content are untouched

**Edit PDF Metadata (real, end to end)**

- The server reads the document's Info dictionary; absent entries are reported
  as `null`, never invented
- Title, Author, Subject, Keywords and Creator are editable; an empty field
  **removes** the entry, a missing field leaves it unchanged
- Producer and both dates are displayed read-only — pdf-lib re-stamps them on
  every save, so editing them would silently be lost (stated in the interface)
- Keywords are stored comma-separated and read back as a list; pages and
  content are never touched, and removals are proven by re-reading the output

**Password Protect (real, end to end)**

- Real RC4 128-bit encryption (PDF Standard Security Handler V2/R3) via
  `@pdfsmaller/pdf-encrypt-lite`; the interface and docs say exactly that and
  never claim AES-256, "military-grade" or "zero-knowledge"
- The output is verified three ways before it is returned: it declares RC4
  128-bit, it refuses to open without a password, and the password given
  reopens it with every page intact
- Already-encrypted PDFs are refused with a clear message; characters the
  legacy security handler cannot encode are rejected, never silently dropped
- The password travels once as a multipart field, lives in memory for the
  request only, and never appears in logs, URLs, file names, headers or error
  bodies (a test proves the absence)

**Unlock PDF (real, end to end)**

- Real decryption via `@pdfsmaller/pdf-decrypt-lite` (RC4 40-bit V1/R2 and
  128-bit V2/R3 — the latter is exactly what Password Protect writes, and the
  protect → unlock round trip is tested end to end over both real routes)
- The `/Encrypt` dictionary is stripped: the output is verified to open with
  no password before the download exists, with every page intact
- Honest refusals with dedicated codes: unprotected input
  (`PDF_NOT_ENCRYPTED`), wrong password (`WRONG_PASSWORD`, never echoed),
  AES-class files (`UNSUPPORTED_ENCRYPTION`) — it is not password recovery
- Files that open without a prompt yet carry owner restrictions can be
  unlocked with an empty entry, and the workspace says so

**Add Text (real, end to end)**

- Real vector text drawn with pdf-lib's standard Latin font — pages are never
  rasterised, so the output stays a real, searchable PDF (proven in tests by
  re-extracting the text with pdfium)
- One text box per request: multi-line (up to 20 lines / 500 characters), nine
  anchor positions, four font sizes, and all/first/last page choice
- Text that would overflow the page is scaled down to fit instead of being
  silently clipped; characters the font cannot encode are rejected with a
  clear message, never replaced
- The stamped-page count is measured on the server and reported in
  `X-PDFKit-Text-Pages`

**Images to PDF (real, end to end)**

- JPG, JPEG and PNG, mixed freely; each image becomes exactly one page, in your
  order — the server re-validates every signature
- JPEG data is embedded **untouched** (no re-encoding, no quality loss); PNG
  transparency is preserved as a soft mask over a white page background
- Pages match each image's aspect ratio at 96 DPI — never stretched, never
  cropped; oversized pixel dimensions are rejected before any allocation

**PDF to JPG / PDF to PNG (real, end to end)**

- Every page is rendered by pdfium at the configured DPI (default 150),
  in display orientation and exact aspect ratio
- One page → a single image; several pages → a ZIP with `name-page-N.jpg|png`
- JPG uses jpeg-js at quality 90; PNG uses the in-house lossless RGBA encoder
- Page count, render resolution and output size are limited and configurable

**Compress PDF (real, end to end)**

- Three real levels: `low` and `medium` are **lossless** (structure and stream
  optimisation); `high` additionally rasterises pages when that genuinely helps
- The server reports the real before/after byte sizes, savings and percentage —
  never an estimate
- If nothing can shrink the file, the original PDF is returned and the interface
  says so instead of claiming a saving

**Rotate PDF (real, end to end)**

- Rotate any page left or right, or every page at once, then reset
- Previews are re-rendered by the server, so what you see is what is saved
- Rotation is **additive** to any rotation the page already has
- Only `/Rotate` changes: the output stays a real vector/text PDF

**Visual page selection**

- Extract and Delete show a page picker that stays in sync with the range field
  in both directions — the range string remains the single source of truth
- Split shows the same previews as read-only context, keeping its range workflow
- Pages can be toggled with the keyboard alone, and selection changes are
  announced politely to screen readers (`aria-pressed` plus a live count)
- Documents above the preview limit fall back to the text field, and say so

**Reorder PDF Pages (real, end to end)**

- Real server-rendered previews of every page (not placeholders)
- Drag a page to a new position, or use the arrow buttons — both work with a
  keyboard, and moves are announced to screen readers
- The complete page order is submitted explicitly; the server re-validates that
  it is a full permutation before touching the document

**Page previews (reusable)**

- `POST /api/documents/thumbnails` renders pages with pdfium (WebAssembly)
- Returned as `data:` URLs inside the JSON response: nothing is written to disk,
  nothing is cached, and no URL exists that anyone else could fetch
- Configurable page count, width and per-image byte cap

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

- One central catalog (`src/lib/tools`) with 44 tools and 6 categories
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
| `ENCRYPTED_PDF` | 422 | The document already has a password (Password Protect refuses to re-encrypt) |
| `PDF_NOT_ENCRYPTED` | 422 | Unlock PDF was given a document with no protection to remove |
| `WRONG_PASSWORD` | 422 | The supplied password does not authenticate (and is never echoed) |
| `UNSUPPORTED_ENCRYPTION` | 422 | AES-class encryption (V≥4); Unlock PDF supports RC4 only |
| `INVALID_TEXT_CONFIGURATION` | 400 | Add Text options fail validation (empty/oversized text, unknown option) |
| `SERVER_BUSY` | 503 | The optional concurrency cap is reached — retry shortly (no queue) |
| `REQUEST_TIMEOUT` | 504 | The request exceeded the configured time budget |
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

## Reorder PDF Pages

Upload one PDF, see a preview of every page, rearrange them, download the result.

```bash
# Reverse a 5-page document
curl -X POST http://localhost:3000/api/tools/reorder-pdf-pages \
  -F "files=@document.pdf;type=application/pdf" \
  -F "order=5,4,3,2,1" \
  -o document-reordered.pdf
```

| Field | Required | Meaning |
| --- | --- | --- |
| `files` | yes | Exactly one PDF |
| `order` | yes | The **complete** new order, e.g. `5,3,1,2,4` |

`order` must be a full permutation: every page from 1 to the page count, exactly
once. Missing pages, duplicates, extras, out-of-range values and non-numeric
input are all rejected with `INVALID_PAGE_ORDER` (400) or `PAGE_OUT_OF_RANGE`
(400) — nothing is silently repaired, and no output is produced. The identity
order (`1,2,3,…`) is accepted and simply returns a copy.

Responses are `application/pdf` named `<source>-reordered.pdf`, with
`X-PDFKit-Pages`, `X-PDFKit-Output-Pages`, `no-store` and `nosniff`.

## Rotate PDF

```bash
# Turn page 1 a quarter-turn clockwise and page 3 upside down
curl -X POST http://localhost:3000/api/tools/rotate-pdf \
  -F "files=@document.pdf;type=application/pdf" \
  -F 'rotations={"1":90,"3":180}' \
  -o document-rotated.pdf
```

| Field | Required | Meaning |
| --- | --- | --- |
| `files` | yes | Exactly one PDF |
| `rotations` | no | JSON object of page → clockwise degrees |

Only `0`, `90`, `180` and `270` are accepted, as JSON **numbers**. `45`, `-90`,
`"90"` and `360` are rejected with `INVALID_PAGE_ROTATION` (400) rather than
being rounded or normalised, and page numbers outside the document give
`PAGE_OUT_OF_RANGE` (400). Pages that are absent keep their orientation, so a
client can send only what changed; an empty request returns the document
unchanged.

**Additive semantics:** the angle is added to the page's existing `/Rotate`
value, matching what "rotate this page" means in the interface — a page already
at 90° plus a requested 90° is saved at 180°. Only the rotation entry changes;
page content is never rasterised, so the output remains a real vector/text PDF
with the same pages in the same order.

## Compress PDF

```bash
# Shrink a PDF with the balanced (default) level
curl -X POST http://localhost:3000/api/tools/compress-pdf \
  -F "files=@document.pdf;type=application/pdf" \
  -F "level=medium" \
  -o document-compressed.pdf
```

| Field | Required | Meaning |
| --- | --- | --- |
| `files` | yes | Exactly one PDF |
| `level` | no | `low`, `medium` (default) or `high` |

The response carries the measured outcome in headers:
`X-PDFKit-Original-Bytes`, `X-PDFKit-Output-Bytes`, `X-PDFKit-Bytes-Saved`,
`X-PDFKit-Reduction-Percent`, `X-PDFKit-Reduced` (`yes`/`no`),
`X-PDFKit-Compression-Strategy` (`lossless` / `rasterized` / `original`) and
`X-PDFKit-Compression-Level`.

What each level really does:

| Level | What happens | Lossy? |
| --- | --- | --- |
| `low` | Rebuilt with PDF object streams; XMP/Info metadata removed | No |
| `medium` | `low` plus every safe stream re-compressed with maximum deflate effort | No |
| `high` | `medium` plus an aggressive pass that renders each page (~110 DPI, JPEG quality 60) and rebuilds the document — kept only when smaller | Yes (when used) |

**Honesty rules:** a saving is only reported when the output is strictly
smaller. If nothing helps, the untouched original bytes are returned,
`X-PDFKit-Reduced` is `no` and the interface says the PDF is already well
optimised. At `high`, the rasterising pass only runs when the document actually
contains images and is within `PDFKIT_COMPRESS_MAX_RASTER_PAGES`; when it runs,
text becomes pixels — no longer selectable — and image quality drops.

**Known limits:** image data in JPEG/JPX/CCITT form is not re-encoded at `low`
or `medium` — those files only shrink at `high` (or through structural gains).
Streams with predictor parameters are left untouched for safety.

## Images to PDF

```bash
curl -X POST http://localhost:3000/api/tools/images-to-pdf \
  -F "files=@image1.jpg;type=image/jpeg" \
  -F "files=@image2.png;type=image/png" \
  -o images-to-pdf.pdf
```

| Field | Required | Meaning |
| --- | --- | --- |
| `files` | yes | One or more `.jpg` / `.jpeg` / `.png` images |

The multipart order **is** the page order. Every image is signature-checked
server-side (`FF D8 FF` / PNG header) — the browser's MIME type is never
trusted, and disguised files get `INVALID_IMAGE` (422). Page geometry: the
image's pixel size at 96 DPI (1 px = 0.75 pt), centred, full-bleed, aspect
exact; a white rectangle is painted behind transparent PNGs so output is
predictable in every viewer. JPEG bytes are embedded as-is. Pixel caps:
24 MP and 12 000 px per side, rejected before embedding. Output name is always
`images-to-pdf.pdf`.

## PDF to JPG and PDF to PNG

```bash
curl -X POST http://localhost:3000/api/tools/pdf-to-jpg \
  -F "files=@document.pdf;type=application/pdf" \
  -o page-1.jpg            # one page → a single image

# several pages → application/zip with document-page-1.jpg … document-page-N.jpg
```

Same contract for `/api/tools/pdf-to-png` with `.png` outputs. Rendering uses
the shared pdfium rasteriser: display orientation (page rotation included),
exact aspect ratio, one bitmap in memory at a time, 150 DPI by default
(`PDFKIT_CONVERSION_DPI`, ceiling 300) with hard pixel guards. JPG quality is
90; PNG is lossless RGBA. Limits: `PDFKIT_CONVERSION_MAX_PAGES` (default 50,
ceiling 200) rejected with `TOO_MANY_OUTPUTS` (413) **before** rendering, and
each produced image is capped by `PDFKIT_CONVERSION_MAX_IMAGE_BYTES`
(default 6 MB) → `OUTPUT_TOO_LARGE` (413). ZIP entry names are sanitised.

## Crop

```bash
curl -X POST http://localhost:3000/api/tools/crop \
  -F "files=@document.pdf;type=application/pdf" \
  -F "mode=margins" -F "top=20" -F "right=10" -F "bottom=5" -F "left=15" \
  -F "ranges=1-3, 5" \
  -o crop.pdf
```

| Field | Required | Meaning |
| --- | --- | --- |
| `files` | yes | Exactly one PDF |
| `mode` | yes | `rectangle` or `margins` |
| `x`,`y`,`width`,`height` | rectangle mode | Points, bottom-left origin, unrotated space; sides ≥ 10 pt; fully inside each selected page's MediaBox |
| `top`,`right`,`bottom`,`left` | margins mode | Points trimmed from each page's own edges, ≥ 0; must leave ≥ 10 pt each way |
| `ranges` | no | Existing range syntax; omitted means every page |

Invalid geometry gives `INVALID_CROP_CONFIGURATION` (400) — nothing is ever
clamped or silently resized. Rectangle mode validates one rectangle against
**every** selected page; margins mode computes per page. The output keeps the
fixed name `crop.pdf`, and the cropped count is reported in
`X-PDFKit-Cropped-Pages`. **Privacy:** cropping hides content from view — it
does not remove it. Cropped-out content remains in the PDF and may be
recovered with any PDF editor or text extractor (including PDFKit's own
PDF → Word). Never use Crop as a security or redaction tool.

## Flatten PDF

```bash
curl -X POST http://localhost:3000/api/tools/flatten-pdf \
  -F "files=@form.pdf;type=application/pdf" \
  -o flattened.pdf
```

| Field | Required | Meaning |
| --- | --- | --- |
| `files` | yes | Exactly one PDF |

Vector flattening with pdf-lib's `PDFForm.flatten()` — pages are **never**
rasterised. Every interactive form field's current value is drawn into the
page as ordinary vector content and the field is removed, so the values stay
selectable and extractable, links and other ordinary annotations keep
working, and page count, order and rotation are unchanged. The output keeps
the fixed name `flattened.pdf`, and the number of flattened fields is
reported in `X-PDFKit-Flattened-Fields`.

Three honest limits, stated in the tool and enforced by the processor:

- **Signed PDFs are rejected** with `SIGNED_PDF` (422) *before* anything is
  mutated. Flattening rewrites the file, which would invalidate a digital
  signature — the tool refuses rather than silently destroying it. Signature
  fields are detected via pdf-lib's field model, the raw `/FT /Sig` entries
  and the AcroForm `SigFlags` bit.
- **Document scripts are NOT removed.** Document-level JavaScript and
  OpenActions survive flattening untouched. Flatten PDF is not a
  sanitisation or security feature and is never presented as one.
- **Flattening is irreversible.** Field values become permanent page
  content; keep the original if the form may need editing again.

Implementation note: pdf-lib 1.17.1's `flatten()` leaves dangling widget
references in each page's `/Annots` array. The processor removes exactly
those non-resolving references (valid annotations such as links are
preserved as they are), drops the now-empty AcroForm dictionary, then
re-opens the output and verifies page count, order, rotation, the absence of
form fields and the absence of dangling references before returning it.

## Page Numbers

```bash
curl -X POST http://localhost:3000/api/tools/page-numbers \
  -F "files=@document.pdf;type=application/pdf" \
  -F "position=bottom-center" -F "start=1" -F "size=11" \
  -F "format=page-of" -F "pages=all" \
  -o document-numbered.pdf
```

| Field | Required | Meaning |
| --- | --- | --- |
| `files` | yes | Exactly one PDF |
| `position` | yes | `bottom-left`, `bottom-center` or `bottom-right` |
| `start` | yes | Whole number 1-9999 (front-matter offset) |
| `size` | yes | Whole number 8-24 (font size in points) |
| `format` | yes | `number` ("1"), `page` ("Page 1") or `page-of` ("Page 1 of 10") |
| `pages` | yes | `all`, `first` or `last` |

Invalid options give `INVALID_PAGE_NUMBER_CONFIGURATION` (400) — values are
never repaired. The numbers are vector text; `Page X of Y` uses the real page
count, so a start above 1 can print an X above Y (documented front-matter
behaviour). The response reports the numbered count in
`X-PDFKit-Numbered-Pages`.

## Watermark

```bash
curl -X POST http://localhost:3000/api/tools/watermark \
  -F "files=@document.pdf;type=application/pdf" \
  -F "text=CONFIDENTIAL" -F "opacity=50" -F "rotation=45" \
  -F "placement=center" -F "pages=all" \
  -o document-watermarked.pdf
```

| Field | Required | Meaning |
| --- | --- | --- |
| `files` | yes | Exactly one PDF |
| `text` | yes | Watermark text, 1-200 characters after trimming |
| `opacity` | yes | `25`, `50` or `75` (percent) |
| `rotation` | yes | `0`, `45` or `-45` degrees |
| `placement` | yes | `center`, `diagonal-tiled` or `corner` (bottom-right) |
| `pages` | yes | `all`, `first` or `last` |

Invalid options give `INVALID_WATERMARK_CONFIGURATION` (400) — values are
never repaired. The watermark is vector text over the original content with an
alpha `ExtGState`; page geometry and `/Rotate` are untouched. The response
reports the stamped-page count in `X-PDFKit-Watermarked-Pages`. Standard Latin
characters only (the watermark font's range). **A visible watermark is a
deterrent, not protection** — anyone with a PDF editor can remove it.

## PNG to PDF

```bash
curl -X POST http://localhost:3000/api/tools/png-to-pdf \
  -F "files=@shot1.png;type=image/png" \
  -F "files=@shot2.png;type=image/png" \
  -o png-to-pdf.pdf
```

| Field | Required | Meaning |
| --- | --- | --- |
| `files` | yes | One or more `.png` images |

The multipart order **is** the page order. Every file is signature-checked
server-side (real PNG header), dimensions are capped before embedding
(24 MP / 12 000 px per side), and the output is `png-to-pdf.pdf` with one page
per image at 96 DPI, aspect-exact. Shares the Images to PDF engine — no new
dependencies.

## Edit PDF Metadata

```bash
curl -X POST http://localhost:3000/api/tools/edit-pdf-metadata \
  -F "files=@document.pdf;type=application/pdf" \
  -F "title=Quarterly Report" \
  -F "keywords=finance, 2026" \
  -o document-metadata.pdf
```

| Field | Required | Meaning |
| --- | --- | --- |
| `files` | yes | Exactly one PDF |
| `title`/`author`/`subject`/`creator` | no | Empty string removes the entry; absence leaves it unchanged |
| `keywords` | no | Comma-separated; empty string removes the list |

Values are limited to 2 000 characters each and 50 keywords (200 characters
per keyword) — `VALIDATION_ERROR` (400) otherwise. Unicode round-trips
exactly. Reading metadata happens through the existing inspect endpoint, whose
response now carries a `metadata` object additively. **pdf-lib limitations,
stated honestly:** the Producer string and both dates are re-stamped by the
library on every save, so they are read-only; pdf-lib's own keyword setter
joins with spaces, so PDFKit writes the comma-separated string itself.

## Remove Metadata

```bash
curl -X POST http://localhost:3000/api/tools/remove-metadata \
  -F "files=@document.pdf;type=application/pdf" \
  -o document-metadata-removed.pdf
```

| Field | Required | Meaning |
| --- | --- | --- |
| `files` | yes | Exactly one PDF |

The response carries the verified outcome in headers: `X-PDFKit-Removed-Fields`
(how many of the five Info fields contained data), `X-PDFKit-Xmp-Removed`
(`yes` / `not-present`), `X-PDFKit-Verification` (`verified`). No dependency was
added for XMP: pdf-lib deletes the catalog `/Metadata` entry and the underlying
object, the same primitive the compress pass has used since Phase 7 — plus the
object-graph removal the privacy guarantee requires.

## PDF to Word

```bash
curl -X POST http://localhost:3000/api/tools/pdf-to-word \
  -F "files=@document.pdf;type=application/pdf" \
  -o document.docx
```

| Field | Required | Meaning |
| --- | --- | --- |
| `files` | yes | Exactly one PDF |

Text-only conversion: `application/vnd…wordprocessingml.document` output with
the page texts in order, one paragraph per extracted line and a page break
between pages. Extracted text is stripped of XML-invalid control characters
(a crafted PDF can carry raw control bytes that pdfium extracts verbatim;
without the strip they would corrupt the Office XML). Response headers carry the measured extraction
(`X-PDFKit-Characters`, `X-PDFKit-Paragraphs`, `X-PDFKit-Mode: text-only`).
Built on the existing pdfium text pipeline plus the MIT-licensed `docx`
generator — no LibreOffice, no Python, no child processes, no temp files.
Full-fidelity PDF→Word (layout, images, tables) is **not** available; the
Phase 14 feasibility study documents why (AGPL-licensed alternatives, or a
sandboxed LibreOffice worker the current architecture deliberately does not
have).

## Password Protect

```bash
curl -X POST http://localhost:3000/api/tools/password-protect \
  -F "files=@document.pdf;type=application/pdf" \
  -F "password=correct horse battery staple" \
  -o document-protected.pdf
```

| Field | Required | Meaning |
| --- | --- | --- |
| `files` | yes | Exactly one PDF |
| `password` | yes | 1–128 characters, used exactly as typed — never trimmed |

Real RC4 128-bit encryption (PDF Standard Security Handler, V2/R3) via
`@pdfsmaller/pdf-encrypt-lite`. Opening the output genuinely requires the
password. It is **not** AES-256 — every place the tool appears says exactly
which scheme is applied, and the words "military-grade" and "zero-knowledge"
appear nowhere.

Before the download exists, the output is verified: it reports RC4 128-bit in
its encryption dictionary, it refuses to open without a password, and the
password supplied reopens it with every page intact. An already-encrypted
input is refused with `ENCRYPTED_PDF` rather than being silently re-encrypted,
and passwords the legacy handler cannot encode (non-Latin characters) are
rejected with a clear message.

Password hygiene is structural: the value arrives once as a multipart field,
is held in memory for the request, and can never appear in logs (only
tool/outcome/counts are logged), URLs, file names, response headers or error
bodies — the tests assert the absence explicitly.

## Unlock PDF

```bash
curl -X POST http://localhost:3000/api/tools/unlock-pdf \
  -F "files=@document-protected.pdf;type=application/pdf" \
  -F "password=correct horse battery staple" \
  -o document-unlocked.pdf
```

| Field | Required | Meaning |
| --- | --- | --- |
| `files` | yes | Exactly one protected PDF |
| `password` | no | The file's password; omit/empty only for files that open without asking |

Real decryption via `@pdfsmaller/pdf-decrypt-lite`: RC4 40-bit (V1/R2) and
128-bit (V2/R3) — the latter is exactly what Password Protect writes, and the
full protect → unlock round trip is tested over both real routes. The
`/Encrypt` dictionary is stripped, so the output is an ordinary PDF again;
the processor proves it by re-opening the result without a password and
counting every page before returning it.

Refusals are honest and specific: an unprotected input answers
`PDF_NOT_ENCRYPTED`, a password that does not authenticate answers
`WRONG_PASSWORD` (the entry is never echoed anywhere), and AES-class files
(V≥4) answer `UNSUPPORTED_ENCRYPTION` — only RC4 is supported, and the
message says so. This is not password recovery: the supplied password is
authenticated, never guessed. Damaged encryption dictionaries are reported as
`INVALID_PDF`, not misread as "not encrypted".

## Add Text

```bash
curl -X POST http://localhost:3000/api/tools/add-text \
  -F "files=@form.pdf;type=application/pdf" \
  -F "text=Received 25 August" \
  -F "placement=top-left" \
  -F "size=12" \
  -F "pages=first" \
  -o form-text-added.pdf
```

| Field | Required | Meaning |
| --- | --- | --- |
| `files` | yes | Exactly one PDF |
| `text` | yes | 1–500 characters, up to 20 lines (newlines allowed) |
| `placement` | yes | One of nine anchors: `top-left` … `center` … `bottom-right` |
| `size` | yes | `12`, `16`, `24` or `36` (points) |
| `pages` | yes | `all`, `first` or `last` |

A text box drawn as real vector text with pdf-lib's standard Latin font —
pages are never rasterised, so the document stays searchable and the added
text is extractable (processor tests prove it by re-reading the text with
pdfium). Text that would overflow the page is scaled down to fit instead of
being silently clipped, and characters the WinAnsi font cannot encode are
rejected with `INVALID_TEXT_CONFIGURATION` and a clear message — never
silently replaced. The number of pages stamped is reported in
`X-PDFKit-Text-Pages`.

## Page previews

```bash
curl -X POST http://localhost:3000/api/documents/thumbnails \
  -F "files=@document.pdf;type=application/pdf" \
  -F "pages=1,3,5"
```

```json
{
  "pageCount": 12,
  "thumbnails": [
    { "pageNumber": 1, "width": 220, "height": 311, "dataUrl": "data:image/png;base64,..." }
  ]
}
```

`pages` is optional — omitting it renders the first N pages, where N is
`PDFKIT_THUMBNAIL_MAX_PAGES`. An optional `rotations` field (same JSON format as
Rotate PDF) renders the preview turned by that angle; 90° and 270° swap the
width and height, and nothing is stretched. Pages are rendered by **pdfium compiled to
WebAssembly**, encoded to PNG by a small local encoder built on fflate, and
returned as data URLs. No temporary files, no storage, no cache.

| Variable | Default | Meaning |
| --- | --- | --- |
| `PDFKIT_THUMBNAIL_MAX_PAGES` | `60` | Pages rendered per request (ceiling 200) |
| `PDFKIT_THUMBNAIL_WIDTH` | `220` | Rendered width in pixels (ceiling 600) |
| `PDFKIT_THUMBNAIL_MAX_BYTES` | `500000` | Maximum size of one PNG |

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
| `PDFKIT_COMPRESS_MAX_RASTER_PAGES` | `60` | Pages the aggressive compress pass may rasterise (ceiling 300) |
| `PDFKIT_CONVERSION_MAX_PAGES` | `50` | Pages a PDF → image export may render (ceiling 200) |
| `PDFKIT_CONVERSION_DPI` | `150` | Render resolution for image exports (ceiling 300) |
| `PDFKIT_CONVERSION_MAX_IMAGE_BYTES` | `6291456` | Maximum size of one produced image (ceiling 16 MB) |

Limits are enforced by the server on every request. The numbers shown in the
interface come from the build-time configuration, so rebuild after changing
them if you want the hints to match exactly.

## Production hardening

Every `/api/tools/*` route goes through one hardened wrapper
(`src/lib/hardening/route.ts`), which adds three guards around the unchanged
HTTP adapter:

- **Numeric Content-Length gate** — a malformed `Content-Length` header (not
  a plain decimal byte count) is rejected with 400 before the body is read.
- **Optional concurrency cap** — `PDFKIT_MAX_CONCURRENT_JOBS` (default `0` =
  no cap). When the cap is reached, extra requests fail fast with
  `503 SERVER_BUSY`. There is deliberately no queue.
- **Request timeout** — `PDFKIT_REQUEST_TIMEOUT_MS` (default 120 s). The
  caller receives `504 REQUEST_TIMEOUT` after the budget. The job itself is
  **not** aborted — pdfium's WASM work cannot be cancelled mid-render, so
  pretending otherwise would be dishonest; the job finishes privately, its
  result is discarded and its slot is released when it actually ends.

## Production Observability and Health

- **Health Probe Endpoint** — `GET /api/health` returns HTTP 200 with structured
  JSON (`status: "ok"`, `timestamp`, `uptimeSeconds`, `version`). Independent of
  PDF processing and WASM/pdfium initialization; does not expose internal secrets.
- **Structured JSON Logging** — `src/lib/monitoring/logger.ts` emits privacy-safe
  structured JSON entries in production (`event: "job_completed"`, `tool`, `outcome`,
  `files`, `bytes`, `ms`, `code`). Never logs passwords, file names, document
  contents, or secrets.
- **Sentry Error Reporting** — `sentry.server.config.ts` and `src/lib/monitoring/sentry.ts`
  integrate Sentry for server-side error reporting when `SENTRY_DSN` is configured.
  Sanitizes request bodies, headers, and credentials defensively before transmission.

Routes keep the long-lived Node runtime (`runtime = "nodejs"`,
`dynamic = "force-dynamic"`); nothing runs on the edge. A GitHub Actions CI
workflow (`.github/workflows/ci.yml`) runs lint, typecheck, tests and a
production build on every push to `main` and every pull request.

## What is deliberately not implemented

Office↔PDF conversion (Word/Excel/PowerPoint), redaction, digital signatures,
OCR, AI, authentication, cloud storage, databases, payments, API keys, a
public developer API, background workers and job queues are **not**
implemented. There is no simulated processing anywhere: no fake
progress bars, no fake results, no fake downloads, no placeholder page images.
Only Merge PDF, Split PDF, Extract PDF Pages, Delete PDF Pages, Reorder PDF
Pages, Rotate PDF, Compress PDF, Images to PDF, PNG to PDF, PDF to JPG, PDF to
PNG, PDF to Word (text only), Edit PDF Metadata, Remove Metadata, Watermark,
Add Text, Page Numbers, Crop, Flatten PDF, Password Protect and Unlock PDF
are real.

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
│  ├─ api/tools/reorder-pdf-pages/  # Reorder endpoint (thin route handler)
│  ├─ api/tools/compress-pdf/ # Compress endpoint (thin route handler)
│  ├─ api/tools/rotate-pdf/         # Rotate endpoint (thin route handler)
│  ├─ api/documents/thumbnails/     # Reusable page previews
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
   ├─ thumbnails/            # Page rasteriser, PNG encoder, limits (server only)
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
| `PDFKIT_REQUEST_TIMEOUT_MS`     | Request time budget before 504 (default 120000, ceiling 600000); the job is not aborted |
| `PDFKIT_MAX_CONCURRENT_JOBS`    | Jobs processed at once before 503 (default 0 = no cap, ceiling 1024) |
| `PDFKIT_COMPRESS_MAX_RASTER_PAGES` | Pages the aggressive compress pass may rasterise (default 60, ceiling 300) |
| `PDFKIT_CONVERSION_MAX_PAGES` | Pages a PDF → image export may render (default 50, ceiling 200) |
| `PDFKIT_CONVERSION_DPI` | Export render resolution (default 150, ceiling 300) |
| `PDFKIT_CONVERSION_MAX_IMAGE_BYTES` | Maximum size of one produced image (default 6 MB) |
| `PDFKIT_THUMBNAIL_MAX_PAGES`    | Pages rendered per preview request (default 60) |

`.env` files are git-ignored (`.env.example` is the only tracked one). Secrets
for future phases must be server-only — never prefixed with `NEXT_PUBLIC_`.

---

## Testing

```bash
npm test                # run once
npm run test:watch      # watch mode
npm run test:coverage   # with coverage
```

Covered today (91 files, 1191 tests):

- **Hardening (Phase 28)** — config defaults/env overrides/ceilings, the
  numeric Content-Length gate, the job-slot counter, and the hardened handler
  itself: 400 before the body is read, pass-through with slot release,
  `503 SERVER_BUSY` when capped, `504 REQUEST_TIMEOUT` without pretending to
  abort (the slot is held until the job genuinely ends), safe 500 on an
  unexpected throw, and one real route checked for the Phase 28 flags.
- **Password Protect** — option parsing (exact-as-typed, boundaries), the
  processor (real RC4 128-bit verified three ways; already-encrypted
  refused; unencodable passwords rejected), the API (standard headers,
  genuine encryption proven over HTTP, password proven absent from every
  response header), and the workspace (match-gated action, only the password
  — never the confirmation — is sent, honest RC4 copy, cleared fields).
- **Unlock PDF** — option parsing (empty allowed), the processor
  (protect → unlock round trip with page order proven, empty-user-password
  files, `PDF_NOT_ENCRYPTED`, `WRONG_PASSWORD` never echoed, AES-class
  refused via a hand-declared V4/R4 dictionary — not a genuine AES fixture),
  the API (end-to-end round trip over both real routes, every refusal code),
  and the workspace (server-confirmed protection, unprotected files told
  kindly, wrong-password and AES errors surfaced).
- **Add Text** — option parsing (nine placements, four sizes, length/line
  budgets), the processor (text proven extractable with pdfium on every
  stamped page, multi-line blocks, fit-scaling, WinAnsi rejection, original
  content untouched), the API (standard headers, `X-PDFKit-Text-Pages`,
  every error mode), and the workspace (defaults, full payload with
  multi-line text, budget blocking, server-confirmed success, cancel).
- **Flatten processor** — text field, checkbox, radio group, dropdown and
  option list flattened (field count verified), values proven extractable
  with pdfium (including Unicode), empty fields, multiple pages, rotated
  pages, page count/order/rotation preserved on reopen, static text
  preserved, links preserved while pdf-lib's dangling widget references are
  removed (the raw bug is reproduced first so the cleanup proof cannot rot),
  empty-`/Annots` and empty-AcroForm cleanup, signature rejection via field
  type and via `SigFlags`, the honesty proof that document JavaScript
  survives, malformed/encrypted/multi-file rejections, fixed output name,
  input immutability
- **Flatten API** — standard headers, flattened-count header, exact
  content-length, zero-field pass-through, `SIGNED_PDF` (422), every error
  mode, hostile filename sanitised, no internals leaked, GET 405
- **Flatten workspace** — upload, non-PDF rejection before any request, the
  prominent irreversibility warning plus the selectable-text / links /
  scripts-not-removed / signed-rejected statements, indeterminate processing
  (no fake percentages), cancel via AbortController, server-confirmed field
  count in the success state, error alerts, reset, polite announcements

- **Crop model** — modes, rectangle/margins parsing, finiteness, 10 pt
  minimum, negative rejection, MediaBox fit (reject-never-clamp), per-page
  margin computation
- **Crop processor** — CropBox set on exactly the selected pages (verified on
  reopen), MediaBox/order/rotation/content preserved, heterogeneous sizes,
  rectangle-fit rejection naming the failing page, unicode, the privacy proof
  (cropped-out text extracted back from the output), malformed/encrypted/
  multi-file rejections, fixed output name, input immutability
- **Crop API** — standard headers, cropped-count header, every error mode,
  GET 405
- **Crop workspace** — mode switching, numeric fields with aria-invalid and
  inline errors, units and coordinate explanation, the prominent
  not-redaction warning, ranges, cancel, server-confirmed counts, reset,
  announcements

- **Page-number model** — exact option sets and ranges, never-repair
  validation, page-mode resolution, label rendering including the
  front-matter offset behaviour
- **Page-number processor** — sequential labels proven present in the decoded
  content streams on exactly the selected pages, start offset with the real
  total kept (`Page 6 of 2`), every position and format, font size visible in
  the operators, rotation/content preservation, malformed/encrypted/
  multi-file rejections, hostile names, input immutability
- **Page-number API** — standard headers, numbered-count header, every error
  mode, GET 405
- **Page-number workspace** — defaults, option switching, numeric inputs with
  aria-invalid and inline errors, payload, honest indeterminate processing,
  cancel, server-confirmed counts, reset, announcements

- **Watermark model** — exact option sets, text trimming and length limits,
  never-repair validation for opacity/rotation/placement/pages, page-mode
  resolution
- **Watermark processor** — vector presence proven by decoding the content
  streams (hex text operators + alpha state) on the right pages and only
  there, all 27 placement×rotation×opacity combinations, page
  size//Rotate/content preservation, font-range rejection, malformed/
  encrypted/multi-file rejections, hostile names, input immutability
- **Watermark API** — standard headers, stamped-count header, every error
  mode, GET 405
- **Watermark workspace** — defaults, option switching, payload, honest
  indeterminate processing, cancel, server-confirmed counts, deterrent
  warning before and after, reset, announcements

- **PNG to PDF processor/API/workspace** — order, 96-DPI dimensions, aspect,
  transparency soft mask, JPEG-renamed-.png rejection by signature, wrong
  extension/MIME, oversized dimensions, count/size limits, hostile names,
  reorder/cancel/reset in the workspace, GET 405

- **PDF to Word processor** — page/text order, one-paragraph-per-line,
  page breaks, unicode, no-text pages marked, in-memory DOCX validated as a
  real Office ZIP, page limits, malformed/encrypted/multi-file rejections,
  hostile names sanitised, input immutability, and XML-invalid control
  characters stripped so unusual PDF text can never malform the document
- **PDF to Word API** — standard headers, measured extraction facts,
  zero-character honesty, every error mode, GET 405
- **PDF to Word workspace** — the text-only warning before and after
  conversion, server-measured result facts, no-text state, cancel, reset,
  announcements

- **Metadata removal** — all five Info fields plus XMP gone (proven at the
  byte level, not just unreferenced), unicode metadata, empty/no-Info/XMP-free
  documents, page identity preserved, verified-removal failure path,
  malformed/encrypted/multi-file rejections, hostile names sanitised
- **Remove Metadata API** — verified outcome headers, every error mode, GET
  405, no internals leaked
- **Remove Metadata workspace** — server-detected readout, honest limits copy,
  cancel, verified result state, announcements

- **Metadata model** — editable/read-only field split, keyword parsing and
  round-trips, date formatting, length/count/type validation, unicode
- **Metadata inspection** — stored values reported with `null` for absent
  fields, bare documents fully `null`
- **Edit Metadata processor** — writes and removals proven by re-reading the
  output, absent-field preservation, unicode round-trip, Info dictionary
  created when missing, page identity untouched, hostile names sanitised,
  malformed/encrypted/oversized/non-string rejections
- **Edit Metadata API** — standard headers, clearing, absence semantics,
  every failure mode, GET 405
- **Edit Metadata workspace** — server-read values, all-fields-explicit
  payload, clear-all, read-only Producer/dates display, cancel via
  AbortController, success/error/reset, live announcements

- **Image inspection** — JPEG/PNG signature detection, header dimension
  parsing, pixel caps, near-miss headers
- **Images-to-PDF processor** — single/mixed/multi-image conversions, exact
  order and aspect ratios, JPEG pass-through (DCTDecode), PNG transparency
  (SMask), 96 DPI page sizing, disguised/wrong-type/empty/oversized/too-many
  rejections, input immutability
- **PDF-to-image processors** — one page → single image, multi-page → ordered
  bundle, ZIP entries decode (JPEG and PNG), aspect and rotation, colours,
  DPI override, page/byte limits, malformed/encrypted rejections, hostile
  names sanitised
- **Three new API routes** — headers, content types, ZIP delivery, every
  failure mode, no internals leaked
- **Two new workspaces** — ordering before conversion, predictions from the
  real page count, indeterminate progress, cancel, ZIP vs single-file results,
  server/network errors, live announcements

- **Compression model** — level validation, exact statistics math
  (1000→750 reports 250 saved, 25.0 %), honest no-reduction behaviour, and the
  meta-record round trip
- **Lossless optimiser** — proven lossless by decoding every stream before and
  after, `/Length` correctness, image and predictor streams untouched, metadata
  removal, structural vs stream gains
- **Rasteriser** — valid JPEG rebuilds, page identity and order, rotation baked
  into pixels, scanned-style input genuinely shrinking, broken input rejected
- **Compress processor** — all three levels against real PDFs, default level,
  invalid level (400), page/dimension/order preservation, best-of selection,
  honest second pass, encrypted/disguised/malformed/oversized/multi-file
  rejection, raster skip reasons, graceful raster-failure fallback
- **Compress API** — headers and byte math verified against the actual response,
  honest no-reduction case, filename sanitisation, no internals leaked
- **Compress workspace** — level radio group with medium default, server-measured
  statistics, neutral no-reduction state, network vs server errors, cancel via
  AbortController, reset, second compression, live announcements, no fake
  progress

- **Rotation model** — the four legal angles, clockwise/counter-clockwise
  cycles, composition, and rejection of 45°, `-90`, `"90"`, `NaN` and friends
- **Rotate processor** — real rotations verified with `getRotation()`, additive
  behaviour on pre-rotated pages, page order/count preserved, no output on
  invalid input
- **Rotated previews** — dimensions swap for 90°/270°, area is preserved (no
  stretching), and a corner marker is tracked pixel-by-pixel around all four turns
- **Visual page selection** — click-to-select ↔ range-field synchronisation in
  both directions, zero-page protection, honest fallbacks

- **Page order model** — permutation validation (missing, duplicate, extra,
  out-of-range, non-numeric, wrong length) and the pure move helper
- **Reorder processor** — real permutations verified by page identity, plus a
  test that no output document is created when the order is invalid
- **PNG encoder** — output decoded by an independent decoder and compared pixel
  for pixel
- **Rasteriser** — page identity proven by rendering pages of known colours,
  aspect ratio, limits, malformed/encrypted input, concurrency
- **Thumbnail and reorder APIs** — headers, page identity, every failure mode
- **Reorder workspace** — previews, moves, keyboard, announcements, explicit
  order submission, preview failure and retry

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

Candidate next phases on the current architecture (see also `/roadmap`):

1. More edit tools on proven primitives — headers/footers on the numbering
   pipeline, or real redaction (content **removal**, not covering; crop is
   explicitly not redaction).
2. DOCX → PDF (requires the sandboxed LibreOffice worker decided against in
   the Phase 14 feasibility study — a platform decision, not a code change);
   OCR (native engine or external service, both a platform decision).
3. Digital signatures (a platform decision).
4. AI document intelligence.
5. Accounts, cloud storage, billing and a public developer API.

A tool's status changes to `AVAILABLE` only when its processing genuinely works.

---

## Documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) — structure, decisions, design system,
  tool catalog and the processing boundary
