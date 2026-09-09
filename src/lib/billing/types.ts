import "server-only";

import type { UserIdentity } from "@/lib/auth/types";

export interface BillingConfig {
  razorpayKeyId: string | null;
  razorpayKeySecret: string | null;
  razorpayWebhookSecret: string | null;
  razorpayProPlanId: string | null;
  isConfigured: boolean;
  /** Phase 66: disabled | test | live (live requires PDFKIT_BILLING_ALLOW_LIVE=true). */
  mode: BillingMode;
}

/**
 * Billing operating mode. Derived from the Razorpay key prefix
 * (rzp_test_… / rzp_live_…); live additionally requires the explicit
 * PDFKIT_BILLING_ALLOW_LIVE acknowledgment, otherwise the stack runs
 * disabled. Phase 66 validates disabled and test only.
 */
export type BillingMode = "disabled" | "test" | "live";

export interface CheckoutSessionOptions {
  identity: UserIdentity;
  planId: "pro";
}

export interface CheckoutSessionResult {
  subscriptionId: string;
  keyId: string;
  amount: number; // Amount in paise (49900 = ₹499)
  currency: string; // "INR"
  planName: string;
}

export interface VerifyPaymentOptions {
  identity: UserIdentity;
  razorpayPaymentId: string;
  razorpaySubscriptionId: string;
  razorpaySignature: string;
}

export interface VerifyPaymentResult {
  verified: boolean;
  tier: "pro";
}

export interface WebhookResult {
  status: "success" | "ignored" | "error";
  eventType?: string;
  reason?: string;
}
