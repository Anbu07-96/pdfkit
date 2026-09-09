#!/usr/bin/env node
/**
 * Phase 65 — local staging stack (provider-neutral reference deployment).
 *
 * Boots the complete staging environment with REAL infrastructure:
 *
 *   PostgreSQL 16 (embedded-postgres npm binaries, persistent data dir)
 *   Redis 7.x (system/compiled bootstrap instance on :6399)
 *   next build (production) unless --skip-build
 *   TWO production instances (next start) on 3101/3102, sharing PG+Redis
 *   staging-proxy on 3080 (round-robin, X-Forwarded-For appending,
 *   CF-Connecting-IP/X-Real-IP stripping)
 *
 * Staging environment semantics (mirrors docs/staging-deployment.md):
 *   NODE_ENV=production, PDFKIT_ENVIRONMENT=staging, DATABASE_URL,
 *   PDFKIT_REDIS_URL, PDFKIT_REDIS_REQUIRED=true, PDFKIT_ADMIN_METRICS_TOKEN
 *   (random per boot, written to the state file, never printed), NEXTAUTH_*
 *   (random secret), PDFKIT_MAX_CONCURRENT_JOBS=2, rate limit 60/min.
 *
 * Usage:
 *   node scripts/infra/staging-up.mjs             # build + boot + verify readiness
 *   node scripts/infra/staging-up.mjs --skip-build
 *   node scripts/infra/staging-up.mjs --reset     # wipe the PG data dir first
 *
 * State (URLs, ports, PIDs, admin token) is written to
 * /tmp/pdfkit-infra/staging-state.json for staging-checks.mjs / staging-down.mjs.
 */
