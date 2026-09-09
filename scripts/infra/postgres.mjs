/**
 * Phase 64 infrastructure helper: embedded PostgreSQL lifecycle.
 *
 * Boots the npm-distributed PostgreSQL 16 binaries (embedded-postgres, no
 * apt/docker needed) with a workaround for the hard-coded en_US.UTF-8 locale
 * (`--lc-messages=C`), applies the repository's prisma migrations, and tears
 * everything down on exit. Used by integration tests
 * (PDFKIT_TEST_DATABASE_URL) and the multi-instance validation harness.
 */
import { execFile } from "node:child_process";
import { randomUUID as _cryptoRandomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import pg from "pg";

const execFileAsync = promisify(execFile);

const ROOT = join(import.meta.dirname, "..", "..");

const MIGRATIONS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS _prisma_migrations (
  id VARCHAR(36) PRIMARY KEY,
  checksum VARCHAR(64) NOT NULL,
  finished_at TIMESTAMPTZ,
  applied_steps_count INT NOT NULL DEFAULT 0,
  rolled_back_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  migration_name VARCHAR(255)
)`;

function nativeBinDir() {
  // embedded-postgres ships platform packages; linux-x64 is what this
  // sandbox provides. On other platforms the equivalent dir is used.
  const candidates = [
    join(ROOT, "node_modules", "@embedded-postgres", "linux-x64", "native", "bin"),
    join(ROOT, "node_modules", "@embedded-postgres", "darwin-arm64", "native", "bin"),
    join(ROOT, "node_modules", "@embedded-postgres", "darwin-x64", "native", "bin"),
  ];
  for (const dir of candidates) {
    if (existsSync(join(dir, "initdb"))) return dir;
  }
  throw new Error(
    "embedded-postgres native binaries not found — run `npm install` first " +
      "(embedded-postgres is a devDependency; no system PostgreSQL required).",
  );
}

/**
 * @typedef {Object} PostgresInstance
 * @property {string} url connection string for the created database
 * @property {string} adminUrl connection string to the "postgres" db
 * @property {() => Promise<void>} stop fast shutdown (SIGINT) and wait
 * @property {() => Promise<void>} start start again after stop (same data dir)
 * @property {() => boolean} running whether the postmaster process is alive
 */

/**
 * Start an embedded PostgreSQL, create a fresh database and apply migrations.
 *
 * @param {object} options
 * @param {string} options.dataDir writable directory for the cluster data
 * @param {number} options.port
 * @param {string} [options.database] database name (default "pdfkit_test")
 * @param {boolean} [options.cleanDataDir] wipe an existing data dir (default true)
 * @returns {Promise<PostgresInstance>}
 */
export async function startEmbeddedPostgres(options) {
  const { dataDir, port, database = "pdfkit_test", cleanDataDir = true } = options;
  const bin = nativeBinDir();

  if (cleanDataDir && existsSync(dataDir)) {
    rmSync(dataDir, { recursive: true, force: true });
  }

  const alreadyInitialized = existsSync(join(dataDir, "PG_VERSION"));

  if (!alreadyInitialized) {
    mkdirSync(dataDir, { recursive: true });

    // initdb — the embedded-postgres library hard-codes
    // --lc-messages=en_US.UTF-8 which fails on systems without that locale;
    // --lc-messages=C always exists. The password goes through a temporary
    // pwfile (0600): /dev/stdin is not readable when stdin is closed
    // (non-interactive sandboxes/CI).
    const pwFile = join(dataDir, "..", `.pgpw-${port}-${Date.now()}`);
    writeFileSync(pwFile, "pdfkit\n");
    chmodSync(pwFile, 0o600);
    try {
      await execFileAsync(join(bin, "initdb"), [
        "-D", dataDir,
        "-U", "pdfkit",
        "--pwfile", pwFile,
        "--auth-local", "trust",
        "--auth-host", "scram-sha-256",
        "--lc-messages=C",
        "--encoding=UTF8",
      ]);
    } finally {
      rmSync(pwFile, { force: true });
    }
  }

  const url = `postgresql://pdfkit:pdfkit@127.0.0.1:${port}/${database}`;
  const adminUrl = `postgresql://pdfkit:pdfkit@127.0.0.1:${port}/postgres`;

  const spawnPostgres = () =>
    execFile(join(bin, "postgres"), [
      "-D", dataDir,
      "-p", String(port),
      "-c", "listen_addresses=127.0.0.1",
      "-c", "unix_socket_directories=",
    ]);

  async function waitReady(child) {
    const startedAt = Date.now();
    let lastStderr = "";
    child.stderr?.on("data", (d) => {
      lastStderr = String(d).trim();
    });
    for (;;) {
      if (child.exitCode !== null) {
        throw new Error(`postgres exited with code ${child.exitCode}. stderr: ${lastStderr}`);
      }
      try {
        const client = new pg.Client({ connectionString: adminUrl });
        await client.connect();
        await client.query("SELECT 1");
        await client.end();
        return;
      } catch {
        if (Date.now() - startedAt > 30_000) {
          child.kill("SIGTERM");
          throw new Error("postgres did not become ready within 30s");
        }
        await new Promise((r) => setTimeout(r, 200));
      }
    }
  }

  // Start postgres directly (pg_ctl adds process-tree complications).
  let postgres = spawnPostgres();
  await waitReady(postgres);

  // Create the test database.
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${database}"`).catch((err) => {
    if (!String(err.message).includes("already exists")) throw err;
  });

  // Apply prisma migrations in order, mirroring `prisma migrate deploy`:
  // one _prisma_migrations bookkeeping table, then each migration's SQL.
  await admin.query(MIGRATIONS_TABLE_SQL);
  await admin.end();

  const migrationsDir = join(ROOT, "prisma", "migrations");
  const migrations = readdirSync(migrationsDir)
    .filter((name) => existsSync(join(migrationsDir, name, "migration.sql")))
    .sort();
  if (migrations.length === 0) throw new Error("no prisma migrations found");

  const db = new pg.Client({ connectionString: url });
  await db.connect();
  await db.query(MIGRATIONS_TABLE_SQL);
  for (const name of migrations) {
    // Idempotent: skip migrations the bookkeeping table already recorded
    // (mirrors `prisma migrate deploy` on an up-to-date database).
    const applied = await db.query(
      "SELECT id FROM _prisma_migrations WHERE migration_name = $1",
      [name],
    );
    if (applied.rowCount > 0) continue;
    const sql = readFileSync(join(migrationsDir, name, "migration.sql"), "utf8");
    await db.query(sql);
    await db.query(
      "INSERT INTO _prisma_migrations (id, checksum, finished_at, applied_steps_count, migration_name) VALUES ($1, $2, now(), 1, $3)",
      [_cryptoRandomUUID(), "harness-applied", name],
    );
  }
  await db.end();

  async function stopPostgres() {
    postgres.kill("SIGINT"); // fast shutdown: in-flight queries aborted, clean exit
    await new Promise((resolve) => {
      postgres.once("exit", resolve);
      setTimeout(resolve, 10_000).unref?.();
    });
  }

  async function startPostgres() {
    postgres = spawnPostgres();
    await waitReady(postgres);
  }

  return {
    url,
    adminUrl,
    stop: stopPostgres,
    start: startPostgres,
    get running() {
      return postgres.exitCode === null;
    },
  };
}
