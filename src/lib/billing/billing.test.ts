import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import type { UserIdentity } from "@/lib/auth/types";
import { getBillingConfig, isBillingConfigured } from "@/lib/billing/config";
import { resetRazorpayClient } from "@/lib/billing/razorpay";
import { BillingService } from "@/lib/billing/service";
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

describe("Phase 46C — Razorpay Billing & Subscription Architecture", () => {
  let repo: InMemoryUsageRepository;
  let service: BillingService;

  beforeEach(() => {
    repo = new InMemoryUsageRepository();
    setUsageRepositoryOverride(repo);
    service = new BillingService(repo);
  });

  afterEach(() => {
    setUsageRepositoryOverride(null);
    resetRazorpayClient();
    vi.unstubAllEnvs();
  });

  describe("Billing Configuration", () => {
    it("reports unconfigured when environment variables are missing", () => {
      vi.stubEnv("RAZORPAY_KEY_ID", "");
      vi.stubEnv("RAZORPAY_KEY_SECRET", "");
      vi.stubEnv("RAZORPAY_PRO_PLAN_ID", "");

      expect(isBillingConfigured()).toBe(false);
      expect(getBillingConfig().isConfigured).toBe(false);
    });

    it("reports configured when key ID, secret and plan ID are set", () => {
      vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_key");
      vi.stubEnv("RAZORPAY_KEY_SECRET", "rzp_test_secret");
      vi.stubEnv("RAZORPAY_PRO_PLAN_ID", "plan_pro_123");

      expect(isBillingConfigured()).toBe(true);
      expect(getBillingConfig().razorpayProPlanId).toBe("plan_pro_123");
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

    it("rejects checkout when Razorpay environment is unconfigured", async () => {
      vi.stubEnv("RAZORPAY_KEY_ID", "");
      vi.stubEnv("RAZORPAY_KEY_SECRET", "");
      vi.stubEnv("RAZORPAY_PRO_PLAN_ID", "");

      await expect(
        service.createCheckoutSession({
          identity: mockUserIdentity,
          planId: "pro",
        }),
      ).rejects.toThrow(ProcessingError);
    });
  });

  describe("Payment Verification", () => {
    it("rejects unauthenticated users from verifying payments", async () => {
      await expect(
        service.verifyPayment({
          identity: mockAnonIdentity,
          razorpayPaymentId: "pay_123",
          razorpaySubscriptionId: "sub_123",
          razorpaySignature: "sig_123",
        }),
      ).rejects.toThrow(ProcessingError);
    });

    it("rejects payment verification when signature is invalid", async () => {
      vi.stubEnv("RAZORPAY_KEY_SECRET", "secret_123");

      await expect(
        service.verifyPayment({
          identity: mockUserIdentity,
          razorpayPaymentId: "pay_123",
          razorpaySubscriptionId: "sub_123",
          razorpaySignature: "invalid_sig",
        }),
      ).rejects.toThrow("Invalid Razorpay payment signature.");
    });

    it("verifies payment signature correctly and upgrades user to PRO", async () => {
      const secret = "secret_123";
      vi.stubEnv("RAZORPAY_KEY_SECRET", secret);

      const paymentId = "pay_mock_100";
      const subId = "sub_mock_200";
      const validSignature = createHmac("sha256", secret)
        .update(`${paymentId}|${subId}`)
        .digest("hex");

      const result = await service.verifyPayment({
        identity: mockUserIdentity,
        razorpayPaymentId: paymentId,
        razorpaySubscriptionId: subId,
        razorpaySignature: validSignature,
      });

      expect(result.verified).toBe(true);
      expect(result.tier).toBe("pro");

      const acc = await repo.getUserAccount(mockUserIdentity.userId);
      expect(acc?.tier).toBe("pro");
      expect(acc?.razorpaySubscriptionId).toBe(subId);
    });
  });

  describe("Razorpay Webhooks & Event Synchronization", () => {
    it("rejects webhooks with missing signature or secret", async () => {
      vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", "");
      await expect(
        service.handleWebhookEvent("payload", "sig_header"),
      ).rejects.toThrow(ProcessingError);
    });

    it("rejects webhooks when signature verification fails", async () => {
      vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", "whsec_test");

      await expect(
        service.handleWebhookEvent('{"event":"subscription.charged"}', "bad_sig"),
      ).rejects.toThrow("Invalid Razorpay webhook signature.");
    });

    it("handles subscription.charged and upgrades account to PRO", async () => {
      const webhookSecret = "whsec_test";
      vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", webhookSecret);

      await repo.upsertUserAccount({
        userId: mockUserIdentity.userId,
        tier: "free",
      });

      const payload = {
        event_id: "evt_sub_charged_100",
        event: "subscription.charged",
        payload: {
          subscription: {
            entity: {
              id: "sub_rzp_999",
              customer_id: "cust_rzp_888",
              notes: {
                userId: mockUserIdentity.userId,
              },
            },
          },
        },
      };

      const rawBody = JSON.stringify(payload);
      const validSig = createHmac("sha256", webhookSecret)
        .update(rawBody)
        .digest("hex");

      const result = await service.handleWebhookEvent(rawBody, validSig);
      expect(result.status).toBe("success");
      expect(result.eventType).toBe("subscription.charged");

      const acc = await repo.getUserAccount(mockUserIdentity.userId);
      expect(acc?.tier).toBe("pro");
      expect(acc?.razorpaySubscriptionId).toBe("sub_rzp_999");
      expect(acc?.razorpayCustomerId).toBe("cust_rzp_888");
    });

    it("handles subscription.cancelled and downgrades account to FREE", async () => {
      const webhookSecret = "whsec_test";
      vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", webhookSecret);

      await repo.upsertUserAccount({
        userId: mockUserIdentity.userId,
        tier: "pro",
        razorpaySubscriptionId: "sub_rzp_999",
      });

      const payload = {
        event_id: "evt_sub_cancelled_200",
        event: "subscription.cancelled",
        payload: {
          subscription: {
            entity: {
              id: "sub_rzp_999",
            },
          },
        },
      };

      const rawBody = JSON.stringify(payload);
      const validSig = createHmac("sha256", webhookSecret)
        .update(rawBody)
        .digest("hex");

      const result = await service.handleWebhookEvent(rawBody, validSig);
      expect(result.status).toBe("success");

      const acc = await repo.getUserAccount(mockUserIdentity.userId);
      expect(acc?.tier).toBe("free");
    });

    it("enforces idempotency on duplicate webhook events", async () => {
      const webhookSecret = "whsec_test";
      vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", webhookSecret);

      const payload = {
        event_id: "evt_duplicate_300",
        event: "subscription.activated",
        payload: {
          subscription: {
            entity: {
              id: "sub_rzp_111",
              notes: { userId: mockUserIdentity.userId },
            },
          },
        },
      };

      const rawBody = JSON.stringify(payload);
      const validSig = createHmac("sha256", webhookSecret)
        .update(rawBody)
        .digest("hex");

      // First run
      const res1 = await service.handleWebhookEvent(rawBody, validSig);
      expect(res1.status).toBe("success");

      // Second run is ignored
      const res2 = await service.handleWebhookEvent(rawBody, validSig);
      expect(res2.status).toBe("ignored");
      expect(res2.reason).toBe("duplicate");
    });
  });
});
