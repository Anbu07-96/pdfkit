#!/usr/bin/env node
/**
 * Phase 66 — production launch environment validation.
 *
 * Usage:
 *   npm run validate:production
 *   node scripts/validate-production.mjs
 *
 * Checks the FULL production variable surface in categories. Only variable
 * NAMES are ever printed — never values. Exits non-zero when any REQUIRED
 * variable is missing or malformed, so it can gate deployment scripts.
 *
 * Categories:
 *   required      — launch-blocking when missing
 *   conditional   — required only when their feature is being used
 *                   (billing, OAuth providers, email delivery); reported as
 *                   OWNER ACTION items, not hard failures
 *   advisory      — hardening recommendations
 */
const POSTGRES_URL_PATTERN = /^postgres(ql)?:\/\/.+/i;
const REDIS_URL_PATTERN = /^rediss?:\/\/.+/i;
const RAZORPAY_TEST_KEY = /^rzp_test_/;
const RAZORPAY_LIVE_KEY = /^rzp_live_/;

const errors = [];
const ownerActions = [];
const advisories = [];

function has(name) {
  const value = process.env[name];
  return Boolean(value && String(value).trim().length > 0);
}

// ----------------------------------------------------------- Application ---
if (!has("NEXTAUTH_URL") && !has("AUTH_URL")) {
  errors.push("NEXTAUTH_URL is required (the public origin, e.g. https://pdfkit.example — redirects and OAuth callbacks depend on it).");
}
if (!has("NEXTAUTH_SECRET") && !has("AUTH_SECRET")) {
  errors.push("NEXTAUTH_SECRET is required (32+ random bytes; generate with `openssl rand -hex 32`).");
} else {
  const secret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? "";
  if (secret.length < 32) {
    errors.push("NEXTAUTH_SECRET must be at least 32 characters (weak secret).");
  }
  if (/pdfkit-dev-auth-secret-do-not-use-in-production/i.test(secret)) {
    errors.push("NEXTAUTH_SECRET is still the development default — it MUST be replaced for production.");
  }
}
if (!has("NEXT_PUBLIC_SITE_URL")) {
  advisories.push("NEXT_PUBLIC_SITE_URL is unset — email links and canonical URLs will fall back to http://localhost:3000.");
}

// -------------------------------------------------------------- Database ---
if (!has("DATABASE_URL")) {
  errors.push("DATABASE_URL is required (PostgreSQL).");
} else if (!POSTGRES_URL_PATTERN.test(process.env.DATABASE_URL)) {
  errors.push("DATABASE_URL must be a postgresql:// connection string (scheme only is checked; the value is never logged).");
}

// ----------------------------------------------------------------- Redis ---
if (!has("PDFKIT_REDIS_URL") && !has("REDIS_URL")) {
  errors.push("PDFKIT_REDIS_URL is required in production (distributed rate limiting and concurrency protection).");
} else if (
  (process.env.PDFKIT_REDIS_URL ?? process.env.REDIS_URL ?? "") &&
  !REDIS_URL_PATTERN.test(process.env.PDFKIT_REDIS_URL ?? process.env.REDIS_URL)
) {
  errors.push("PDFKIT_REDIS_URL must be a redis:// or rediss:// connection string (scheme only is checked).");
}
if (process.env.PDFKIT_REDIS_REQUIRED !== "true") {
  errors.push("PDFKIT_REDIS_REQUIRED must be 'true' in production — otherwise the stack fails OPEN (protections drop) when Redis is unavailable.");
}
if (process.env.PDFKIT_USE_IN_MEMORY_USAGE_REPO === "true") {
  errors.push("PDFKIT_USE_IN_MEMORY_USAGE_REPO must NOT be 'true' in production (usage would not persist).");
}

// ----------------------------------------------------------- Monitoring ---
if (!has("PDFKIT_ADMIN_METRICS_TOKEN")) {
  errors.push("PDFKIT_ADMIN_METRICS_TOKEN is required (operational metrics; 32+ random bytes).");
} else if ((process.env.PDFKIT_ADMIN_METRICS_TOKEN ?? "").length < 32) {
  errors.push("PDFKIT_ADMIN_METRICS_TOKEN must be at least 32 characters.");
}
if (!has("PDFKIT_ENVIRONMENT")) {
  advisories.push("PDFKIT_ENVIRONMENT is unset — set a short label (e.g. 'production') so metrics identify the deployment.");
}
if (process.env.NODE_ENV !== "production") {
  advisories.push("NODE_ENV should be 'production' for a production launch.");
}

