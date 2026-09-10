// @vitest-environment node
import { execFileSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { readEnvironmentLabel, validateEnvironment } from "@/lib/config/environment";

/**
 * Phase 64, Step 7 — centralized environment validation.
 *
 * Contract: error messages name VARIABLE NAMES only. No test (and no
 * production error path) may ever assert on or print a variable VALUE being
 * echoed back — the suite asserts the opposite: values must NOT appear in
 * messages.
 */

function withEnv(env: Record<string, string | undefined>) {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) {
    saved[key] = process.env[key];
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  return () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

describe("validateEnvironment", () => {
  it("accepts a fully-configured production environment", () => {
    const restore = withEnv({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://u:pw@db.internal:5432/pdfkit",
      PDFKIT_REDIS_URL: "redis://cache.internal:6379",
      PDFKIT_ADMIN_METRICS_TOKEN: "a".repeat(32),
      NEXTAUTH_SECRET: "s".repeat(32),
      PDFKIT_ENVIRONMENT: "production-eu-1",
      PDFKIT_USE_IN_MEMORY_USAGE_REPO: undefined,
      PDFKIT_REDIS_REQUIRED: "true",
    });
    const result = validateEnvironment();
    restore();
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.mode).toBe("production");
  });

  it("requires DATABASE_URL in production", () => {
    const restore = withEnv({
      NODE_ENV: "production",
      DATABASE_URL: undefined,
      NEXTAUTH_SECRET: "s".repeat(32),
    });
    const result = validateEnvironment();
    restore();
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.variable)).toContain("DATABASE_URL");
  });

  it("allows missing DATABASE_URL in development (in-memory repo)", () => {
    const restore = withEnv({ NODE_ENV: "development", DATABASE_URL: undefined });
    const result = validateEnvironment();
    restore();
    expect(result.ok).toBe(true);
  });

  it("rejects a non-postgres DATABASE_URL scheme (names the variable only)", () => {
    const restore = withEnv({ NODE_ENV: "development", DATABASE_URL: "mysql://host/db" });
    const result = validateEnvironment();
    restore();
    expect(result.ok).toBe(false);
    const issue = result.errors.find((e) => e.variable === "DATABASE_URL");
    expect(issue).toBeDefined();
    // The value must never be echoed.
    expect(issue?.message.includes("mysql://host/db")).toBe(false);
  });

  it("rejects a non-redis PDFKIT_REDIS_URL scheme", () => {
    const restore = withEnv({ NODE_ENV: "development", PDFKIT_REDIS_URL: "http://cache:6379" });
    const result = validateEnvironment();
    restore();
    expect(result.errors.some((e) => e.variable === "PDFKIT_REDIS_URL")).toBe(true);
  });

  it("errors when PDFKIT_REDIS_REQUIRED=true but no Redis URL is set", () => {
    const restore = withEnv({
      NODE_ENV: "development",
      PDFKIT_REDIS_URL: undefined,
      REDIS_URL: undefined,
      PDFKIT_REDIS_REQUIRED: "true",
    });
    const result = validateEnvironment();
    restore();
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.variable === "PDFKIT_REDIS_URL")).toBe(true);
  });

  it("warns (not errors) when production has no Redis URL and Redis is not required", () => {
    const restore = withEnv({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://u:pw@host:5432/db",
      NEXTAUTH_SECRET: "s".repeat(32),
      PDFKIT_REDIS_URL: undefined,
      REDIS_URL: undefined,
    });
    const result = validateEnvironment();
    restore();
    expect(result.ok).toBe(true);
    expect(result.warnings.some((w) => w.variable === "PDFKIT_REDIS_URL")).toBe(true);
  });

  it("rejects a short admin metrics token", () => {
    const restore = withEnv({ NODE_ENV: "development", PDFKIT_ADMIN_METRICS_TOKEN: "short" });
    const result = validateEnvironment();
    restore();
    expect(result.errors.some((e) => e.variable === "PDFKIT_ADMIN_METRICS_TOKEN")).toBe(true);
  });

  it("rejects placeholder-looking admin metrics tokens", () => {
    const restore = withEnv({
      NODE_ENV: "development",
      PDFKIT_ADMIN_METRICS_TOKEN: "token-aaaaaaaaaaaaaaaaaaaaaaaa",
    });
    const result = validateEnvironment();
    restore();
    expect(result.errors.some((e) => e.variable === "PDFKIT_ADMIN_METRICS_TOKEN")).toBe(true);
  });

  it("warns when PDFKIT_USE_IN_MEMORY_USAGE_REPO=true while DATABASE_URL is set", () => {
    const restore = withEnv({
      NODE_ENV: "development",
      DATABASE_URL: "postgresql://u:pw@host:5432/db",
      PDFKIT_USE_IN_MEMORY_USAGE_REPO: "true",
    });
    const result = validateEnvironment();
    restore();
    expect(result.ok).toBe(true);
    expect(result.warnings.some((w) => w.variable === "PDFKIT_USE_IN_MEMORY_USAGE_REPO")).toBe(true);
  });

  it("warns on unrecognized PDFKIT_PDF_TEXT_DIAGNOSTICS values, accepts approved ones", () => {
    const restore = withEnv({
      NODE_ENV: "development",
      PDFKIT_PDF_TEXT_DIAGNOSTICS: "typo-value",
    });
    const warned = validateEnvironment();
    restore();
    expect(warned.ok).toBe(true); // a warning, never an error
    expect(
      warned.warnings.some((w) => w.variable === "PDFKIT_PDF_TEXT_DIAGNOSTICS"),
    ).toBe(true);

    for (const value of ["on", "off", "1", "0", "true", "false", "disabled", " ON "]) {
      const restoreApproved = withEnv({
        NODE_ENV: "development",
        PDFKIT_PDF_TEXT_DIAGNOSTICS: value,
      });
      const result = validateEnvironment();
      restoreApproved();
      expect(
        result.warnings.some((w) => w.variable === "PDFKIT_PDF_TEXT_DIAGNOSTICS"),
        `value "${value}" should be recognized`,
      ).toBe(false);
    }
  });

  it("requires NEXTAUTH_SECRET in production", () => {
    const restore = withEnv({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://u:pw@host:5432/db",
      NEXTAUTH_SECRET: undefined,
    });
    const result = validateEnvironment();
    restore();
    expect(result.errors.some((e) => e.variable === "NEXTAUTH_SECRET")).toBe(true);
  });

  it("warns when PDFKIT_ENVIRONMENT cannot be sanitized", () => {
    const restore = withEnv({ NODE_ENV: "development", PDFKIT_ENVIRONMENT: "staging://bad" });
    const result = validateEnvironment();
    restore();
    expect(result.warnings.some((w) => w.variable === "PDFKIT_ENVIRONMENT")).toBe(true);
  });
});