import { execFile, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";
import pg from "pg";

const execFileAsync = promisify(execFile);
const ROOT = join(import.meta.dirname, "..", "..");
const INFRA_DIR = "/tmp/pdfkit-infra";
const STATE_FILE = join(INFRA_DIR, "staging-state.json");

const PG_PORT = 5433;
const REDIS_PORT = 6399;
const PORT_A = 3101;
const PORT_B = 3102;
const PROXY_PORT = 3080;
const PROXY_ADMIN_PORT = 3081;

const { startEmbeddedPostgres } = await import("./postgres.mjs");
const { startRedis } = await import("./redis.mjs");

async function waitForHttp(url, timeoutMs, headers = {}) {
  const started = Date.now();
  for (;;) {
    try {
      const res = await fetch(url, { headers });
      if (res.ok) return;
    } catch {
      /* retry */
    }
    if (Date.now() - started > timeoutMs) throw new Error(`no healthy response from ${url} within ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function stopFromState() {
  // Reuse the robust teardown from staging-down.mjs: process-GROUP kills plus
  // a port sweep — `npx next start` wrappers exit early while their
  // next-server children keep serving on the ports (Phase 65 finding).
  if (!existsSync(STATE_FILE)) return;
  const state = JSON.parse(readFileSync(STATE_FILE, "utf8"));
  const { stopStagingStack } = await import("./staging-down.mjs");
  await stopStagingStack(state);
}

async function main() {
  mkdirSync(INFRA_DIR, { recursive: true });
  await stopFromState();

  const reset = process.argv.includes("--reset");
  const skipBuild = process.argv.includes("--skip-build");

  // ------------------------------------------------------------------ PG ---
  const pgInstance = await startEmbeddedPostgres({
    dataDir: join(INFRA_DIR, "staging-pg"),
    port: PG_PORT,
    database: "pdfkit_staging",
    cleanDataDir: reset,
  });
  console.log(`[staging] postgres up (persistent): ${pgInstance.url}`);

  // Migration history verification (mirror of `prisma migrate deploy` state).
  {
    const client = new pg.Client({ connectionString: pgInstance.url });
    await client.connect();
    const migrations = await client.query(
      "SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY migration_name",
    );
    console.log(`[staging] migration history (${migrations.rows.length}):`);
    for (const row of migrations.rows) {
      console.log(`          ${row.migration_name} (finished ${row.finished_at.toISOString()})`);
    }
    const columns = await client.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'UserAccount'",
    );
    const colNames = columns.rows.map((r) => r.column_name);
    const required = [
      "accountTrustStatus",
      "authProvider",
      "emailVerified",
      "verificationToken",
      "verificationExpires", // Phase 64 migration
      "passwordHash", // Phase 65 migration
      "passwordResetTokenHash", // Phase 66 migration
      "passwordResetExpires", // Phase 66 migration
      "passwordResetAt", // Phase 66 migration
    ];
    for (const col of required) {
      if (!colNames.includes(col)) throw new Error(`staging schema missing column UserAccount.${col}`);
    }
    const indexes = await client.query(
      "SELECT indexname FROM pg_indexes WHERE tablename = 'UserAccount'",
    );
    if (!indexes.rows.some((r) => r.indexname === "UserAccount_email_key")) {
      throw new Error("staging schema missing unique index UserAccount_email_key");
    }
    console.log("[staging] schema verified: Phase 64 verification columns + Phase 65 passwordHash + unique email index present");
    await client.end();
  }

  // --------------------------------------------------------------- Redis ---
  const redisInstance = await startRedis({ port: REDIS_PORT });
  console.log(`[staging] redis up: ${redisInstance.url}`);

  // --------------------------------------------------------------- Build ---
  if (!skipBuild) {
    console.log("[staging] building production bundle…");
    await execFileAsync("npx", ["next", "build"], {
      cwd: ROOT,
      env: {
        ...process.env,
        NEXT_TELEMETRY_DISABLED: "1",
        NODE_ENV: "production",
        NEXT_PUBLIC_SITE_URL: `http://127.0.0.1:${PROXY_PORT}`,
      },
      maxBuffer: 64 * 1024 * 1024,
    });
    console.log("[staging] build complete");
  } else if (!existsSync(join(ROOT, ".next", "BUILD_ID"))) {
    throw new Error("--skip-build given but .next/BUILD_ID is missing");
  }

  // ----------------------------------------------------------- Instances ---
  const adminToken = randomBytes(32).toString("hex");
  const nextAuthSecret = randomBytes(32).toString("hex");
  const stagingEnv = {
    ...process.env,
    NODE_ENV: "production",
    PDFKIT_ENVIRONMENT: "staging",
    DATABASE_URL: pgInstance.url,
    PDFKIT_REDIS_URL: redisInstance.url,
    PDFKIT_REDIS_REQUIRED: "true",
    PDFKIT_ADMIN_METRICS_TOKEN: adminToken,
    PDFKIT_MAX_CONCURRENT_JOBS: "2",
    PDFKIT_RATE_LIMIT_PER_MINUTE: "60",
    NEXTAUTH_SECRET: nextAuthSecret,
    NEXTAUTH_URL: `http://127.0.0.1:${PROXY_PORT}`,
    NEXT_PUBLIC_SITE_URL: `http://127.0.0.1:${PROXY_PORT}`,
    NEXT_TELEMETRY_DISABLED: "1",
  };

  const pids = [];
  const logFiles = [];

  // Detached launch: logs to files; PIDs recorded for staging-down.mjs.
  const { openSync, closeSync } = await import("node:fs");
  const launch = (command, args, env, logFile, name) => {
    const fd = openSync(logFile, "a");
    const child = spawn(command, args, {
      cwd: ROOT,
      env,
      stdio: ["ignore", fd, fd],
      detached: true,
    });
    child.unref();
    closeSync(fd);
    pids.push(child.pid);
    logFiles.push(logFile);
    console.log(`[staging] ${name} started (pid ${child.pid}, log ${logFile})`);
    return child;
  };

  launch("npx", ["next", "start", "-H", "127.0.0.1", "-p", String(PORT_A)], { ...stagingEnv, PORT: String(PORT_A) }, join(INFRA_DIR, "staging-instance-a.log"), `instance A :${PORT_A}`);
  launch("npx", ["next", "start", "-H", "127.0.0.1", "-p", String(PORT_B)], { ...stagingEnv, PORT: String(PORT_B) }, join(INFRA_DIR, "staging-instance-b.log"), `instance B :${PORT_B}`);
  launch("node", [join(ROOT, "scripts/infra/staging-proxy.mjs"), "--port", String(PROXY_PORT), "--target", String(PORT_A), "--target", String(PORT_B)], { ...stagingEnv }, join(INFRA_DIR, "staging-proxy.log"), `staging proxy :${PROXY_PORT}`);

  // ---------------------------------------------------------- Readiness ---
  await waitForHttp(`http://127.0.0.1:${PROXY_PORT}/api/health`, 60_000, { "x-forwarded-for": "127.0.0.1" });
  await new Promise((r) => setTimeout(r, 1000));
  const ready = await fetch(`http://127.0.0.1:${PROXY_PORT}/api/health/ready`, {
    headers: { "x-forwarded-for": "127.0.0.1" },
  });
  const readyBody = await ready.json();
  console.log(`[staging] readiness via proxy: HTTP ${ready.status} status=${readyBody.status}`);
  console.log(`          database=${readyBody.checks?.database?.status} (${readyBody.checks?.database?.latencyMs ?? "?"} ms)`);
  console.log(`          redis=${readyBody.checks?.redis?.status} (${readyBody.checks?.redis?.latencyMs ?? "?"} ms)`);
  console.log(`          processing=${readyBody.checks?.processing?.status} environment=${readyBody.environment}`);

  // ------------------------------------------------------------- State ----
  writeFileSync(
    STATE_FILE,
    JSON.stringify(
      {
        startedAt: new Date().toISOString(),
        proxyUrl: `http://127.0.0.1:${PROXY_PORT}`,
        proxyAdminPort: PROXY_ADMIN_PORT,
        instancePorts: [PORT_A, PORT_B],
        pgUrl: pgInstance.url,
        pgDataDir: join(INFRA_DIR, "staging-pg"),
        redisUrl: redisInstance.url,
        adminToken,
        nextAuthSecret,
        pids,
        logs: {
          instanceA: join(INFRA_DIR, "staging-instance-a.log"),
          instanceB: join(INFRA_DIR, "staging-instance-b.log"),
          proxy: join(INFRA_DIR, "staging-proxy.log"),
        },
      },
      null,
      2,
    ),
  );
  console.log(`[staging] state written to ${STATE_FILE}`);
  console.log(`[staging] READY — proxy ${`http://127.0.0.1:${PROXY_PORT}`} → instances ${PORT_A}/${PORT_B}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[staging] failed:", err);
  process.exit(1);
});
