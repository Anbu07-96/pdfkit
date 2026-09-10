import "server-only";

/**
 * Centralized environment variable validation (Phase 64, Step 7).
 *
 * Rules:
 * - Error/warning messages name VARIABLE NAMES only — never values, never
 *   connection strings, never secrets.
 * - Production/staging requirements differ from development: dev may run
 *   unconfigured (in-memory usage repository, no Redis), production must
 *   configure persistence and cannot require-Redis without a URL.
 * - No invented configuration: only variables that already exist in the
 *   codebase are validated (DATABASE_URL, PDFKIT_REDIS_URL/REDIS_URL,
 *   PDFKIT_REDIS_REQUIRED, PDFKIT_ADMIN_METRICS_TOKEN, PDFKIT_ENVIRONMENT,
 *   NODE_ENV, PDFKIT_USE_IN_MEMORY_USAGE_REPO,
 *   PDFKIT_PDF_TO_TEXT_ENGINE (Phase 73 manual engine gating),
 *   PDFKIT_PDF_TEXT_DIAGNOSTICS (Phase 74 engine diagnostics)).
 *
 * Consumers: scripts/validate-environment.mjs (staging pre-deploy check),
 * unit tests, and docs/staging-deployment.md. The app itself stays
 * fail-closed at the point of use (repository/hardening layers).
 */

export interface EnvironmentIssue {
  /** Variable name involved (never a value). */
  variable: string;
  /** "error" blocks a staging/production deploy; "warning" degrades. */
  severity: "error" | "warning";
  message: string;
}

export interface EnvironmentValidationResult {
  mode: "production" | "development";
  ok: boolean;
  errors: EnvironmentIssue[];
  warnings: EnvironmentIssue[];
}

const POSTGRES_URL_PATTERN = /^postgres(ql)?:\/\/.+/i;
const REDIS_URL_PATTERN = /^rediss?:\/\/.+/i;
const ENVIRONMENT_LABEL_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,31}$/;

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

function parsePortFromUrl(raw: string | undefined, variable: string): EnvironmentIssue | null {
  // Sanity check for copy-paste mistakes like an http:// URL in DATABASE_URL
  // or a ws:// URL in PDFKIT_REDIS_URL. Names only — the URL is never echoed.
  if (!raw) return null;
  if (variable === "DATABASE_URL" && !POSTGRES_URL_PATTERN.test(raw)) {
    return {
      variable,
      severity: "error",
      message: `${variable} must be a postgresql:// connection string (scheme only is checked; the value is never logged).`,
    };
  }
  const redisVars = ["PDFKIT_REDIS_URL", "REDIS_URL"];
  if (redisVars.includes(variable) && !REDIS_URL_PATTERN.test(raw)) {
    return {
      variable,
      severity: "error",
      message: `${variable} must be a redis:// or rediss:// connection string (scheme only is checked; the value is never logged).`,
    };
  }
  return null;
}

/**
 * Validate the environment. Pure function of process.env — safe to call in
 * tests and scripts; performs no network I/O.
 */
