import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { POST as checkoutPOST } from "@/app/api/billing/checkout/route";
import { POST as verifyPOST } from "@/app/api/billing/verify/route";
import { POST as webhookPOST } from "@/app/api/billing/webhook/route";
import * as sessionModule from "@/lib/auth/session";
import { resetRazorpayClient } from "@/lib/billing/razorpay";
import {
  InMemoryUsageRepository,
  setUsageRepositoryOverride,
} from "@/lib/usage/repository";

vi.mock("@/lib/auth/session", async (importOriginal) => {
  const original = await importOriginal<typeof sessionModule>();
  return {
    ...original,
    getUserIdentity: vi.fn(),
  };
});

const mockedGetIdentity = vi.mocked(sessionModule.getUserIdentity);

describe("Phase 46C — Razorpay Billing API Routes", () => {
  let repo: InMemoryUsageRepository;

  beforeEach(() => {
    repo = new InMemoryUsageRepository();
    setUsageRepositoryOverride(repo);
    vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_key");
    vi.stubEnv("RAZORPAY_KEY_SECRET", "rzp_test_secret");
    vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", "whsec_test_secret");
    vi.stubEnv("RAZORPAY_PRO_PLAN_ID", "plan_pro_123");
  });

  afterEach(() => {
    setUsageRepositoryOverride(null);
    resetRazorpayClient();
    vi.unstubAllEnvs();
  });

  describe("POST /api/billing/checkout", () => {
    it("returns 401 Unauthorized for anonymous users", async () => {
      mockedGetIdentity.mockResolvedValueOnce(sessionModule.ANONYMOUS_USER_IDENTITY);

      const request = new Request("http://localhost:3000/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ planId: "pro" }),
      });

      const response = await checkoutPOST(request);
      expect(response.status).toBe(401);

      const body = (await response.json()) as { error: { message: string } };
      expect(body.error.message).toContain("Sign in");
    });

    it("returns 400 for invalid plan requested", async () => {
      mockedGetIdentity.mockResolvedValueOnce({
        isAuthenticated: true,
        userId: "usr_route_test",
        email: "route@example.com",
        name: "Route Test",
        status: "active",
        tier: "free",
      });

      const request = new Request("http://localhost:3000/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ planId: "invalid_tier" }),
      });

      const response = await checkoutPOST(request);
      expect(response.status).toBe(400);

      const body = (await response.json()) as { error: { message: string } };
      expect(body.error.message).toContain("Only the PRO plan is currently available");
    });
  });

  describe("POST /api/billing/verify", () => {
    it("returns 401 Unauthorized for anonymous users", async () => {
      mockedGetIdentity.mockResolvedValueOnce(sessionModule.ANONYMOUS_USER_IDENTITY);

      const request = new Request("http://localhost:3000/api/billing/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          razorpayPaymentId: "pay_123",
          razorpaySubscriptionId: "sub_123",
          razorpaySignature: "sig_123",
        }),
      });

      const response = await verifyPOST(request);
      expect(response.status).toBe(401);
    });

    it("verifies payment signature and returns 200 with verified status", async () => {
      mockedGetIdentity.mockResolvedValueOnce({
        isAuthenticated: true,
        userId: "usr_route_test",
        email: "route@example.com",
        name: "Route Test",
        status: "active",
        tier: "free",
      });

      const secret = "rzp_test_secret";
      const paymentId = "pay_route_123";
      const subId = "sub_route_123";
      const signature = createHmac("sha256", secret)
        .update(`${paymentId}|${subId}`)
        .digest("hex");

      const request = new Request("http://localhost:3000/api/billing/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          razorpayPaymentId: paymentId,
          razorpaySubscriptionId: subId,
          razorpaySignature: signature,
        }),
      });

      const response = await verifyPOST(request);
      expect(response.status).toBe(200);

      const body = (await response.json()) as { verified: boolean; tier: string };
      expect(body.verified).toBe(true);
      expect(body.tier).toBe("pro");
    });
  });

  describe("POST /api/billing/webhook", () => {
    it("returns 400 when x-razorpay-signature header is missing", async () => {
      const request = new Request("http://localhost:3000/api/billing/webhook", {
        method: "POST",
        body: "payload",
      });

      const response = await webhookPOST(request);
      expect(response.status).toBe(400);

      const body = (await response.json()) as { error: { message: string } };
      expect(body.error.message).toContain("x-razorpay-signature");
    });

    it("returns 200 and processes valid signed webhook event", async () => {
      const webhookSecret = "whsec_test_secret";
      const payload = {
        event_id: "evt_route_1",
        event: "subscription.charged",
        payload: {
          subscription: {
            entity: {
              id: "sub_route_999",
              notes: { userId: "usr_route_test" },
            },
          },
        },
      };

      const rawBody = JSON.stringify(payload);
      const signature = createHmac("sha256", webhookSecret)
        .update(rawBody)
        .digest("hex");

      const request = new Request("http://localhost:3000/api/billing/webhook", {
        method: "POST",
        headers: { "x-razorpay-signature": signature },
        body: rawBody,
      });

      const response = await webhookPOST(request);
      expect(response.status).toBe(200);

      const body = (await response.json()) as { received: boolean; status: string };
      expect(body.received).toBe(true);
      expect(body.status).toBe("success");
    });
  });
});
