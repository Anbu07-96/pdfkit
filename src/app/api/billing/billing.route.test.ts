import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { POST as checkoutPOST } from "@/app/api/billing/checkout/route";
import { POST as webhookPOST } from "@/app/api/billing/webhook/route";
import * as sessionModule from "@/lib/auth/session";
import { setStripeClientOverride } from "@/lib/billing/stripe";
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

describe("Phase 44 — Stripe Billing API Routes", () => {
  let repo: InMemoryUsageRepository;

  beforeEach(() => {
    repo = new InMemoryUsageRepository();
    setUsageRepositoryOverride(repo);
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_123");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_123");
    vi.stubEnv("STRIPE_PRO_PRICE_ID", "price_123");
  });

  afterEach(() => {
    setUsageRepositoryOverride(null);
    setStripeClientOverride(null);
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

    it("creates checkout session and returns 200 with checkout URL for authenticated user", async () => {
      mockedGetIdentity.mockResolvedValueOnce({
        isAuthenticated: true,
        userId: "usr_route_test",
        email: "route@example.com",
        name: "Route Test",
        status: "active",
        tier: "free",
      });

      const mockStripe = {
        customers: {
          create: vi.fn().mockResolvedValue({ id: "cus_route_123" }),
        },
        checkout: {
          sessions: {
            create: vi.fn().mockResolvedValue({
              id: "cs_route_123",
              url: "https://checkout.stripe.com/pay/cs_route_123",
            }),
          },
        },
      } as unknown as Stripe;

      setStripeClientOverride(mockStripe);

      const request = new Request("http://localhost:3000/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ planId: "pro" }),
      });

      const response = await checkoutPOST(request);
      expect(response.status).toBe(200);

      const body = (await response.json()) as { sessionId: string; url: string };
      expect(body.sessionId).toBe("cs_route_123");
      expect(body.url).toBe("https://checkout.stripe.com/pay/cs_route_123");
    });
  });

  describe("POST /api/billing/webhook", () => {
    it("returns 400 when stripe-signature header is missing", async () => {
      const request = new Request("http://localhost:3000/api/billing/webhook", {
        method: "POST",
        body: "payload",
      });

      const response = await webhookPOST(request);
      expect(response.status).toBe(400);

      const body = (await response.json()) as { error: { message: string } };
      expect(body.error.message).toContain("stripe-signature");
    });

    it("returns 200 and processes valid signed webhook event", async () => {
      const mockEvent = {
        id: "evt_route_1",
        type: "checkout.session.completed",
        data: {
          object: {
            client_reference_id: "usr_route_test",
            customer: "cus_route_123",
            subscription: "sub_route_123",
          },
        },
      };

      const mockStripe = {
        webhooks: {
          constructEvent: vi.fn().mockReturnValue(mockEvent),
        },
      } as unknown as Stripe;

      setStripeClientOverride(mockStripe);

      const request = new Request("http://localhost:3000/api/billing/webhook", {
        method: "POST",
        headers: { "stripe-signature": "t=123,v1=valid_sig" },
        body: "payload_bytes",
      });

      const response = await webhookPOST(request);
      expect(response.status).toBe(200);

      const body = (await response.json()) as { received: boolean; status: string };
      expect(body.received).toBe(true);
      expect(body.status).toBe("success");
    });
  });
});