export function validateEnvironment(): EnvironmentValidationResult {
  const errors: EnvironmentIssue[] = [];
  const warnings: EnvironmentIssue[] = [];
  const production = isProduction();

  const dbUrl = process.env.DATABASE_URL;
  const redisUrl = process.env.PDFKIT_REDIS_URL ?? process.env.REDIS_URL;
  const adminToken = process.env.PDFKIT_ADMIN_METRICS_TOKEN;
  const environmentLabel = process.env.PDFKIT_ENVIRONMENT;
  const redisRequired = process.env.PDFKIT_REDIS_REQUIRED === "true";
  const forceInMemory = process.env.PDFKIT_USE_IN_MEMORY_USAGE_REPO === "true";

  // --- DATABASE_URL -------------------------------------------------------
  if (dbUrl) {
    const issue = parsePortFromUrl(dbUrl, "DATABASE_URL");
    if (issue) errors.push(issue);
    if (forceInMemory) {
      warnings.push({
        variable: "PDFKIT_USE_IN_MEMORY_USAGE_REPO",
        severity: "warning",
        message:
          "PDFKIT_USE_IN_MEMORY_USAGE_REPO=true forces the in-memory usage repository even though DATABASE_URL is set — usage metering will not persist and will reset on restart. Never use this in staging/production.",
      });
    }
  } else if (production) {
    errors.push({
      variable: "DATABASE_URL",
      severity: "error",
      message:
        "DATABASE_URL is required in production: without it every usage/persistence call fails closed (USAGE_SERVICE_UNAVAILABLE). Development may omit it to use the in-memory repository.",
    });
  }

  // --- Redis --------------------------------------------------------------
  if (redisUrl) {
    const issue = parsePortFromUrl(redisUrl, process.env.PDFKIT_REDIS_URL ? "PDFKIT_REDIS_URL" : "REDIS_URL");
    if (issue) errors.push(issue);
  } else if (redisRequired) {
    errors.push({
      variable: "PDFKIT_REDIS_URL",
      severity: "error",
      message:
        "PDFKIT_REDIS_REQUIRED=true but no Redis URL is configured (PDFKIT_REDIS_URL or REDIS_URL). Global protections (IP rate limit, concurrency cap) would reject all traffic — configure a URL or unset PDFKIT_REDIS_REQUIRED.",
    });
  } else if (production) {
    warnings.push({
      variable: "PDFKIT_REDIS_URL",
      severity: "warning",
      message:
        "No Redis URL configured in production: rate limiting and the concurrency cap fall back to per-process state, which is only correct for single-instance deployments.",
    });
  }

  // --- Admin metrics token ------------------------------------------------
  if (adminToken) {
    if (adminToken.length < 16) {
      errors.push({
        variable: "PDFKIT_ADMIN_METRICS_TOKEN",
        severity: "error",
        message:
          "PDFKIT_ADMIN_METRICS_TOKEN must be at least 16 characters (length only is checked; the value is never logged). Unset it to disable the admin metrics endpoint entirely.",
      });
    }
    if (/^(token|secret|password|changeme|test)/i.test(adminToken)) {
      errors.push({
        variable: "PDFKIT_ADMIN_METRICS_TOKEN",
        severity: "error",
        message:
          "PDFKIT_ADMIN_METRICS_TOKEN looks like a placeholder value. Generate a high-entropy token (the value is never logged).",
      });
    }
  }

  // --- Environment label --------------------------------------------------
  if (environmentLabel && !ENVIRONMENT_LABEL_PATTERN.test(environmentLabel)) {
    warnings.push({
      variable: "PDFKIT_ENVIRONMENT",
      severity: "warning",
      message:
        "PDFKIT_ENVIRONMENT contains characters outside [a-zA-Z0-9._-] (max 32 chars); the sanitized environment report will show \"unknown\" instead.",
    });
  }

  // --- Phase 73 manual engine gating ---------------------------------------
  // Fail-closed at the point of use: an unrecognized value selects the
  // default engine. This check is operator visibility only (a warning, not
  // an error — an experimental flag typo must not block a deploy), and it
  // names the VARIABLE only, never the value.
  const pdfToTextEngine = process.env.PDFKIT_PDF_TO_TEXT_ENGINE;
  if (
    pdfToTextEngine !== undefined &&
    !["current", "pdfjs"].includes(pdfToTextEngine.trim().toLowerCase())
  ) {
    warnings.push({
      variable: "PDFKIT_PDF_TO_TEXT_ENGINE",
      severity: "warning",
      message:
        "PDFKIT_PDF_TO_TEXT_ENGINE is set but is not one of the approved values (current, pdfjs); engine selection fails closed to the default pdfium engine. Check the spelling.",
    });
  }

  // --- PDFKIT_PDF_TEXT_DIAGNOSTICS (Phase 74 engine diagnostics) ---------
  // Operator visibility only (a warning, never an error): the engine
  // diagnostics are behavior-neutral and privacy-safe, so an unrecognized
  // value keeps them ENABLED (fail-open — a typo must not silently destroy
  // the evidence record; the engine-selection gate fails CLOSED by design).
  // Names the VARIABLE only, never the value.
  const pdfTextDiagnostics = process.env.PDFKIT_PDF_TEXT_DIAGNOSTICS;
  if (
    pdfTextDiagnostics !== undefined &&
    !["on", "off", "1", "0", "true", "false", "disabled"].includes(
      pdfTextDiagnostics.trim().toLowerCase(),
    )
  ) {
    warnings.push({
      variable: "PDFKIT_PDF_TEXT_DIAGNOSTICS",
      severity: "warning",
      message:
        "PDFKIT_PDF_TEXT_DIAGNOSTICS is set but is not one of the approved values (on, off); engine diagnostics stay enabled. Check the spelling.",
    });
  }

  // --- NEXTAUTH_SECRET (production auth) ----------------------------------
  if (production && !process.env.NEXTAUTH_SECRET) {
    errors.push({
      variable: "NEXTAUTH_SECRET",
      severity: "error",
      message:
        "NEXTAUTH_SECRET is required in production for NextAuth session signing (development uses an auto-generated secret).",
    });
  }

  return {
    mode: production ? "production" : "development",
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Sanitized environment identifier for readiness/metrics payloads.
 * Never a secret, connection string or URL — mirrors the metrics provider.
 */
export function readEnvironmentLabel(): string {
  const raw = process.env.PDFKIT_ENVIRONMENT ?? process.env.NODE_ENV ?? "unknown";
  return ENVIRONMENT_LABEL_PATTERN.test(raw) ? raw : "unknown";
}
