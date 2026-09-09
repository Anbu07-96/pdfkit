import "server-only";

import type { BillingConfig, BillingMode } from "@/lib/billing/types";

/**
 * Razorpay billing configuration (Phase 46C; modes added in Phase 66).
 *
 * Modes:
 *  - "disabled": any required variable missing — checkout answers a clean
 *    "billing not configured" error and nothing else changes.
 *  - "test": a Razorpay TEST key pair (rzp_test_…). Safe for end-to-end
 *    validation; no real money can move.
 *  - "live": a Razorpay LIVE key pair (rzp_live_…) AND the explicit
 *    PDFKIT_BILLING_ALLOW_LIVE=true acknowledgment. Live mode is a deliberate
 *    two-key decision (key material + owner acknowledgment) so a leaked or
 *    accidentally-set live key alone can never silently enable real charges.
 *
 * The mode is derived from the key prefix Razorpay itself guarantees
 * (test keys always start with rzp_test_, live keys with rzp_live_), not from
 * a self-declared flag.
 */
export function getBillingConfig(): BillingConfig {
  const razorpayKeyId = process.env.RAZORPAY_KEY_ID ?? null;
  const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET ?? null;
  const razorpayWebhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET ?? null;
  const razorpayProPlanId = process.env.RAZORPAY_PRO_PLAN_ID ?? null;

  const isConfigured = Boolean(
    razorpayKeyId && razorpayKeySecret && razorpayProPlanId,
  );

  let mode: BillingMode = "disabled";
  if (isConfigured && razorpayKeyId) {
    if (razorpayKeyId.startsWith("rzp_test_")) {
      mode = "test";
    } else if (razorpayKeyId.startsWith("rzp_live_")) {
      // Fail-closed: live keys without the explicit acknowledgment run in
      // "disabled" — no checkout, no verification, no charges.
      mode =
        process.env.PDFKIT_BILLING_ALLOW_LIVE === "true" ? "live" : "disabled";
    } else {
      // Unrecognized key format — treat as disabled rather than guess.
      mode = "disabled";
    }
  }

  return {
    razorpayKeyId,
    razorpayKeySecret,
    razorpayWebhookSecret,
    razorpayProPlanId,
    isConfigured: isConfigured && mode !== "disabled",
    mode,
  };
}

/**
 * Helper to check whether Razorpay billing integration is active and configured.
 */
export function isBillingConfigured(): boolean {
  return getBillingConfig().isConfigured;
}

/**
 * Human-readable label for UI/diagnostics (never includes key material).
 */
export function getBillingModeLabel(): string {
  switch (getBillingConfig().mode) {
    case "test":
      return "test";
    case "live":
      return "live";
    default:
      return "disabled";
  }
}
