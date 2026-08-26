import "server-only";

import type { UserIdentity } from "@/lib/auth/types";

export interface BillingConfig {
  razorpayKeyId: string | null;
  razorpayKeySecret: string | null;
  razorpayWebhookSecret: string | null;
  razorpayProPlanId: string | null;
  isConfigured: boolean;
}

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
