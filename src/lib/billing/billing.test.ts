import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import type { UserIdentity } from "@/lib/auth/types";
import { getBillingConfig, isStripeConfigured } from "@/lib/billing/config";
import { BillingService } from "@/lib/billing/service";
import { setStripeClientOverride } from "@/lib/billing/stripe";
import { ProcessingError } from "@/lib/processing/errors";
import {
  InMemoryUsageRepository,
  setUsageRepositoryOverride,
} from "@/lib/usage/repository";

const mockAnonIdentity: UserIdentity = {
  isAuthenticated: false,
  userId: "anon",
  email: null,
  name: null,
  status: "anonymous",
  tier: "anonymous",
};

const mockUserIdentity: UserIdentity = {
  isAuthenticated: true,
  userId: "usr_billing_123",
  email: "alice@example.com",
  name: "Alice",
  status: "active",
  tier: "free",
};

describe("Phase 44 — Stripe Billing & Subscription Architecture", () => {
  let repo: InMemoryUsageRepository;
  let service: BillingService;

  beforeEach(() => {
    repo = new InMemoryUsageRepository();
    setUsageRepositoryOverride(repo);
    service = new BillingService(repo);
  });

  afterEach(() => {
    setUsageRepositoryOverride(null);
    setStripeClientOverride(null);
    vi.unstubAllEnvs();
  });

  describe("Billing Configuration", () => {
    it("reports unconfigured when environment variables are missing", () => {
      vi.stubEnv("STRIPE_SECRET_KEY", "");
      vi.stubEnv("STRIPE_PRO_PRICE_ID", "");

      expect(isStripeConfigured()).toBe(false);
      expect(getBillingConfig().isConfigured).toBe(false);
    });

    it("reports configured when secret key and price ID are set", () => {
      vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_dummy");
      vi.stubEnv("STRIPE_PRO_PRICE_ID", "price_pro_dummy");

      expect(isStripeConfigured()).toBe(true);
      expect(getBillingConfig().stripeProPriceId).toBe("price_pro_dummy");
    });
  });

  describe("Checkout Session Creation", () => {
    it("rejects unauthenticated users from creating checkout sessions", async () => {
      await expect(
        service.createCheckoutSession({
          identity: mockAnonIdentity,
          planId: "pro",
        }),
      ).rejects.toThrow(ProcessingError);
    });

    it("rejects invalid/unsupported plan IDs", async () => {
      await expect(
        service.createCheckoutSession({
          identity: mockUserIdentity,
          planId: "invalid" as unknown as "pro",
        }),
      ).rejects.toThrow(ProcessingError);
    });

    it("rejects checkout when Stripe environment is unconfigured", async () => {
      vi.stubEnv("STRIPE_SECRET_KEY", "");
      vi.stubEnv("STRIPE_PRO_PRICE_ID", "");

      await expect(
        service.createCheckoutSession({
          identity: mockUserIdentity,
          planId: "pro",
        }),
      ).rejects.toThrow(ProcessingError);
    });

    it("creates customer and checkout session for authenticated user", async () => {
      vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_123");
      vi.stubEnv("STRIPE_PRO_PRICE_ID", "price_123");

      const mockStripe = {
        customers: {
          create: vi.fn().mockResolvedValue({ id: "cus_mock_123" }),
        },
        checkout: {
          sessions: {
            create: vi.fn().mockResolvedValue({
              id: "cs_mock_123",
              url: "https://checkout.stripe.com/c/pay/cs_mock_123",
            }),
          },
        },
      } as unknown as Stripe;

      setStripeClientOverride(mockStripe);

      const result = await service.createCheckoutSession({
        identity: mockUserIdentity,
        planId: "pro",
      });

      expect(result.sessionId).toBe("cs_mock_123");
      expect(result.url).toBe("https://checkout.stripe.com/c/pay/cs_mock_123");

      // Verify customer was created and persisted
      const acc = await repo.getUserAccount(mockUserIdentity.userId);
      expect(acc?.stripeCustomerId).toBe("cus_mock_123");
    });

    it("reuses existing Stripe customer ID on subsequent checkout requests", async () => {
      vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_123");
      vi.stubEnv("STRIPE_PRO_PRICE_ID", "price_123");

      await repo.upsertUserAccount({
        userId: mockUserIdentity.userId,
        stripeCustomerId: "cus_existing_999",
      });

      const mockStripe = {
        customers: {
          create: vi.fn(),
        },
        checkout: {
          sessions: {
            create: vi.fn().mockResolvedValue({
              id: "cs_mock_456",
              url: "https://checkout.stripe.com/pay/cs_mock_456",
            }),
          },
        },
      } as unknown as Stripe;

      setStripeClientOverride(mockStripe);

      const result = await service.createCheckoutSession({
        identity: mockUserIdentity,
        planId: "pro",
      });

      expect(mockStripe.customers.create).not.toHaveBeenCalled();
      expect(result.sessionId).toBe("cs_mock_456");
      expect(mockStripe.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          customer: "cus_existing_999",
        }),
      );
    });
  });

  describe("Stripe Webhooks & Event Synchronization", () => {
    it("rejects webhooks with missing signature or secret", async () => {
      vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
      await expect(
        service.handleWebhookEvent("payload", "sig_header"),
      ).rejects.toThrow(ProcessingError);
    });

    it("rejects webhooks when signature verification fails", async () => {
      vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_123");
      vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test");

      const mockStripe = {
        webhooks: {
          constructEvent: vi.fn().mockImplementation(() => {
            throw new Error("Invalid signature");
          }),
        },
      } as unknown as Stripe;

      setStripeClientOverride(mockStripe);

      await expect(
        service.handleWebhookEvent("invalid payload", "bad_sig"),
      ).rejects.toThrow("Invalid Stripe webhook signature.");
    });

    it("handles checkout.session.completed and upgrades account to PRO", async () => {
      vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_123");
      vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test");

      // Seed account
      await repo.upsertUserAccount({
        userId: mockUserIdentity.userId,
        tier: "free",
      });

      const mockEvent = {
        id: "evt_checkout_100",
        type: "checkout.session.completed",
        data: {
          object: {
            client_reference_id: mockUserIdentity.userId,
            customer: "cus_123",
            subscription: "sub_999",
          },
        },
      };

      const mockStripe = {
        webhooks: {
          constructEvent: vi.fn().mockReturnValue(mockEvent),
        },
      } as unknown as Stripe;

      setStripeClientOverride(mockStripe);

      const result = await service.handleWebhookEvent("raw_body", "valid_sig");
      expect(result.status).toBe("success");
      expect(result.eventType).toBe("checkout.session.completed");

      const acc = await repo.getUserAccount(mockUserIdentity.userId);
      expect(acc?.tier).toBe("pro");
      expect(acc?.stripeCustomerId).toBe("cus_123");
      expect(acc?.stripeSubscriptionId).toBe("sub_999");
    });

    it("handles customer.subscription.deleted and downgrades account to FREE", async () => {
      vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_123");
      vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test");

      // Seed active PRO account
      await repo.upsertUserAccount({
        userId: mockUserIdentity.userId,
        tier: "pro",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_999",
      });

      const mockEvent = {
        id: "evt_sub_deleted_200",
        type: "customer.subscription.deleted",
        data: {
          object: {
            id: "sub_999",
            customer: "cus_123",
          },
        },
      };

      const mockStripe = {
        webhooks: {
          constructEvent: vi.fn().mockReturnValue(mockEvent),
        },
      } as unknown as Stripe;

      setStripeClientOverride(mockStripe);

      const result = await service.handleWebhookEvent("raw_body", "valid_sig");
      expect(result.status).toBe("success");

      const acc = await repo.getUserAccount(mockUserIdentity.userId);
      expect(acc?.tier).toBe("free");
    });

    it("enforces idempotency on duplicate webhook events", async () => {
      vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_123");
      vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test");

      const mockEvent = {
        id: "evt_duplicate_300",
        type: "checkout.session.completed",
        data: {
          object: {
            client_reference_id: mockUserIdentity.userId,
            customer: "cus_123",
            subscription: "sub_999",
          },
        },
      };

      const mockStripe = {
        webhooks: {
          constructEvent: vi.fn().mockReturnValue(mockEvent),
        },
      } as unknown as Stripe;

      setStripeClientOverride(mockStripe);

      // First run succeeds
      const res1 = await service.handleWebhookEvent("raw_body", "valid_sig");
      expect(res1.status).toBe("success");

      // Second run with same event ID is ignored as duplicate
      const res2 = await service.handleWebhookEvent("raw_body", "valid_sig");
      expect(res2.status).toBe("ignored");
      expect(res2.reason).toBe("duplicate");
    });
  });
});
