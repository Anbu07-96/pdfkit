#!/usr/bin/env node
/**
 * Phase 64, Steps 5+10 — multi-instance validation harness.
 *
 * Boots REAL shared infrastructure (embedded PostgreSQL 16 + Redis) and TWO
 * production `next start` instances (default ports 3101/3102) against it,
 * then drives controlled traffic through real HTTP requests and asserts the
 * invariants that only show up with shared state:
 *
 *   A. shared-account quota — exact usage across instances, no lost increments
 *   B. shared-IP rate limit — 60/min GLOBAL (not 60 per instance)
 *   C. distributed concurrency cap — global cap 2, no duplicate/leaked slots
 *   D. Retry-After consistency — both instances report the same window
 *   E. Redis outage mid-traffic — visible readiness, fail-closed (no
 *      unlimited mode), recovery after restart
 *   F. DB outage — readiness flips, persistence requests fail safely, no
 *      false accounting success, recovery after restart
 *
 * Everything runs locally (no cloud, no docker): PostgreSQL comes from the
 * embedded-postgres npm package, Redis from a compiled bootstrap binary or
 * PATH. Not a load test — correctness with controlled, legitimate traffic.
 *
 * Usage:
 *   node scripts/infra/multi-instance-validate.mjs            # build + run
 *   node scripts/infra/multi-instance-validate.mjs --skip-build
 */
