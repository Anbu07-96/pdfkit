# PDFKit — Project Context & Architecture Summary

## 1. Project Overview
- **Project Name**: PDFKit
- **Purpose**: Privacy-first, speed-focused online PDF and document processing toolkit.
- **Repository**: `https://github.com/Anbu07-96/pdfkit`
- **Current Working Branch**: `arena/01a081d8-pdfkit`
- **Current Baseline / Origin Main**: `da4a50e` (`Merge PDFKit phases 54-60`)
- **Completed Phases**: Phases 1–60 complete (merged to `main`); Phase 61 (Bulk Tools & Image Extraction) complete on the session branch.

---

## 2. Technology Stack
- **Framework & Runtime**: Next.js 16 (App Router), React 19, Node.js 20+, TypeScript (strict).
- **Styling & UI**: Tailwind CSS v4, local design system in `src/components/ui`, Lucide React icons.
- **PDF Engines**: `pdf-lib` (vector PDF manipulation), `@hyzyla/pdfium` (WebAssembly page rasterization & text extraction), `fflate` (ZIP archiving & zlib — server-side bundling and, since Phase 61, the browser-side bulk "Download all" ZIP), `@pdfsmaller/pdf-encrypt-lite` / `pdf-decrypt-lite` (RC4 encryption/decryption), `docx` (text-only DOCX export), `exceljs` (XLSX export), `jpeg-js` (JPEG encoding).
- **Authentication**: NextAuth.js JWT session strategy (`src/lib/auth/`) with `ANONYMOUS_USER_IDENTITY` fallback for unauthenticated visitors.
- **Hardening & Rate Limiting**: Centralized HTTP route handler (`src/lib/hardening/route.ts`), IP rate limiting & Lua-based concurrency locks via `ioredis` (`src/lib/hardening/distributed-protection.ts`) with deterministic in-memory fallback.
- **Observability**: Health endpoint (`GET /api/health`), structured JSON logging (`src/lib/monitoring/logger.ts`), Sentry error reporting (`@sentry/nextjs`).
- **Database & Metering**: PostgreSQL + Prisma (`prisma/schema.prisma`), provider-neutral repository abstraction (`src/lib/usage/`), daily job and byte quotas per account tier (`anonymous`, `free`, `pro`, `business`).
- **Billing**: Razorpay integration (`src/lib/billing/`), checkout verification, signature-verified webhooks.
- **Bulk Processing (Phase 61)**: Client-orchestrated batch runner (`src/lib/bulk/`) over the existing single-file endpoints — one file per request, sequentially paced; `/bulk` section with per-file status, cancel, retry, batch ZIP and quota preflight (`GET /api/usage`).
- **Bulk Observability (Phase 62)**: Honest `Retry-After` end-to-end, batch summary + CSV export (formula-injection guarded), friendly error categories, batch correlation id (log-only, never authorization), structured rate/quota/timeout events, bulk search integration, ZIP entry caps + Unicode filename preservation, deterministic load tests (`runner.load.test.ts`), and `docs/bulk-limit-review.md` (limits documented, not raised).

---

## 3. Mandatory Instructions for New Arena Sessions
1. **No Previous Chat Memory**: Never assume previous Arena chat context is available. The git working tree and repository files are the sole source of truth.
2. **Read Arena State Files First**: At the start of every new session, inspect `.arena/PROJECT-CONTEXT.md`, `.arena/PHASE-STATUS.md`, `.arena/KNOWN-ISSUES.md`, and `.arena/GIT-WORKFLOW.md`.
3. **Inspect Repository State**: Run `git status`, `git branch --show-current`, `git log -n 5` before executing work.
4. **Preserve Catalog Honesty**: All implemented tools in `src/lib/tools/catalog.ts` must remain marked `AVAILABLE` with active processors in `src/lib/processing/registry.ts`. `COMING_SOON` tools must keep disabled uploads. No fake PDFs or simulated downloads. The same honesty applies to bulk operations: a bulk operation may only exist when its underlying single-file tool is `AVAILABLE` (enforced by `src/lib/tools/bulk.test.ts`).

---

## 4. Documentation References
- [README.md](../README.md) — Tool capability catalog, environment variables, scripts, bulk tools section, and error codes.
- [ARCHITECTURE.md](../ARCHITECTURE.md) — Comprehensive layer-by-layer architectural design, memory scaling rules, bulk processing architecture (§5v, §5w), and security posture.
- [docs/bulk-limit-review.md](../docs/bulk-limit-review.md) — Bulk limit review mechanism: every limit, why it is conservative, metrics, raise thresholds and reduce conditions.
