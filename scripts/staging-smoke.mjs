#!/usr/bin/env node
/**
 * Phase 64, Step 9 — staging smoke test.
 *
 * Controlled verification that a deployed staging environment is wired
 * correctly. NOT a load test: a handful of requests, all legitimate.
 *
 * Usage:
 *   PDFKIT_BASE_URL=https://staging.example.com npm run smoke:staging
 *   PDFKIT_BASE_URL=https://staging.example.com \
 *     PDFKIT_ADMIN_METRICS_TOKEN=... npm run smoke:staging        # + metrics checks
 *
 * Checks (in order):
 *   1. liveness  (/api/health)             — process is up
 *   2. readiness (/api/health/ready)       — dependencies report their state
 *   3. one simple job (merge two tiny PDFs) — full processing path works
 *   4. invalid PDF → 422                   — validation path intact
 *   5. metrics: 401/404 without a token    — admin surface is protected
 *      + 200 with PDFKIT_ADMIN_METRICS_TOKEN (only when provided)
 *   6. Retry-After sanity on a rate-limited endpoint (admin metrics scope,
 *      31 unauthenticated requests max — deliberately bounded, no flooding)
 *
 * Exits non-zero when any check fails. Never prints secrets.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const BASE_URL = process.env.PDFKIT_BASE_URL;
if (!BASE_URL) {
  console.error("PDFKIT_BASE_URL is required (e.g. https://staging.example.com).");
  process.exit(2);
}
const ADMIN_TOKEN = process.env.PDFKIT_ADMIN_METRICS_TOKEN;

const results = [];
function report(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}: ${detail}`);
}

async function makeFixtures() {
  const dir = join(tmpdir(), `pdfkit-smoke-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([200, 200]);
  page.drawText("smoke test", { x: 20, y: 100, size: 12, font });
  const bytes = await doc.save();
  writeFileSync(join(dir, "a.pdf"), bytes);
  writeFileSync(join(dir, "b.pdf"), bytes);
  writeFileSync(join(dir, "garbage.bin"), Buffer.from("not a pdf"));
  return dir;
}

function jobForm(paths) {
  const form = new FormData();
  for (const p of paths) {
    form.append("files", new Blob([new Uint8Array(readFileSync(p))], { type: "application/pdf" }), "doc.pdf");
  }
  return form;
}

async function main() {
  const fixtures = await makeFixtures();
  try {
    // 1. Liveness
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      report("liveness", res.status === 200, `GET /api/health → ${res.status}`);
    } catch (err) {
      report("liveness", false, `GET /api/health failed: ${(err).message}`);
    }

    // 2. Readiness (report the verdict; staging should be "ok" — the
    // operator decides whether "degraded" is acceptable for their stage).
    try {
      const res = await fetch(`${BASE_URL}/api/health/ready`);
      const body = await res.json();
      const checks = body.checks ?? {};
      report(
        "readiness",
        res.status === 200,
        `GET /api/health/ready → ${res.status} status=${body.status} ` +
          `db=${checks.database?.status} redis=${checks.redis?.status} processing=${checks.processing?.status} env=${body.environment}`,
      );
    } catch (err) {
      report("readiness", false, `GET /api/health/ready failed: ${(err).message}`);
    }

    // 3. One simple job: merge two tiny PDFs through the full path.
    try {
      const res = await fetch(`${BASE_URL}/api/tools/merge-pdf`, {
        method: "POST",
        body: jobForm([join(fixtures, "a.pdf"), join(fixtures, "b.pdf")]),
      });
      const isPdf = (res.headers.get("content-type") ?? "").includes("pdf");
      report("simple-job", res.status === 200 && isPdf,
        `POST /api/tools/merge-pdf → ${res.status} (${res.headers.get("content-type")?.split(";")[0]})`);
    } catch (err) {
      report("simple-job", false, `merge job failed: ${(err).message}`);
    }

    // 4. Invalid PDF → 422 (validation intact).
    try {
      const res = await fetch(`${BASE_URL}/api/tools/merge-pdf`, {
        method: "POST",
        body: jobForm([join(fixtures, "garbage.bin"), join(fixtures, "b.pdf")]),
      });
      const body = await res.json().catch(() => ({}));
      report("invalid-pdf-422",
        res.status === 422 && ["INVALID_PDF", "VALIDATION_ERROR"].includes(body?.error?.code),
        `invalid PDF → ${res.status} ${body?.error?.code}`);
    } catch (err) {
      report("invalid-pdf-422", false, `invalid-PDF request failed: ${(err).message}`);
    }

    // 5+6. Metrics protection & rate limiting (combined, bounded).
    //
    // The admin-metrics endpoint is behind the shared IP rate limiter with its
    // own scope (30/min). The probe is deliberately small (≤ 31 unauthenticated
    // requests — no flooding) and tolerant of an already-active rate window
    // from a recent smoke run: a 429 on the FIRST request proves the limiter
    // just as well as exhausting it here. Token checks are skipped in that
    // case (the limiter runs before the token check by design).
    try {
      const first = await fetch(`${BASE_URL}/api/admin/metrics`);
      if (first.status === 429) {
        const retryAfter = first.headers.get("retry-after");
        report("rate-limit-visible", Number(retryAfter) > 0,
          `already rate-limited (window from a recent run), Retry-After: ${retryAfter}s`);
        console.log("SKIP  metrics-unauthorized / metrics-authorized: rate window active — rerun after 60s to verify token enforcement");
      } else {
        report("metrics-unauthorized",
          first.status === 401 || first.status === 404,
          `GET /api/admin/metrics without token → ${first.status} (401 = token required, 404 = endpoint off)`);

        if (ADMIN_TOKEN) {
          const res = await fetch(`${BASE_URL}/api/admin/metrics`, {
            headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
          });
          const body = await res.json().catch(() => ({}));
          report("metrics-authorized",
            res.status === 200 && typeof body.environment === "string",
            `GET /api/admin/metrics with token → ${res.status} (environment=${body.environment})`);
        } else {
          console.log("SKIP  metrics-authorized: PDFKIT_ADMIN_METRICS_TOKEN not provided");
        }

        // Exhaust the remaining scope budget (30/min shared with the two
        // requests above — at most 29 more).
        let rateLimited = null;
        let admitted = 0;
        for (let i = 0; i < 30; i++) {
          const res = await fetch(`${BASE_URL}/api/admin/metrics`);
          if (res.status === 429) {
            rateLimited = res;
            break;
          }
          admitted += 1;
        }
        const retryAfter = rateLimited?.headers.get("retry-after");
        report("rate-limit-visible",
          rateLimited !== null && Number(retryAfter) > 0,
          rateLimited
            ? `429 after ${admitted} more admitted requests, Retry-After: ${retryAfter}s`
            : `no 429 within the probe budget (admitted ${admitted}) — scope limit is 30/min`);
      }
    } catch (err) {
      report("rate-limit-visible", false, `metrics/rate-limit probe failed: ${(err).message}`);
    }
  } finally {
    rmSync(fixtures, { recursive: true, force: true });
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} smoke checks passed`);
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("smoke test crashed:", err);
  process.exit(1);
});
