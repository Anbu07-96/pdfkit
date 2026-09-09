import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { getBillingConfig } from "@/lib/billing/config";
import { getRazorpayClient } from "@/lib/billing/razorpay";
import { PLANS } from "@/lib/billing/plans";
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
import type { UserAccountTier } from "@/lib/auth/types";

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
    // NOTE: live mode is only reachable with live keys AND the explicit
    // PDFKIT_BILLING_ALLOW_LIVE=true acknowledgment (see config.ts) — a
    // deliberate two-key decision. Phase 66 runs disabled/test only.

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
      // Single source of truth (Phase 66): the amount shown to Razorpay
      // checkout comes from the plan catalog, never a second hardcode.
      amount: PLANS.find((p) => p.id === "pro")!.monthlyPriceMinor,
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

    // Phase 66 hardening: the verified payment must belong to THIS account.
    // createCheckoutSession persists the subscription ID it created on the
    // account row, so a signature for a different subscription (however it
    // was obtained) must never upgrade this user. The signature alone proves
    // Razorpay signed the pair — not that the pair belongs to this account.
    const account = await this.repo.getUserAccount(identity.userId);
    if (
      !account ||
      !account.razorpaySubscriptionId ||
      account.razorpaySubscriptionId !== razorpaySubscriptionId
    ) {
      console.error("[billing] Payment verification subscription/account mismatch");
      throw new ProcessingError(
        "VALIDATION_ERROR",
        "This payment could not be matched to your account. Please contact support.",
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
   * Cancel the signed-in user's active Razorpay subscription at the end of the
   * current paid period (Phase 66: makes "cancel anytime" truthful).
   *
   * Semantics: Razorpay keeps the subscription active until the period the
   * user already paid for ends, then fires `subscription.completed` — the
   * webhook handler downgrades the account to Free. The account therefore
   * keeps Pro access for the paid period; no proration, no refunds (documented
   * on /refund-policy). The stored subscription record is kept for audit and
   * webhook correlation.
   */
  async cancelSubscriptionAtPeriodEnd(
    identity: VerifyPaymentOptions["identity"],
  ): Promise<{ cancelled: boolean; tier: UserAccountTier }> {
    if (!identity.isAuthenticated || identity.userId === "anon") {
      throw new ProcessingError(
        "VALIDATION_ERROR",
        "You must be signed in to manage your subscription.",
      );
    }

    const config = getBillingConfig();
    if (!config.isConfigured) {
      throw new ProcessingError(
        "VALIDATION_ERROR",
        "Razorpay billing is not configured on this deployment.",
      );
    }

    const account = await this.repo.getUserAccount(identity.userId);
    if (!account || !account.razorpaySubscriptionId) {
      throw new ProcessingError(
        "VALIDATION_ERROR",
        "No active subscription found on your account.",
      );
    }

    const razorpay = getRazorpayClient();
    // cancelAtCycleEnd = true → access continues to the end of the paid period.
    await razorpay.subscriptions.cancel(account.razorpaySubscriptionId, true);

    return { cancelled: true, tier: account.tier as UserAccountTier };
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
          // Phase 66: a cycle-end cancellation (subscriptions.cancel(id, true))
          // keeps the paid period running — the user stays Pro until the
          // period actually ends, at which point Razorpay fires
          // subscription.completed. Downgrading early would take away access
          // the user already paid for, so only downgrade when the entity has
          // no remaining paid time (current_end in the past or absent) or the
          // subscription halted (charges failing). Err towards the user when
          // the payload is ambiguous.
          const currentEnd = Number(subEntity?.current_end ?? 0);
          const paidTimeRemaining =
            Number.isFinite(currentEnd) && currentEnd * 1000 > Date.now();
          // Halted (charges failing) or completed (all cycles done): downgrade.
          // Cancelled: downgrade only when no paid time remains — a cycle-end
          // cancellation keeps Pro until the period actually completes.
          const shouldDowngrade =
            eventType !== "subscription.cancelled" || !paidTimeRemaining;

          if (shouldDowngrade) {
            await this.repo.upsertUserAccount({
              userId: account.userId,
              tier: "free",
              status: "active",
              billingProvider: "razorpay",
            });
          }
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
