import "server-only";

import type { BillingConfig } from "@/lib/billing/types";

/**
 * Returns the current Razorpay billing configuration.
 *
 * Safe defaults (isConfigured: false) are returned when environment variables are unset.
 */
export function getBillingConfig(): BillingConfig {
  const razorpayKeyId = process.env.RAZORPAY_KEY_ID ?? null;
  const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET ?? null;
  const razorpayWebhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET ?? null;
  const razorpayProPlanId = process.env.RAZORPAY_PRO_PLAN_ID ?? null;

  const isConfigured = Boolean(
    razorpayKeyId && razorpayKeySecret && razorpayProPlanId,
  );

  return {
    razorpayKeyId,
    razorpayKeySecret,
    razorpayWebhookSecret,
    razorpayProPlanId,
    isConfigured,
  };
}

/**
 * Helper to check whether Razorpay billing integration is active and configured.
 */
export function isBillingConfigured(): boolean {
  return getBillingConfig().isConfigured;
}
