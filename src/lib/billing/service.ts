import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { getBillingConfig } from "@/lib/billing/config";
import { getRazorpayClient } from "@/lib/billing/razorpay";
import type {
  CheckoutSessionOptions,
  CheckoutSessionResult,
  VerifyPaymentOptions,
  VerifyPaymentResult,
  WebhookResult,
} from "@/lib/billing/types";
import { ProcessingError } from "@/lib/processing/errors";
import { getUsageRepository } from "@/lib/usage/repository";
import type { UsageRepository } from "@/lib/usage/types";

/**
 * Server-only Razorpay Billing Service for PDFKit.
 *
 * Provides provider-isolated billing management for checkout sessions,
 * payment signature verification, and Razorpay webhook synchronization.
 */
export class BillingService {
  private repo: UsageRepository;

  constructor(repo = getUsageRepository()) {
    this.repo = repo;
  }

  /**
   * Create a Razorpay subscription checkout session for upgrading an authenticated user to PRO.
   */
  async createCheckoutSession(
    options: CheckoutSessionOptions,
  ): Promise<CheckoutSessionResult> {
    const { identity, planId } = options;

    if (!identity.isAuthenticated || identity.userId === "anon") {
      throw new ProcessingError(
        "VALIDATION_ERROR",
        "You must be signed in to upgrade your account plan.",
      );
    }

    if (planId !== "pro") {
      throw new ProcessingError(
        "VALIDATION_ERROR",
        "Only the PRO plan upgrade is currently supported.",
      );
    }

    const config = getBillingConfig();
    if (!config.isConfigured || !config.razorpayProPlanId || !config.razorpayKeyId) {
      throw new ProcessingError(
        "VALIDATION_ERROR",
        "Razorpay billing is not configured on this deployment.",
      );
    }

    const razorpay = getRazorpayClient();

    // 1. Create Razorpay Subscription
    const subscription = await razorpay.subscriptions.create({
      plan_id: config.razorpayProPlanId,
      total_count: 12,
      quantity: 1,
      customer_notify: 1,
      notes: {
        userId: identity.userId,
        email: identity.email || "",
      },
    });

    if (!subscription || !subscription.id) {
      throw new ProcessingError(
        "INTERNAL_ERROR",
        "Failed to create Razorpay subscription session.",
      );
    }

    // 2. Persist subscription ID on user account record
    await this.repo.upsertUserAccount({
      userId: identity.userId,
      email: identity.email,
      name: identity.name,
      tier: identity.tier,
      billingProvider: "razorpay",
      razorpaySubscriptionId: subscription.id,
    });

    return {
      subscriptionId: subscription.id,
      keyId: config.razorpayKeyId,
      amount: 49900, // ₹499/month in paise
      currency: "INR",
      planName: "PDFKit Pro Plan",
    };
  }

  /**
   * Verify a completed client-side Razorpay payment signature and upgrade account to PRO.
   */
  async verifyPayment(
    options: VerifyPaymentOptions,
  ): Promise<VerifyPaymentResult> {
    const { identity, razorpayPaymentId, razorpaySubscriptionId, razorpaySignature } = options;

    if (!identity.isAuthenticated || identity.userId === "anon") {
      throw new ProcessingError(
        "VALIDATION_ERROR",
        "You must be signed in to verify payment.",
      );
    }

    const config = getBillingConfig();
    if (!config.razorpayKeySecret) {
      throw new ProcessingError(
        "VALIDATION_ERROR",
        "Razorpay secret key is not configured.",
      );
    }

    if (!razorpayPaymentId || !razorpaySubscriptionId || !razorpaySignature) {
      throw new ProcessingError(
        "VALIDATION_ERROR",
        "Missing required Razorpay payment signature parameters.",
      );
    }

    const generatedSignature = createHmac("sha256", config.razorpayKeySecret)
      .update(`${razorpayPaymentId}|${razorpaySubscriptionId}`)
      .digest("hex");

    const isSignatureValid =
      generatedSignature.length === razorpaySignature.length &&
      timingSafeEqual(
        Buffer.from(generatedSignature, "utf-8"),
        Buffer.from(razorpaySignature, "utf-8"),
      );

    if (!isSignatureValid) {
      console.error("[billing] Razorpay payment signature verification failed");
      throw new ProcessingError(
        "VALIDATION_ERROR",
        "Invalid Razorpay payment signature.",
      );
    }

    // Upgrade user account to PRO
    await this.repo.upsertUserAccount({
      userId: identity.userId,
      tier: "pro",
      status: "active",
      billingProvider: "razorpay",
      razorpaySubscriptionId,
    });

    return {
      verified: true,
      tier: "pro",
    };
  }