// --------------------------------------------------------------- Billing ---
const billingKey = process.env.RAZORPAY_KEY_ID ?? "";
if (billingKey) {
  if (!has("RAZORPAY_KEY_SECRET") || !has("RAZORPAY_PRO_PLAN_ID")) {
    ownerActions.push("Billing: RAZORPAY_KEY_ID is set but RAZORPAY_KEY_SECRET / RAZORPAY_PRO_PLAN_ID are missing — billing stays DISABLED until all three are present.");
  }
  if (RAZORPAY_LIVE_KEY.test(billingKey)) {
    if (process.env.PDFKIT_BILLING_ALLOW_LIVE === "true") {
      ownerActions.push("Billing: LIVE mode armed (live keys + PDFKIT_BILLING_ALLOW_LIVE=true). Confirm this is intentional and that webhook + plan IDs are the LIVE ones before opening traffic.");
    } else {
      ownerActions.push("Billing: live Razorpay keys are set WITHOUT PDFKIT_BILLING_ALLOW_LIVE — billing runs DISABLED by design (fail-closed).");
    }
  } else if (RAZORPAY_TEST_KEY.test(billingKey)) {
    advisories.push("Billing: TEST mode (rzp_test_ keys). Fine for validation; live launch requires live keys + PDFKIT_BILLING_ALLOW_LIVE=true.");
  } else {
    ownerActions.push("Billing: RAZORPAY_KEY_ID has an unrecognized format (expected rzp_test_… or rzp_live_…) — billing stays DISABLED.");
  }
  if (!has("RAZORPAY_WEBHOOK_SECRET")) {
    ownerActions.push("Billing: RAZORPAY_WEBHOOK_SECRET is unset — subscription webhooks cannot be verified (entitlement sync disabled).");
  }
} else {
  ownerActions.push("Billing: RAZORPAY_* variables are unset — billing is DISABLED. Required before selling subscriptions.");
}

// ----------------------------------------------------------------- OAuth ---
if (has("GOOGLE_CLIENT_ID") !== has("GOOGLE_CLIENT_SECRET")) {
  ownerActions.push("OAuth: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set TOGETHER (Google provider stays off otherwise).");
} else if (has("GOOGLE_CLIENT_ID")) {
  advisories.push("OAuth: Google enabled — verify the redirect URI in the Google console matches {NEXTAUTH_URL}/api/auth/callback/google.");
}
if (
  has("AZURE_AD_CLIENT_ID") !== has("AZURE_AD_CLIENT_SECRET") &&
  has("MICROSOFT_CLIENT_ID") !== has("MICROSOFT_CLIENT_SECRET")
) {
  ownerActions.push("OAuth: AZURE_AD_CLIENT_ID and AZURE_AD_CLIENT_SECRET must be set TOGETHER (Microsoft provider stays off otherwise).");
} else if (has("AZURE_AD_CLIENT_ID") || has("MICROSOFT_CLIENT_ID")) {
  advisories.push("OAuth: Microsoft enabled — verify the redirect URI in Azure matches {NEXTAUTH_URL}/api/auth/callback/azure-ad.");
}

// ------------------------------------------------------------------ Email ---
if (!has("SMTP_HOST")) {
  ownerActions.push("Email: SMTP_HOST is unset — verification and password-reset email CANNOT be delivered in production (the reset route fails closed). Required before public launch.");
} else {
  if (!has("SMTP_FROM")) {
    advisories.push("Email: SMTP_FROM is unset — the sender address falls back to SMTP_USER; set an explicit verified sender.");
  }
  advisories.push("Email: confirm SPF, DKIM and DMARC records are published for the sending domain (see docs/email-production-setup.md).");
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
console.log("=== PDFKit production environment validation ===\n");

if (errors.length > 0) {
  console.log(`ERRORS (${errors.length}) — launch-blocking:`);
  for (const e of errors) console.log(`  ✗ ${e}`);
} else {
  console.log("ERRORS (0): all required variables present and well-formed.");
}

if (ownerActions.length > 0) {
  console.log(`\nOWNER ACTIONS (${ownerActions.length}) — required before the related feature launches:`);
  for (const o of ownerActions) console.log(`  ! ${o}`);
} else {
  console.log("\nOWNER ACTIONS (0).");
}

if (advisories.length > 0) {
  console.log(`\nADVISORIES (${advisories.length}):`);
  for (const a of advisories) console.log(`  · ${a}`);
}

console.log("\nValues are never printed — variable names only.");
process.exit(errors.length > 0 ? 1 : 0);
