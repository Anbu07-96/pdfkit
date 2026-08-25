import "server-only";

import Stripe from "stripe";
import { getBillingConfig } from "@/lib/billing/config";
import { ProcessingError } from "@/lib/processing/errors";

let stripeClientInstance: Stripe | null = null;

/**
 * Returns lazy Stripe SDK client instance.
 *
 * Throws a user-safe ProcessingError if STRIPE_SECRET_KEY is not configured.
 */
export function getStripeClient(): Stripe {
  if (stripeClientInstance) {
    return stripeClientInstance;
  }

  const { stripeSecretKey } = getBillingConfig();

  if (!stripeSecretKey) {
    throw new ProcessingError(
      "VALIDATION_ERROR",
      "Stripe payment service is not configured.",
    );
  }

  stripeClientInstance = new Stripe(stripeSecretKey, {
    apiVersion: "2025-02-24.acacia" as Stripe.LatestApiVersion,
  });

  return stripeClientInstance;
}

/**
 * Set explicit Stripe client instance (used for unit testing with mocks).
 */
export function setStripeClientOverride(client: Stripe | null): void {
  stripeClientInstance = client;
}
