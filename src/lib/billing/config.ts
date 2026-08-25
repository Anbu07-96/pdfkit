import "server-only";

import type { BillingConfig } from "@/lib/billing/types";

/**
 * Returns the current Stripe billing configuration.
 *
 * Safe defaults (isConfigured: false) are returned when environment variables are unset.
 */
export function getBillingConfig(): BillingConfig {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY ?? null;
  const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? null;
  const stripeProPriceId = process.env.STRIPE_PRO_PRICE_ID ?? null;

  const isConfigured = Boolean(stripeSecretKey && stripeProPriceId);

  return {
    stripeSecretKey,
    stripeWebhookSecret,
    stripeProPriceId,
    isConfigured,
  };
}

/**
 * Helper to check whether Stripe integration is active and configured.
 */
export function isStripeConfigured(): boolean {
  return getBillingConfig().isConfigured;
}