import { execFile, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import pg from "pg";

const execFileAsync = promisify(execFile);

const ROOT = join(import.meta.dirname, "..", "..");
const PG_PORT = Number(process.env.PDFKIT_HARNESS_PG_PORT ?? 5433);
const REDIS_PORT = Number(process.env.PDFKIT_HARNESS_REDIS_PORT ?? 6399);
const PORT_A = Number(process.env.PDFKIT_HARNESS_PORT_A ?? 3101);
const PORT_B = Number(process.env.PDFKIT_HARNESS_PORT_B ?? 3102);
const ADMIN_TOKEN = `harness-${randomUUID().replace(/-/g, "")}`;

const DATA_DIR = "/tmp/pdfkit-infra/harness-pg";
const FIXTURE_DIR = "/tmp/pdfkit-infra/harness-fixtures";

const { startEmbeddedPostgres } = await import("./postgres.mjs");
const { startRedis, stopRedisByPort, redisCli } = await import("./redis.mjs");

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------
const results = [];
function report(scenario, pass, detail) {
  results.push({ scenario, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  [${scenario}] ${detail}`);
}

// ---------------------------------------------------------------------------
// Fixtures: real PDFs generated with the repository's own pdf-lib
// ---------------------------------------------------------------------------
async function makeFixtures() {
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
  mkdirSync(FIXTURE_DIR, { recursive: true });

  const { PDFDocument, StandardFonts } = await import("pdf-lib");

  // Small one-page PDF (fast merge jobs).
  const small = await PDFDocument.create();
  const font = await small.embedFont(StandardFonts.Helvetica);
  const page = small.addPage([200, 200]);
  page.drawText("pdfkit harness", { x: 20, y: 100, size: 12, font });
  writeFileSync(join(FIXTURE_DIR, "small.pdf"), await small.save());

  // 50-page PDF — the maximum allowed for image conversion
  // (maxConversionPages) and heavy enough for pdf-to-jpg to take multiple
  // seconds (concurrency window) while staying well inside all other limits.
  const heavy = await PDFDocument.create();
  const hFont = await heavy.embedFont(StandardFonts.HelveticaBold);
  for (let i = 0; i < 50; i++) {
    const p = heavy.addPage([612, 792]);
    for (let ring = 0; ring < 40; ring++) {
      p.drawText(`page ${i + 1} ring ${ring} ${"x".repeat(60)}`, {
        x: 10 + ring, y: 20 + ring * 18, size: 9, font: hFont,
      });
    }
  }
  writeFileSync(join(FIXTURE_DIR, "heavy.pdf"), await heavy.save());

  // Garbage bytes (invalid PDF → 422; consumes rate budget, not quota).
  writeFileSync(join(FIXTURE_DIR, "garbage.bin"), Buffer.from("this is not a pdf at all"));
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------
function url(port, path) {
  return `http://127.0.0.1:${port}${path}`;
}

async function waitForServer(port, timeoutMs = 60_000) {
  const started = Date.now();
  for (;;) {
    try {
      const res = await fetch(url(port, "/api/health"), {
        headers: { "x-forwarded-for": "127.0.0.1" },
      });
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() - started > timeoutMs) {
      throw new Error(`instance on :${port} did not become healthy within ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

function formDataWith(fileField, filePath, copies = 1) {
  const form = new FormData();
  const bytes = readFileSync(filePath);
  for (let i = 0; i < copies; i++) {
    form.append(
      "files",
      new Blob([new Uint8Array(bytes)], { type: "application/pdf" }),
      fileField,
    );
  }
  return form;
}

async function postJob(port, fixturePath, ip, toolId = "merge-pdf") {
  // merge-pdf requires at least two files (minFiles: 2).
  const copies = toolId === "merge-pdf" ? 2 : 1;
  const res = await fetch(url(port, `/api/tools/${toolId}`), {
    method: "POST",
    headers: { "x-forwarded-for": ip },
    body: formDataWith("document.pdf", fixturePath, copies),
  });
  let body = null;
  const text = await res.text();
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 200) };
  }
  return { status: res.status, retryAfter: res.headers.get("retry-after"), body };
}

async function getReadiness(port) {
  const res = await fetch(url(port, "/api/health/ready"), {
    headers: { "x-forwarded-for": "127.0.0.1" },
  });
  return { status: res.status, body: await res.json() };
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

/** Current recorded job count for the anonymous user (database truth). */
async function anonJobCount() {
  const admin = new pg.Client({ connectionString: pgInstance.url });
  await admin.connect();
  const usage = await admin.query('SELECT "jobCount" FROM "DailyUsage" WHERE "userId" = $1', ["anon"]);
  await admin.end();
  return Number(usage.rows[0]?.jobCount ?? 0);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
let pgInstance = null;
let redisInstance = null;
let serverA = null;
let serverB = null;
let exiting = false;

async function cleanup() {
  if (exiting) return;
  exiting = true;
  console.log("\n--- cleanup ---");
  for (const [name, child] of [["instance A", serverA], ["instance B", serverB]]) {
    if (child && child.exitCode === null) {
      child.kill("SIGTERM");
      await new Promise((r) => {
        child.once("exit", r);
        setTimeout(r, 8000).unref?.();
      });
      console.log(`stopped ${name}`);
    }
  }
  try {
    if (pgInstance?.running) await pgInstance.stop();
  } catch {
    /* best effort */
  }
  try {
    if (redisInstance) await redisInstance.stop();
  } catch {
    /* best effort */
  }
  console.log("harness infrastructure stopped");
}

process.on("SIGINT", async () => {
  await cleanup();
  process.exit(130);
});

async function main() {
  console.log("Phase 64 multi-instance validation");
  console.log(`  PG : 127.0.0.1:${PG_PORT}   Redis : 127.0.0.1:${REDIS_PORT}`);
  console.log(`  instances: ${PORT_A}, ${PORT_B} (production mode, shared infra)\n`);

  await makeFixtures();
  console.log("fixtures ready (small.pdf, heavy.pdf, garbage.bin)");

  // ----- shared infrastructure -----
  pgInstance = await startEmbeddedPostgres({
    dataDir: DATA_DIR,
    port: PG_PORT,
    database: "pdfkit_harness",
  });
  console.log(`postgres up: ${pgInstance.url}`);

  redisInstance = await startRedis({ port: REDIS_PORT });
  console.log(`redis up: ${redisInstance.url}`);
  await redisCli(REDIS_PORT, ["flushdb"]);

  // ----- build once -----
  if (!process.argv.includes("--skip-build")) {
    console.log("\nbuilding production bundle (next build)...");
    await execFileAsync("npx", ["next", "build"], {
      cwd: ROOT,
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", NODE_ENV: "production" },
      maxBuffer: 64 * 1024 * 1024,
    });
    console.log("build complete");
  } else if (!existsSync(join(ROOT, ".next", "BUILD_ID"))) {
    throw new Error("--skip-build given but no .next/BUILD_ID exists — build first");
  }

  // ----- two production instances sharing the infrastructure -----
  const serverEnv = {
    ...process.env,
    NODE_ENV: "production",
    DATABASE_URL: pgInstance.url,
    PDFKIT_REDIS_URL: redisInstance.url,
    PDFKIT_REDIS_REQUIRED: "true",
    PDFKIT_ADMIN_METRICS_TOKEN: ADMIN_TOKEN,
    PDFKIT_MAX_CONCURRENT_JOBS: "2",
    PDFKIT_RATE_LIMIT_PER_MINUTE: "60",
    PDFKIT_ENVIRONMENT: "harness",
    NEXT_TELEMETRY_DISABLED: "1",
    PORT: "",
  };

  const startInstance = (port) => {
    const child = spawn("npx", ["next", "start", "-p", String(port)], {
      cwd: ROOT,
      env: { ...serverEnv, PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (d) => {
      const line = String(d).trim();
      if (line) console.log(`  [:${port}] ${line}`);
    });
    child.stderr.on("data", (d) => {
      const line = String(d).trim();
      if (line) console.log(`  [:${port}] ${line}`);
    });
    return child;
  };

  serverA = startInstance(PORT_A);
  serverB = startInstance(PORT_B);
  await Promise.all([waitForServer(PORT_A), waitForServer(PORT_B)]);
  console.log("\nboth instances healthy");

  const bothReadyOk = await Promise.all([getReadiness(PORT_A), getReadiness(PORT_B)]);
  const readyOk =
    bothReadyOk.every((r) => r.status === 200 && r.body.status === "ok" &&
      r.body.checks.database.status === "ok" && r.body.checks.redis.status === "ok");
  report("startup", readyOk, `readiness ok on both instances (database+redis ok, environment=${bothReadyOk[0].body.environment})`);
  if (!readyOk) {
    console.log(JSON.stringify(bothReadyOk, null, 2));
  }

  // =========================================================================
  // Scenario C — distributed concurrency cap (run FIRST while quota is fresh)
  // =========================================================================
  {
    console.log("\n[C] distributed concurrency cap (global = 2)");
    // Two heavy jobs, one per instance, fired simultaneously.
    const heavy = [postJob(PORT_A, join(FIXTURE_DIR, "heavy.pdf"), "203.0.113.51", "pdf-to-jpg"),
                   postJob(PORT_B, join(FIXTURE_DIR, "heavy.pdf"), "203.0.113.52", "pdf-to-jpg")];

    // Wait until BOTH slots are actually taken (poll; both jobs must be
    // inside their rasterization phase before the third request fires).
    let counter = 0;
    const pollStart = Date.now();
    while (Date.now() - pollStart < 20_000) {
      counter = Number(await redisCli(REDIS_PORT, ["get", "pdfkit:concurrency:active"]));
      if (counter === 2) break;
      await sleep(100);
    }
    report("C.slot-cap", counter === 2, `concurrency counter = ${counter} while 2 heavy jobs run (expected 2)`);

    // A third job while both are busy must be rejected (SERVER_BUSY 503).
    const third = await postJob(PORT_A, join(FIXTURE_DIR, "small.pdf"), "203.0.113.53");
    const thirdRejected = third.status === 503 && third.body?.error?.code === "SERVER_BUSY";
    report("C.third-rejected", thirdRejected, `third concurrent job rejected: ${third.status} ${third.body?.error?.code}`);

    // Wait for both heavy jobs to finish.
    const [a, b] = await Promise.all(heavy);
    report("C.heavy-done", a.status === 200 && b.status === 200,
      `heavy jobs completed on both instances (${a.status}, ${b.status})`);

    // Slots returned to zero — no leaked slots.
    const after = Number(await redisCli(REDIS_PORT, ["get", "pdfkit:concurrency:active"]));
    report("C.no-leak", after === 0, `concurrency counter after completion = ${after} (expected 0)`);
    console.log(`      [db] anon jobCount after C = ${await anonJobCount()} (heavy jobs recorded: ${a.status === 200 ? 1 : 0}+${b.status === 200 ? 1 : 0})`);
  }

  // =========================================================================
  // Scenario B — shared-IP rate limit: 60/min GLOBAL, not 120
  // =========================================================================
  {
    console.log("\n[B] shared-IP rate limit (global 60/min)");
    const ip = "198.51.100.60";
    // Invalid PDFs: each admitted request consumes rate budget; the job fails
    // with 422 BEFORE any quota is recorded (quota records on success only).
    let admitted = 0;
    let rateLimited = null;
    for (let i = 0; i < 70; i++) {
      const port = i % 2 === 0 ? PORT_A : PORT_B;
      const res = await postJob(port, join(FIXTURE_DIR, "garbage.bin"), ip);
      if (res.status === 429) {
        rateLimited = res;
        break;
      }
      admitted += 1;
    }
    report("B.global-60", admitted === 60 && rateLimited !== null,
      `alternating between instances: ${admitted} admitted (422 invalid-file), then 429 TOO_MANY_REQUESTS`);
    report("B.reject-detail",
      rateLimited?.body?.error?.code === "TOO_MANY_REQUESTS",
      `rate-limit rejection code: ${rateLimited?.body?.error?.code}`);

    // D — Retry-After consistency across instances (same window, same key).
    const [ra, rb] = await Promise.all([
      postJob(PORT_A, join(FIXTURE_DIR, "garbage.bin"), ip),
      postJob(PORT_B, join(FIXTURE_DIR, "garbage.bin"), ip),
    ]);
    const retryA = Number(ra.retryAfter);
    const retryB = Number(rb.retryAfter);
    report("D.retry-after",
      ra.status === 429 && rb.status === 429 && retryA > 0 && retryB > 0 && Math.abs(retryA - retryB) <= 1,
      `Retry-After consistent across instances: A=${retryA}s, B=${retryB}s (same window)`);
  }

  // =========================================================================
  // Scenario E — Redis outage mid-traffic
  // =========================================================================
  {
    console.log("\n[E] Redis outage mid-traffic (PDFKIT_REDIS_REQUIRED=true)");
    await stopRedisByPort(REDIS_PORT);
    await sleep(6_500); // readiness cache is 5s

    const [readyA, readyB] = await Promise.all([getReadiness(PORT_A), getReadiness(PORT_B)]);
    report("E.readiness-visible",
      readyA.status === 503 && readyA.body.checks.redis.status === "failed" &&
      readyB.status === 503 && readyB.body.checks.redis.status === "failed",
      `readiness 503 with redis:failed on both instances (visible, not silent)`);

    // Fail-closed: requests must be rejected (503), never silently unlimited.
    // garbage.bin passes the quota preflight (usage 2/10 at this point), so
    // the request reaches the Redis-backed rate limiter — which must reject.
    const resA = await postJob(PORT_A, join(FIXTURE_DIR, "garbage.bin"), "198.51.100.80");
    report("E.fail-closed",
      resA.status === 503 && resA.body?.error?.code === "USAGE_SERVICE_UNAVAILABLE",
      `processing request rejected safely: ${resA.status} ${resA.body?.error?.code} (no unlimited fallback)`);

    // Admin metrics is itself protected by the (required) Redis rate limiter,
    // so during the outage the whole endpoint fails closed — for unauthenticated
    // AND authenticated callers alike (no information disclosure, no bypass).
    const metricsNoToken = await fetch(url(PORT_A, "/api/admin/metrics"), {
      headers: { "x-forwarded-for": "198.51.100.81" },
    });
    const metricsWithToken = await fetch(url(PORT_A, "/api/admin/metrics"), {
      headers: { authorization: `Bearer ${ADMIN_TOKEN}`, "x-forwarded-for": "198.51.100.81" },
    });
    report("E.metrics-fail-closed",
      metricsNoToken.status === 503 && metricsWithToken.status === 503,
      `metrics during outage fails closed for everyone: no-token=${metricsNoToken.status}, valid-token=${metricsWithToken.status} (both 503, no bypass)`);

    // Restart Redis — the instances must reconnect and recover.
    redisInstance = await startRedis({ port: REDIS_PORT });
    await redisCli(REDIS_PORT, ["flushdb"]);
    await sleep(6_500); // readiness cache + reconnect
    const [recA, recB] = await Promise.all([getReadiness(PORT_A), getReadiness(PORT_B)]);
    report("E.recovery",
      recA.status === 200 && recA.body.checks.redis.status === "ok" &&
      recB.status === 200 && recB.body.checks.redis.status === "ok",
      `redis restart: readiness recovered on both instances`);

    // After recovery the admin surface enforces the token again: 401 without,
    // 200 with (and the snapshot is the in-memory provider — still bounded).
    const m401 = await fetch(url(PORT_A, "/api/admin/metrics"), {
      headers: { "x-forwarded-for": "198.51.100.81" },
    });
    const m200 = await fetch(url(PORT_A, "/api/admin/metrics"), {
      headers: { authorization: `Bearer ${ADMIN_TOKEN}`, "x-forwarded-for": "198.51.100.81" },
    });
    report("E.metrics-token-after-recovery",
      m401.status === 401 && m200.status === 200,
      `after recovery: metrics no-token=${m401.status} (401), valid-token=${m200.status} (200)`);
  }

  // =========================================================================
  // Scenario A — shared-account quota (anonymous, 10 jobs/day)
  // =========================================================================
  {
    console.log("\n[A] shared-account quota across instances (exact accounting)");
    const ip = "198.51.100.70";
    // 8 more jobs (2 quota slots were used by scenario C) alternating instances.
    let successes = 0;
    const anomalies = [];
    for (let i = 0; i < 8; i++) {
      const port = i % 2 === 0 ? PORT_A : PORT_B;
      const res = await postJob(port, join(FIXTURE_DIR, "small.pdf"), ip);
      if (res.status === 200) successes += 1;
      else anomalies.push(`${res.status}:${res.body?.error?.code ?? "?"}`);
    }
    console.log(`      [db] anon jobCount after A fill = ${await anonJobCount()} (expected 10)`);
    report("A.quota-fill", successes === 8,
      `${successes}/8 alternating jobs succeeded (running total ${successes + 2}/10)` +
        (anomalies.length ? ` — anomalies: ${anomalies.join(",")}` : ""));

    // 11th/12th jobs must be rejected on BOTH instances. Sequential on
    // purpose: the quota preflight is a read-then-check (documented, bounded
    // TOCTOU — see postgres.integration.test.ts); racing two requests at the
    // boundary would overshoot by one, which is NOT what this check asserts.
    const rejA = await postJob(PORT_A, join(FIXTURE_DIR, "small.pdf"), ip);
    const rejB = await postJob(PORT_B, join(FIXTURE_DIR, "small.pdf"), ip);
    report("A.quota-reject",
      rejA.body?.error?.code === "QUOTA_EXCEEDED" && rejB.body?.error?.code === "QUOTA_EXCEEDED",
      `quota exceeded on both instances: ${rejA.body?.error?.code} / ${rejB.body?.error?.code}`);

    // Database truth: exactly 10 jobs accounted for the anonymous user.
    const admin = new pg.Client({ connectionString: pgInstance.url });
    await admin.connect();
    const usage = await admin.query(
      'SELECT "jobCount" FROM "DailyUsage" WHERE "userId" = $1',
      ["anon"],
    );
    const account = await admin.query(
      'SELECT "tier", "email" FROM "UserAccount" WHERE "userId" = $1',
      ["anon"],
    );
    await admin.end();
    report("A.exact-usage", usage.rows.length === 1 && usage.rows[0].jobCount === 10,
      `DailyUsage.anon jobCount = ${usage.rows[0]?.jobCount} (expected exactly 10 — no lost increments across instances)`);
    report("A.anon-account",
      account.rows.length === 1 && account.rows[0].tier === "anonymous" && account.rows[0].email === null,
      `anonymous parent account exists with tier=anonymous, email=null (FK regression check)`);
  }

  // =========================================================================
  // Scenario F — Database outage
  // =========================================================================
  {
    console.log("\n[F] Database outage");
    await pgInstance.stop();
    await sleep(6_500); // readiness cache

    const [readyA, readyB] = await Promise.all([getReadiness(PORT_A), getReadiness(PORT_B)]);
    report("F.readiness-visible",
      readyA.status === 503 && readyA.body.checks.database.status === "failed" &&
      readyB.status === 503 && readyB.body.checks.database.status === "failed",
      `readiness 503 with database:failed on both instances`);

    // Persistence requests fail safely — and never claim false success.
    const resA = await postJob(PORT_A, join(FIXTURE_DIR, "small.pdf"), "198.51.100.90");
    report("F.fail-safe",
      resA.status === 503 && resA.body?.error?.code === "USAGE_SERVICE_UNAVAILABLE",
      `job request during DB outage: ${resA.status} ${resA.body?.error?.code} (fails safely, no false success)`);

    // Restart the database — pool reconnects, readiness recovers, and the
    // accounting truth is unchanged (no phantom jobs recorded during outage).
    await pgInstance.start();
    await sleep(6_500);
    const rec = await getReadiness(PORT_A);
    report("F.recovery", rec.status === 200 && rec.body.checks.database.status === "ok",
      `database restart: readiness recovered`);

    const admin = new pg.Client({ connectionString: pgInstance.url });
    await admin.connect();
    const usage = await admin.query('SELECT "jobCount" FROM "DailyUsage" WHERE "userId" = $1', ["anon"]);
    await admin.end();
    report("F.no-false-accounting", usage.rows[0]?.jobCount === 10,
      `after outage+recovery DailyUsage.anon jobCount still = ${usage.rows[0]?.jobCount} (no false accounting)`);
  }

  // ----- final summary -----
  console.log("\n================ VALIDATION SUMMARY ================");
  const failed = results.filter((r) => !r.pass);
  for (const r of results) {
    console.log(`${r.pass ? " ✔" : " ✘"} ${r.scenario.padEnd(24)} ${r.pass ? "" : r.detail}`);
  }
  console.log(`====================================================`);
  console.log(`${results.length - failed.length}/${results.length} checks passed`);
  await cleanup();
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error("\nharness failed:", err);
  await cleanup();
  process.exit(1);
});
