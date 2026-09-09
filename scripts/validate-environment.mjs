#!/usr/bin/env node
/**
 * Environment validation for staging/production deploys (Phase 64, Step 7).
 *
 * Usage:
 *   node scripts/validate-environment.mjs
 *   NODE_ENV=production node scripts/validate-environment.mjs
 *
 * Exits non-zero when any environment error is found (e.g. missing
 * DATABASE_URL in production, malformed connection-string scheme, weak
 * admin token). Messages name VARIABLE NAMES only — values are never
 * printed.
 *
 * Why the rules are duplicated from src/lib/config/environment.ts instead of
 * imported: this script must run on a freshly-cloned machine BEFORE
 * `npm install` (pre-deploy sanity check), where the TS module, its path
 * aliases and its "server-only" import are not resolvable. Drift is guarded
 * by src/lib/config/environment.test.ts, which executes BOTH implementations
 * against the same env-var matrix and asserts identical verdicts.
 */
const POSTGRES_URL_PATTERN = /^postgres(ql)?:\/\/.+/i;
const REDIS_URL_PATTERN = /^rediss?:\/\//i;
const ENVIRONMENT_LABEL_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,31}$/;

const production = process.env.NODE_ENV === "production";
const dbUrl = process.env.DATABASE_URL;
const redisUrl = process.env.PDFKIT_REDIS_URL ?? process.env.REDIS_URL;
const adminToken = process.env.PDFKIT_ADMIN_METRICS_TOKEN;
const environmentLabel = process.env.PDFKIT_ENVIRONMENT;
const redisRequired = process.env.PDFKIT_REDIS_REQUIRED === "true";
const forceInMemory = process.env.PDFKIT_USE_IN_MEMORY_USAGE_REPO === "true";

const errors = [];
const warnings = [];

if (dbUrl && !POSTGRES_URL_PATTERN.test(dbUrl)) {
  errors.push("DATABASE_URL must be a postgresql:// connection string (scheme only is checked; the value is never logged).");
}
if (redisUrl && !REDIS_URL_PATTERN.test(redisUrl)) {
  errors.push(
    (process.env.PDFKIT_REDIS_URL ? "PDFKIT_REDIS_URL" : "REDIS_URL") +
      " must be a redis:// or rediss:// connection string (scheme only is checked; the value is never logged).",
  );
}
if (forceInMemory && (dbUrl || production)) {
  warnings.push(
    "PDFKIT_USE_IN_MEMORY_USAGE_REPO=true forces the in-memory usage repository — usage metering will not persist. Never use this in staging/production.",
  );
}
if (!dbUrl && production) {
  errors.push(
    "DATABASE_URL is required in production: without it every usage/persistence call fails closed (USAGE_SERVICE_UNAVAILABLE).",
  );
}
if (!redisUrl && redisRequired) {
  errors.push(
    "PDFKIT_REDIS_REQUIRED=true but no Redis URL is configured (PDFKIT_REDIS_URL or REDIS_URL).",
  );
} else if (!redisUrl && production) {
  warnings.push(
    "No Redis URL configured in production: rate limiting and the concurrency cap fall back to per-process state (single-instance only).",
  );
}
if (adminToken) {
  if (adminToken.length < 16) {
    errors.push("PDFKIT_ADMIN_METRICS_TOKEN must be at least 16 characters (length only is checked; the value is never logged).");
  }
  if (/^(token|secret|password|changeme|test)/i.test(adminToken)) {
    errors.push("PDFKIT_ADMIN_METRICS_TOKEN looks like a placeholder value. Generate a high-entropy token.");
  }
}
if (environmentLabel && !ENVIRONMENT_LABEL_PATTERN.test(environmentLabel)) {
  warnings.push('PDFKIT_ENVIRONMENT contains characters outside [a-zA-Z0-9._-]; readiness will report "unknown".');
}
if (production && !process.env.NEXTAUTH_SECRET) {
  errors.push("NEXTAUTH_SECRET is required in production for NextAuth session signing.");
}

console.log(`Environment validation (${production ? "production" : "development"} mode)`);
for (const w of warnings) console.warn(`  [warn] ${w}`);
if (errors.length > 0) {
  for (const e of errors) console.error(`  [error] ${e}`);
  console.error(`Environment validation FAILED: ${errors.length} error(s), ${warnings.length} warning(s).`);
  process.exit(1);
}
console.log(`Environment validation OK (${warnings.length} warning(s)).`);