  /**
   * Process and synchronize incoming Razorpay webhook events.
   */
  async handleWebhookEvent(
    rawBody: string,
    signature: string | null,
  ): Promise<WebhookResult> {
    const config = getBillingConfig();

    if (!config.razorpayWebhookSecret) {
      throw new ProcessingError(
        "VALIDATION_ERROR",
        "Razorpay webhook secret is not configured.",
      );
    }

    if (!signature) {
      throw new ProcessingError(
        "VALIDATION_ERROR",
        "Missing Razorpay signature header.",
      );
    }

    const expectedSignature = createHmac("sha256", config.razorpayWebhookSecret)
      .update(rawBody)
      .digest("hex");

    const isSignatureValid =
      expectedSignature.length === signature.length &&
      timingSafeEqual(
        Buffer.from(expectedSignature, "utf-8"),
        Buffer.from(signature, "utf-8"),
      );

    if (!isSignatureValid) {
      console.error("[billing] Webhook signature verification failed");
      throw new ProcessingError(
        "VALIDATION_ERROR",
        "Invalid Razorpay webhook signature.",
      );
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      throw new ProcessingError(
        "VALIDATION_ERROR",
        "Invalid JSON webhook payload.",
      );
    }

    const eventType = (payload.event as string) || "unknown";
    const eventId =
      (payload.event_id as string) ||
      (payload.id as string) ||
      `evt_${Date.now()}`;

    // Idempotency check
    const alreadyProcessed = await this.repo.hasProcessedRazorpayEvent(eventId);
    if (alreadyProcessed) {
      return {
        status: "ignored",
        eventType,
        reason: "duplicate",
      };
    }

    // Handle Subscription Lifecycle Events
    const payloadObject = (payload.payload as Record<string, unknown>) || {};
    const subEntity =
      (payloadObject.subscription as { entity?: Record<string, unknown> })?.entity ||
      (payloadObject.payment as { entity?: Record<string, unknown> })?.entity;

    const subscriptionId = subEntity?.id ? String(subEntity.id) : null;
    const customerId = subEntity?.customer_id ? String(subEntity.customer_id) : null;
    const notes = (subEntity?.notes as Record<string, unknown>) || {};
    const userId = notes.userId ? String(notes.userId) : null;

    switch (eventType) {
      case "subscription.authenticated":
      case "subscription.activated":
      case "subscription.charged": {
        const account =
          (userId ? await this.repo.getUserAccount(userId) : null) ||
          (subscriptionId
            ? await this.repo.getUserAccountByRazorpaySubscriptionId(subscriptionId)
            : null) ||
          (customerId
            ? await this.repo.getUserAccountByRazorpayCustomerId(customerId)
            : null);

        if (account || userId) {
          const targetUserId = account?.userId || userId!;
          await this.repo.upsertUserAccount({
            userId: targetUserId,
            tier: "pro",
            status: "active",
            billingProvider: "razorpay",
            razorpayCustomerId: customerId || account?.razorpayCustomerId,
            razorpaySubscriptionId: subscriptionId || account?.razorpaySubscriptionId,
          });
        }
        break;
      }

      case "subscription.halted":
      case "subscription.cancelled":
      case "subscription.completed": {
        const account =
          (subscriptionId
            ? await this.repo.getUserAccountByRazorpaySubscriptionId(subscriptionId)
            : null) ||
          (customerId
            ? await this.repo.getUserAccountByRazorpayCustomerId(customerId)
            : null);

        if (account) {
          await this.repo.upsertUserAccount({
            userId: account.userId,
            tier: "free",
            status: "active",
            billingProvider: "razorpay",
          });
        }
        break;
      }

      default:
        // Other events ignored safely
        break;
    }

    // Record processed event ID for idempotency
    await this.repo.recordRazorpayEvent(eventId, eventType);

    return {
      status: "success",
      eventType,
    };
  }
}

/**
 * Returns singleton BillingService instance.
 */
export function getBillingService(): BillingService {
  return new BillingService(getUsageRepository());
}
