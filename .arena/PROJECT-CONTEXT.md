# PDFKit — Project Context & Architecture Summary

## 1. Project Overview
- **Project Name**: PDFKit
- **Purpose**: Privacy-first, speed-focused online PDF and document processing toolkit.
- **Repository**: `https://github.com/Anbu07-96/pdfkit`
- **Current Working Branch**: `arena/01a0360f-pdfkit`
- **Current Baseline / Origin Main**: `e0ba835` (`Merge pull request #3`)
- **Current Local HEAD**: `f1be1a2`
- **Completed Phases**: Phases 1–44 complete (Phase 45 NOT started).

---

## 2. Technology Stack
- **Framework & Runtime**: Next.js 16 (App Router), React 19, Node.js 20+, TypeScript (strict).
- **Styling & UI**: Tailwind CSS v4, local design system in `src/components/ui`, Lucide React icons.
- **PDF Engines**: `pdf-lib` (vector PDF manipulation), `@hyzyla/pdfium` (WebAssembly page rasterization & text extraction), `fflate` (ZIP archiving & zlib), `@pdfsmaller/pdf-encrypt-lite` / `pdf-decrypt-lite` (RC4 encryption/decryption), `docx` (text-only DOCX export), `jpeg-js` (JPEG encoding).
- **Authentication**: NextAuth.js JWT session strategy (`src/lib/auth/`) with `ANONYMOUS_USER_IDENTITY` fallback for unauthenticated visitors.
- **Hardening & Rate Limiting**: Centralized HTTP route handler (`src/lib/hardening/route.ts`), IP rate limiting & Lua-based concurrency locks via `ioredis` (`src/lib/hardening/distributed-protection.ts`) with deterministic in-memory fallback.
- **Observability**: Health endpoint (`GET /api/health`), structured JSON logging (`src/lib/monitoring/logger.ts`), Sentry error reporting (`@sentry/nextjs`).
- **Database & Metering**: PostgreSQL + Prisma (`prisma/schema.prisma`), provider-neutral repository abstraction (`src/lib/usage/`), daily job and byte quotas per account tier (`anonymous`, `free`, `pro`, `business`).
- **Billing**: Provider-isolated Stripe integration (`src/lib/billing/`), checkout sessions (`POST /api/billing/checkout`), signature-verified webhooks (`POST /api/billing/webhook`).

---

## 3. Mandatory Instructions for New Arena Sessions
1. **No Previous Chat Memory**: Never assume previous Arena chat context is available. The git working tree and repository files are the sole source of truth.
2. **Read Arena State Files First**: At the start of every new session, inspect `.arena/PROJECT-CONTEXT.md`, `.arena/PHASE-STATUS.md`, `.arena/KNOWN-ISSUES.md`, and `.arena/GIT-WORKFLOW.md`.
3. **Inspect Repository State**: Run `git status`, `git branch --show-current`, and `git log -n 5` before executing work.
4. **Preserve Catalog Honesty**: All 29 implemented tools in `src/lib/tools/catalog.ts` must remain marked `AVAILABLE` with active processors in `src/lib/registry.ts`. `COMING_SOON` tools must keep disabled uploads. No fake PDFs or simulated downloads.

---

## 4. Documentation References
- [README.md](../README.md) — Tool capability catalog, environment variables, scripts, and error codes.
- [ARCHITECTURE.md](../ARCHITECTURE.md) — Comprehensive layer-by-layer architectural design, memory scaling rules, and security posture.
