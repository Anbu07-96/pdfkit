import "server-only";

import { getBillingConfig } from "@/lib/billing/config";
import { getStripeClient } from "@/lib/billing/stripe";
import type {
  CheckoutSessionOptions,
  CheckoutSessionResult,
  WebhookResult,
} from "@/lib/billing/types";
import { ProcessingError } from "@/lib/processing/errors";
import { getUsageRepository } from "@/lib/usage/repository";
import type { UsageRepository } from "@/lib/usage/types";

/**
 * Server-only Stripe Billing Service for PDFKit.
 *
 * Provides provider-isolated billing management for checkout sessions,
 * Stripe customer lifecycle, and webhook event synchronization.
 */
export class BillingService {
  private repo: UsageRepository;

  constructor(repo = getUsageRepository()) {
    this.repo = repo;
  }

  /**
   * Create a Stripe Checkout session for upgrading an authenticated user to PRO.
   */
  async createCheckoutSession(
    options: CheckoutSessionOptions,
  ): Promise<CheckoutSessionResult> {
    const { identity, planId, successUrl, cancelUrl } = options;

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
    if (!config.isConfigured || !config.stripeProPriceId) {
      throw new ProcessingError(
        "VALIDATION_ERROR",
        "Stripe billing is not configured on this deployment.",
      );
    }

    const stripe = getStripeClient();

    // 1. Resolve or create Stripe Customer
    let account = await this.repo.getUserAccount(identity.userId);
    let stripeCustomerId = account?.stripeCustomerId ?? null;

    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: identity.email || undefined,
        name: identity.name || undefined,
        metadata: {
          userId: identity.userId,
        },
      });

      stripeCustomerId = customer.id;

      account = await this.repo.upsertUserAccount({
        userId: identity.userId,
        email: identity.email,
        name: identity.name,
        tier: identity.tier,
        stripeCustomerId,
      });
    }

    // 2. Derive Return URLs
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
    const defaultSuccess = `${siteUrl}/account?checkout=success`;
    const defaultCancel = `${siteUrl}/account?checkout=canceled`;

    // 3. Create Checkout Session
    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      mode: "subscription",
      line_items: [
        {
          price: config.stripeProPriceId,
          quantity: 1,
        },
      ],
      client_reference_id: identity.userId,
      success_url: successUrl || defaultSuccess,
      cancel_url: cancelUrl || defaultCancel,
      metadata: {
        userId: identity.userId,
        planId: "pro",
      },
    });

    if (!session.url) {
      throw new ProcessingError(
        "INTERNAL_ERROR",
        "Failed to create checkout session URL.",
      );
    }

    return {
      sessionId: session.id,
      url: session.url,
    };
  }

  /**
   * Process and synchronize incoming Stripe webhook events.
   */
  async handleWebhookEvent(
    rawBody: string | Buffer,
    signature: string | null,
  ): Promise<WebhookResult> {
    const config = getBillingConfig();

    if (!config.stripeWebhookSecret) {
      throw new ProcessingError(
        "VALIDATION_ERROR",
        "Stripe webhook secret is not configured.",
      );
    }

    if (!signature) {
      throw new ProcessingError(
        "VALIDATION_ERROR",
        "Missing Stripe signature header.",
      );
    }

    const stripe = getStripeClient();
    let event: import("stripe").Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(
        rawBody,
        signature,
        config.stripeWebhookSecret,
      );
    } catch (err) {
      console.error("[billing] Webhook signature verification failed", err);
      throw new ProcessingError(
        "VALIDATION_ERROR",
        "Invalid Stripe webhook signature.",
        { cause: err },
      );
    }

    // Idempotency check
    const alreadyProcessed = await this.repo.hasProcessedStripeEvent(event.id);
    if (alreadyProcessed) {
      return {
        status: "ignored",
        eventType: event.type,
        reason: "duplicate",
      };
    }

    // Handle Subscription Lifecycle Events
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as import("stripe").Stripe.Checkout.Session;
        const userId = session.client_reference_id || session.metadata?.userId;
        const customerId =
          typeof session.customer === "string"
            ? session.customer
            : session.customer?.id;
        const subscriptionId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id;

        if (userId) {
          await this.repo.upsertUserAccount({
            userId,
            tier: "pro",
            status: "active",
            stripeCustomerId: customerId || undefined,
            stripeSubscriptionId: subscriptionId || undefined,
          });
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object as import("stripe").Stripe.Subscription;
        const subscriptionId = sub.id;
        const customerId =
          typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
        const userId = sub.metadata?.userId;

        const account =
          (userId ? await this.repo.getUserAccount(userId) : null) ||
          (await this.repo.getUserAccountByStripeSubscriptionId(subscriptionId)) ||
          (customerId
            ? await this.repo.getUserAccountByStripeCustomerId(customerId)
            : null);

        if (account) {
          const isPro = sub.status === "active" || sub.status === "trialing";
          const newTier = isPro ? "pro" : "free";

          await this.repo.upsertUserAccount({
            userId: account.userId,
            tier: newTier,
            status: "active",
            stripeCustomerId: customerId || account.stripeCustomerId,
            stripeSubscriptionId: subscriptionId,
          });
        }
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as import("stripe").Stripe.Subscription;
        const subscriptionId = sub.id;
        const customerId =
          typeof sub.customer === "string" ? sub.customer : sub.customer?.id;

        const account =
          (await this.repo.getUserAccountByStripeSubscriptionId(subscriptionId)) ||
          (customerId
            ? await this.repo.getUserAccountByStripeCustomerId(customerId)
            : null);

        if (account) {
          await this.repo.upsertUserAccount({
            userId: account.userId,
            tier: "free",
            status: "active",
            stripeSubscriptionId: undefined,
          });
        }
        break;
      }

      default:
        // Other events ignored safely
        break;
    }

    // Record processed event ID for idempotency
    await this.repo.recordStripeEvent(event.id, event.type);

    return {
      status: "success",
      eventType: event.type,
    };
  }
}

/**
 * Returns singleton BillingService instance.
 */
export function getBillingService(): BillingService {
  return new BillingService(getUsageRepository());
}