describe("readEnvironmentLabel", () => {
  it("returns the sanitized PDFKIT_ENVIRONMENT label", () => {
    vi.stubEnv("PDFKIT_ENVIRONMENT", "staging-eu-1");
    expect(readEnvironmentLabel()).toBe("staging-eu-1");
    vi.unstubAllEnvs();
  });

  it("falls back to unknown for unsanitizable labels", () => {
    vi.stubEnv("PDFKIT_ENVIRONMENT", "staging://bad");
    expect(readEnvironmentLabel()).toBe("unknown");
    vi.unstubAllEnvs();
  });
});

describe("validate-environment.mjs script parity", () => {
  /**
   * scripts/validate-environment.mjs duplicates the rule set (it must run
   * before npm install). This test executes BOTH implementations against the
   * same env matrix and asserts identical verdicts, so the script cannot
   * silently drift from the app-side validator.
   */
  const matrix: Array<Record<string, string | undefined>> = [
    {
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://u:pw@h:5432/d",
      PDFKIT_REDIS_URL: "redis://h:6379",
      PDFKIT_ADMIN_METRICS_TOKEN: "a".repeat(32),
      NEXTAUTH_SECRET: "s".repeat(32),
    },
    { NODE_ENV: "production" },
    { NODE_ENV: "development", DATABASE_URL: "mysql://h/db" },
    { NODE_ENV: "development", PDFKIT_REDIS_URL: "http://h:6379" },
    { NODE_ENV: "development", PDFKIT_REDIS_REQUIRED: "true" },
    { NODE_ENV: "development", PDFKIT_ADMIN_METRICS_TOKEN: "short" },
    { NODE_ENV: "development", PDFKIT_ADMIN_METRICS_TOKEN: "token-aaaaaaaaaaaaaaaaaaaaa" },
    { NODE_ENV: "production", DATABASE_URL: "postgresql://u:pw@h:5432/d", NEXTAUTH_SECRET: "s".repeat(32) },
  ];

  it.each(matrix)("agrees with the script for %#", (env) => {
    const restore = withEnv({
      PDFKIT_REDIS_URL: undefined,
      REDIS_URL: undefined,
      PDFKIT_ADMIN_METRICS_TOKEN: undefined,
      PDFKIT_ENVIRONMENT: undefined,
      PDFKIT_REDIS_REQUIRED: undefined,
      PDFKIT_USE_IN_MEMORY_USAGE_REPO: undefined,
      NEXTAUTH_SECRET: undefined,
      ...env,
    });
    const moduleResult = validateEnvironment();
    restore();

    // Strip every relevant variable, then apply the matrix — the child
    // process must see exactly what the module saw.
    const childEnv: Record<string, string> = {
      // Keep only what node needs to execute; no other variables leak in.
      PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    };
    for (const [key, value] of Object.entries(env)) {
      if (value !== undefined) childEnv[key] = value;
    }

    let scriptOk: boolean | undefined;
    let scriptOutput = "";
    try {
      scriptOutput = execFileSync("node", ["scripts/validate-environment.mjs"], {
        cwd: process.cwd(),
        env: childEnv as NodeJS.ProcessEnv,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      scriptOk = true;
    } catch (err) {
      const e = err as { stdout?: string; status?: number };
      scriptOutput = e.stdout ?? "";
      scriptOk = e.status === 0;
    }

    expect(scriptOk).toBe(moduleResult.ok);
    // Variable names mentioned by the script must be a subset of known
    // variable names (no values leaked).
    const known = [
      "DATABASE_URL",
      "PDFKIT_REDIS_URL",
      "REDIS_URL",
      "PDFKIT_ADMIN_METRICS_TOKEN",
      "PDFKIT_ENVIRONMENT",
      "PDFKIT_REDIS_REQUIRED",
      "PDFKIT_USE_IN_MEMORY_USAGE_REPO",
      "NEXTAUTH_SECRET",
    ];
    const upperWords = scriptOutput.match(/[A-Z][A-Z0-9_]{4,}/g) ?? [];
    for (const word of upperWords) {
      expect(known).toContain(word);
    }
  });
});
