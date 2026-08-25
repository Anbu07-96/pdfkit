import "server-only";

import type { UserIdentity } from "@/lib/auth/types";

export interface BillingConfig {
  stripeSecretKey: string | null;
  stripeWebhookSecret: string | null;
  stripeProPriceId: string | null;
  isConfigured: boolean;
}

export interface CheckoutSessionOptions {
  identity: UserIdentity;
  planId: "pro";
  successUrl?: string;
  cancelUrl?: string;
}

export interface CheckoutSessionResult {
  sessionId: string;
  url: string;
}

export interface WebhookResult {
  status: "success" | "ignored" | "error";
  eventType?: string;
  reason?: string;
}
